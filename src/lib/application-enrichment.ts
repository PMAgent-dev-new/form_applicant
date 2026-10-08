import { applicationContextLines, normalizeApplicationContext, isInternalSource } from './application-context';

/** Server only. No applicant information is sent to Meta. Keep identical in both intake apps. */
const ACCOUNT_ID = '1435983094817075';
const str = (v: unknown, max = 600) => typeof v === 'string' ? v.trim().slice(0, max) : '';
type Creative = {
  id?: string; name?: string; body?: string; title?: string; image_url?: string;
  effective_object_story_id?: string; instagram_permalink_url?: string; product_set_id?: string;
  object_story_spec?: {
    link_data?: { message?: string; name?: string; description?: string; picture?: string; child_attachments?: unknown[] };
    video_data?: { message?: string; title?: string; image_url?: string; video_id?: string };
  };
  asset_feed_spec?: { bodies?: { text?: string }[]; titles?: { text?: string }[]; descriptions?: { text?: string }[]; images?: unknown[]; videos?: unknown[] };
};
export type ApplicationEnrichment = {
  lines: string[]; creativeText: string; materialStatus: string;
  adId: string; creativeId: string; imageUrl: string; dynamic: boolean;
};
type Legacy = { source?: string; medium?: string; campaign?: string; content?: string; id?: string; creative?: string; at?: string; landing?: string };
export async function enrichApplication(raw: unknown, legacy: Legacy = {}, now = Date.now()): Promise<ApplicationEnrichment> {
  let context = normalizeApplicationContext(raw, now);
  if (!context.acquisition && legacy.source && !isInternalSource(legacy.source)) {
    context = normalizeApplicationContext({ ...context, acquisition: { ...legacy, at: legacy.at || new Date(now).toISOString() } }, now);
  }
  if (!context.entry && isInternalSource(legacy.source)) {
    context = normalizeApplicationContext({ ...context, entry: { source: legacy.source, medium: legacy.medium, at: new Date(now).toISOString(), url: legacy.landing },
      article: legacy.source === 'ridejob_media' ? { id: legacy.content } : undefined }, now);
  }
  const a = context.acquisition;
  const meta = /^(meta|facebook|instagram|fb|ig|\{\{site_source_name\}\})$/i.test(a?.source || '');
  const candidate = meta ? [a?.id, a?.content, a?.creative].find(v => /^\d{5,32}$/.test(v || '')) || '' : '';
  const result: ApplicationEnrichment = { lines: applicationContextLines(context, now), creativeText: '', materialStatus: candidate ? '広告情報取得失敗（後日確認が必要）' : '広告IDなし・CR未特定', adId: candidate, creativeId: '', imageUrl: '', dynamic: false };
  const token = process.env.META_ACCESS_TOKEN;
  if (candidate && token) {
    try {
      const params = new URLSearchParams({ fields: 'id,account_id,name,creative{id,name,body,title,image_url,effective_object_story_id,instagram_permalink_url,object_story_spec,asset_feed_spec,product_set_id}', access_token: token });
      const response = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v25.0'}/${candidate}?${params}`, { signal: AbortSignal.timeout(2500) });
      const data = await response.json() as { id?: string; account_id?: string; name?: string; creative?: Creative; error?: unknown };
      if (response.ok && !data.error && data.id === candidate && data.account_id === ACCOUNT_ID && data.creative) {
        const c = data.creative, link = c.object_story_spec?.link_data, video = c.object_story_spec?.video_data;
        result.creativeId = str(c.id, 32);
        result.dynamic = !!c.product_set_id || !!c.asset_feed_spec || !!link?.child_attachments?.length;
        result.imageUrl = str(c.image_url || video?.image_url || link?.picture, 3000);
        result.materialStatus = result.imageUrl ? '素材保存待ち' : '画像URLなし（広告リンクで確認）';
        const copy = (label: string, values: unknown[]) => [...new Set(values.map(v => str(v, 3000)).filter(Boolean))].slice(0, 5).map(v => `${label}: ${v}`);
        const story = /^\d+_\d+$/.test(c.effective_object_story_id || '') ? `https://www.facebook.com/${c.effective_object_story_id}` : '';
        result.creativeText = [
          `対象広告: ${str(data.name, 200) || candidate}`, `ad.id: ${candidate}`, `creative.id: ${result.creativeId || '未取得'}`,
          `広告管理画面: https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ACCOUNT_ID}&selected_ad_ids=${candidate}`,
          story ? `投稿: ${story}` : '',
          /^https:\/\/www\.instagram\.com\//.test(c.instagram_permalink_url || '') ? `Instagram投稿: ${c.instagram_permalink_url}` : '',
          /^\d+$/.test(video?.video_id || '') ? `動画: https://www.facebook.com/watch/?v=${video?.video_id}` : '',
          result.dynamic ? '注意: カタログ／複数素材の設定候補。本人に表示された組み合わせは未確定。' : '注意: 応募受付時点の広告設定。クリック時点の設定や本人の閲覧を保証しません。',
          ...copy('本文', [c.body, link?.message, video?.message, ...(c.asset_feed_spec?.bodies || []).map(x => x.text)]),
          ...copy('見出し', [c.title, link?.name, video?.title, ...(c.asset_feed_spec?.titles || []).map(x => x.text)]),
          ...copy('説明', [link?.description, ...(c.asset_feed_spec?.descriptions || []).map(x => x.text)]),
          `取得日時: ${new Date(now).toISOString()}`,
        ].filter(Boolean).join('\n');
        if (result.creativeText.length > 12000) result.creativeText = `${result.creativeText.slice(0, 12000)}\n（長い候補テキストの一部を省略。広告管理画面で全文確認）`;
      } else {
        console.warn('[application-context] Meta lookup rejected', { status: response.status, accountMatched: data.account_id === ACCOUNT_ID });
      }
    } catch { console.warn('[application-context] Meta lookup unavailable; application continues'); }
  }
  if (!result.creativeText) result.creativeText = `${result.materialStatus}${candidate ? `\nad.id（URL申告値）: ${candidate}` : ''}`;
  result.lines.push(result.creativeText, `CR素材状態（受付時）: ${result.materialStatus}`);
  if (result.imageUrl) result.lines.push('画像: Lark応募レコードの「CR素材」欄へ保存（動画はサムネイル）。保存結果は「CR素材状態」欄を確認。');
  return result;
}

