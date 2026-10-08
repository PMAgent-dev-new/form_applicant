import { applicationContextLines, normalizeApplicationContext, isInternalSource } from './application-context';
import { resolveCatalogWithinBudget, type CatalogResolver } from './creative-catalog';

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
  lines: string[]; creativeText: string; referenceStatus: string;
  adId: string; creativeId: string; imageUrl: string; dynamic: boolean;
};
type Legacy = { source?: string; medium?: string; campaign?: string; content?: string; id?: string; creative?: string; term?: string; at?: string; landing?: string };
export async function enrichApplication(raw: unknown, legacy: Legacy = {}, now = Date.now(), resolveCatalog?: CatalogResolver): Promise<ApplicationEnrichment> {
  let context = normalizeApplicationContext(raw, now);
  if (!context.acquisition && legacy.source && !isInternalSource(legacy.source)) {
    context = normalizeApplicationContext({ ...context, acquisition: { ...legacy, at: legacy.at || new Date(now).toISOString() } }, now);
  }
  // A compact context may omit term. Only complement the same external touch;
  // never mix an internal CTA or a different campaign into the stored source.
  const prior = context.acquisition;
  const fromUrl = normalizeApplicationContext({ acquisition: { ...legacy, at: legacy.at || new Date(now).toISOString() } }, now).acquisition;
  if (prior && fromUrl && !prior.term && fromUrl.term
    && prior.source.toLowerCase() === fromUrl.source.toLowerCase()
    && prior.medium?.toLowerCase() === fromUrl.medium?.toLowerCase()
    && !(prior.campaign && fromUrl.campaign && prior.campaign !== fromUrl.campaign)
    && !(prior.id && fromUrl.id && prior.id !== fromUrl.id)
    && ((prior.id && prior.id === fromUrl.id) || (prior.campaign && prior.campaign === fromUrl.campaign))) {
    context = { ...context, acquisition: { ...prior, term: fromUrl.term } };
  }
  if (!context.entry && isInternalSource(legacy.source)) {
    context = normalizeApplicationContext({ ...context, entry: { source: legacy.source, medium: legacy.medium, at: new Date(now).toISOString(), url: legacy.landing },
      article: legacy.source === 'ridejob_media' ? { id: legacy.content } : undefined }, now);
  }
  const a = context.acquisition;
  const meta = /^(meta|facebook|instagram|fb|ig|\{\{site_source_name\}\})$/i.test(a?.source || '');
  // Legacy taxi URLs put ad.id in term while Meta may add campaign.id as id.
  // Never stop at a campaign id, and never call an adset an ad without a creative.
  const candidates = meta ? [...new Set([a?.id, a?.content, a?.creative, a?.term]
    .filter((v): v is string => /^\d{5,32}$/.test(v || '') && v !== a?.campaign))] : [];
  let candidate = candidates[0] || '';
  const result: ApplicationEnrichment = { lines: applicationContextLines(context, now), creativeText: '', referenceStatus: candidate ? '広告情報取得失敗（後日確認が必要）' : '広告IDなし・CR未特定', adId: candidate, creativeId: '', imageUrl: '', dynamic: false };
  const token = process.env.META_ACCESS_TOKEN;
  if (candidate && token) {
    const deadline = Date.now() + 2500;
    for (const adCandidate of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
    try {
      const params = new URLSearchParams({ fields: 'id,account_id,name,creative{id,name,body,title,image_url,effective_object_story_id,instagram_permalink_url,object_story_spec,asset_feed_spec,product_set_id}', access_token: token });
      const response = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v25.0'}/${adCandidate}?${params}`, { signal: AbortSignal.timeout(remaining) });
      const data = await response.json() as { id?: string; account_id?: string; name?: string; creative?: Creative; error?: { code?: number } };
      if (response.ok && !data.error && data.id === adCandidate && data.account_id === ACCOUNT_ID && data.creative && /^\d{5,32}$/.test(data.creative.id || '')) {
        candidate = adCandidate;
        result.adId = adCandidate;
        const c = data.creative, link = c.object_story_spec?.link_data, video = c.object_story_spec?.video_data;
        result.creativeId = str(c.id, 32);
        result.dynamic = !!c.product_set_id || !!c.asset_feed_spec || !!link?.child_attachments?.length;
        result.imageUrl = str(c.image_url || video?.image_url || link?.picture, 3000);
        result.referenceStatus = 'Meta広告設定を取得済み（本人の表示内容は未確定）';
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
        break;
      } else {
        console.warn('[application-context] Meta lookup rejected', { status: response.status, accountMatched: data.account_id === ACCOUNT_ID });
        // Only an unsupported object/field (100) can justify trying a different
        // legacy candidate. Auth, rate-limit and server failures are not retried.
        if ((!response.ok && data.error?.code !== 100) ||
          (data.account_id && data.account_id !== ACCOUNT_ID)) break;
      }
    } catch { console.warn('[application-context] Meta lookup unavailable; application continues'); break; }
    }
  }
  if (!result.creativeText) result.creativeText = `${result.referenceStatus}${candidate ? `\nad.id（URL申告値）: ${candidate}` : ''}`;
  const catalog = candidate ? await resolveCatalogWithinBudget(resolveCatalog, candidate) : undefined;
  if (catalog) {
    const status = { matched: '広告IDが台帳と一致', ambiguous: '複数候補／検索結果の続きあり・対象CRは未確定', missing: '台帳に広告ID一致なし', unavailable: '台帳参照失敗（後日確認が必要）', not_configured: '台帳参照未設定' }[catalog.status];
    result.referenceStatus += ` / CR台帳: ${status}`;
    const references = catalog.matches.flatMap(c => [
      `CR台帳${catalog.status === 'ambiguous' ? '候補' : ''}: ${c.crId || 'CR-ID未記入'}`, `CR台帳リンク: ${c.recordUrl}`,
      c.adName ? `台帳広告名: ${c.adName}` : '',
      c.imageUrl ? `CR素材リンク（台帳）: ${c.imageUrl}` : '',
      c.copy ? `CR台帳コピー案（配信本文と一致するとは限りません）: ${c.copy}` : '',
    ]).filter(Boolean);
    result.creativeText = [`CR参照状態: ${result.referenceStatus}`, ...references, result.creativeText].join('\n');
  }
  result.lines.push(result.creativeText);
  return result;
}

/** Only accept existing form remarks keys; never serialize arbitrary applicant JSON into notifications. */
export function applicantRemarks(raw: unknown): string[] {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return [...new Set(['remarks', 'note', 'notes', 'comment', 'comments', 'message', 'coverLetter'].map(k => str(r[k], 2000)).filter(Boolean))].slice(0, 3).map(v => `応募時備考: ${v}`);
}

/** Show applicant remarks before potentially lengthy ad copy in byte-bounded notifications. */
export function applicationDetailsWithRemarks(enrichment: ApplicationEnrichment, raw: unknown): string[] {
  return [...enrichment.lines.slice(0, -1), ...applicantRemarks(raw), enrichment.creativeText];
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