/** Only accept existing form remarks keys; never serialize arbitrary applicant JSON into notifications. */
export function applicantRemarks(raw: unknown): string[] {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return [...new Set(['remarks', 'note', 'notes', 'comment', 'comments', 'message', 'coverLetter'].map(k => str(r[k], 2000)).filter(Boolean))].slice(0, 3).map(v => `応募時備考: ${v}`);
}

export function applicationNotificationText(lines: string[], maxBytes = 10000): string {
  const value = lines.join('\n'), encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  const suffix = '\n（続きはLark応募記録の対応履歴メモ・クリエイティブ欄を確認）';
  const budget = Math.max(0, maxBytes - encoder.encode(suffix).length);
  let result = '', bytes = 0;
  for (const char of value) { const n = encoder.encode(char).length; if (bytes + n > budget) break; bytes += n; result += char; }
  return `${result}${suffix}`;
}

/** Snapshot an existing Meta image into the existing Lark Base (no public bucket). */
export async function saveCreativeMaterial(input: {
  enrichment: ApplicationEnrichment; domain: string; token: string; appToken: string;
  update: (fields: Record<string, unknown>) => Promise<void>;
}): Promise<void> {
  const { enrichment: e } = input;
  if (!e.imageUrl) return;
  let status = '素材保存失敗（広告リンクで確認）';
  try {
    const u = new URL(e.imageUrl);
    if (u.protocol !== 'https:' || !/(^|\.)(fbcdn\.net|facebook\.com|cdninstagram\.com)$/.test(u.hostname)) throw new Error('untrusted_image_host');
    const image = await fetch(u, { signal: AbortSignal.timeout(4000), redirect: 'error' });
    const mime = image.headers.get('content-type')?.split(';')[0] || '';
    if (!image.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) || Number(image.headers.get('content-length')) > 5 * 1024 * 1024) throw new Error('invalid_image');
    const reader = image.body?.getReader();
    if (!reader) throw new Error('no_image_body');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('image_too_large'); } chunks.push(r.value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const form = new FormData();
    form.set('file_name', `ad-${e.adId}-${e.creativeId || 'unknown'}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`);
    form.set('parent_type', 'bitable_image'); form.set('parent_node', input.appToken); form.set('size', String(size));
    form.set('file', new Blob([bytes], { type: mime }), form.get('file_name') as string);
    const upload = await fetch(`${input.domain.replace(/\/+$/, '')}/open-apis/drive/v1/medias/upload_all`, {
      method: 'POST', headers: { Authorization: `Bearer ${input.token}` }, body: form, signal: AbortSignal.timeout(5000),
    });
    const data = await upload.json() as { code?: number; data?: { file_token?: string } };
    if (!upload.ok || data.code !== 0 || !data.data?.file_token) throw new Error('upload_failed');
    status = e.dynamic ? '候補素材を保存済み（表示組み合わせ未確定）' : '保存済み（動画の場合はサムネイル）';
    await input.update({ CR素材: [{ file_token: data.data.file_token }], CR素材状態: status });
    console.info('[application-context] creative snapshot saved', { adId: e.adId });
    return;
  } catch { console.warn('[application-context] creative snapshot failed; application already saved'); }
  try { await input.update({ CR素材状態: status }); } catch { console.error('[application-context] snapshot status update failed'); }
}
