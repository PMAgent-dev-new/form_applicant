/** Shared wire contract: keep this file identical in form_applicant/newmedia/jobmadley. */
export type CampaignTouch = {
  source: string; medium?: string; campaign?: string; content?: string; term?: string;
  id?: string; creative?: string; at: string; landing?: string; referrer?: string;
};
export type ApplicationContext = {
  acquisition?: CampaignTouch;
  entry?: { source: string; medium?: string; url?: string; at: string };
  article?: { id: string; title?: string; url?: string; at?: string };
  truncated?: boolean;
};

export const APPLICATION_CONTEXT_COOKIE = 'rj_application_context';
export const CONTEXT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const INTERNAL_SOURCES = new Set(['ridejob_media', 'ridejob', 'ridejob_hp']);
const SITE_HOSTS = new Set(['ridejob.jp', 'www.ridejob.jp', 'ridejob.pmagent.jp']);
const text = (v: unknown, max = 160): string => typeof v === 'string' ? v.trim().slice(0, max) : '';
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const validAt = (v: unknown, now: number): string => {
  const s = text(v, 32), n = Date.parse(s);
  return Number.isFinite(n) && n <= now + 300000 && n >= now - CONTEXT_WINDOW_MS ? s : '';
};
export const isInternalSource = (v?: string): boolean => INTERNAL_SOURCES.has((v || '').toLowerCase());

/** Strip query/hash, credentials and foreign origins; never retain arbitrary form query values. */
export function siteUrl(v: unknown): string | undefined {
  if (!text(v, 2000)) return undefined;
  try {
    const u = new URL(text(v, 2000), 'https://ridejob.jp');
    if (u.protocol !== 'https:' || !SITE_HOSTS.has(u.hostname) || u.username || u.password) return undefined;
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch { return undefined; }
}

const referrerOrigin = (v: unknown): string | undefined => {
  try { const u = new URL(text(v, 1000)); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.origin : undefined; }
  catch { return undefined; }
};

export function normalizeApplicationContext(value: unknown, now = Date.now()): ApplicationContext {
  const raw = object(value), a = object(raw.acquisition), e = object(raw.entry), p = object(raw.article);
  const at = validAt(a.at, now), entryAt = validAt(e.at, now);
  const source = text(a.source, 80), entrySource = text(e.source, 80), articleId = text(p.id, 128);
  return {
    ...(source && at && !isInternalSource(source) ? { acquisition: {
      source, medium: text(a.medium, 80) || undefined, campaign: text(a.campaign) || undefined,
      content: text(a.content) || undefined, term: text(a.term) || undefined,
      id: /^\d{5,32}$/.test(text(a.id, 32)) ? text(a.id, 32) : undefined,
      creative: text(a.creative) || undefined, at,
      landing: siteUrl(a.landing), referrer: referrerOrigin(a.referrer),
    } } : {}),
    ...(entrySource && entryAt ? { entry: { source: entrySource, medium: text(e.medium, 80) || undefined, url: siteUrl(e.url), at: entryAt } } : {}),
    ...(articleId && /^[\w-]+$/.test(articleId) && entryAt ? { article: { id: articleId, title: text(p.title, 180) || undefined, url: siteUrl(p.url), at: validAt(p.at, now) || undefined } } : {}),
    ...(raw.truncated === true ? { truncated: true } : {}),
  };
}

export function readApplicationContext(now = Date.now()): ApplicationContext {
  if (typeof document === 'undefined') return {};
  try {
    const prefix = `${APPLICATION_CONTEXT_COOKIE}=`;
    const raw = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith(prefix));
    return raw ? normalizeApplicationContext(JSON.parse(decodeURIComponent(raw.slice(prefix.length))), now) : {};
  } catch { return {}; }
}

const referrerTouch = (referrer: string, now: string): CampaignTouch | undefined => {
  try {
    const u = new URL(referrer);
    if (!['https:', 'http:'].includes(u.protocol) || SITE_HOSTS.has(u.hostname)) return undefined;
    const host = u.hostname.toLowerCase();
    const engine = /(^|\.)google\./.test(host) ? 'google' : /(^|\.)yahoo\./.test(host) ? 'yahoo' : /(^|\.)bing\.com$/.test(host) ? 'bing' : undefined;
    return { source: engine || host, medium: engine ? 'organic' : 'referral', at: now, referrer: u.origin };
  } catch { return undefined; }
};

/** Independent acquisition cookie: internal UTM must not replace the preceding external touch. */
export function captureApplicationContext(input: {
  search: string; url: string; referrer: string; title?: string; now?: number; allowReferrer?: boolean;
}, previous = readApplicationContext(input.now)): ApplicationContext {
  const now = input.now ?? Date.now(), at = new Date(now).toISOString();
  const p = new URLSearchParams(input.search), source = text(p.get('utm_source'), 80);
  const current = normalizeApplicationContext(previous, now);
  let next: ApplicationContext = { ...current };
  const pick = (key: string) => text(p.get(key)) || undefined;
  if (source && !isInternalSource(source)) {
    next = { acquisition: { source, medium: pick('utm_medium'), campaign: pick('utm_campaign'),
      content: pick('utm_content'), term: pick('utm_term'), id: pick('utm_id'), creative: pick('utm_creative'),
      at, landing: siteUrl(input.url), referrer: referrerTouch(input.referrer, at)?.referrer } };
  } else if (!source && (p.get('gclid') || p.get('oppref') || p.get('fbclid'))) {
    // fbclid is also used by organic Facebook links; it is not proof of a paid ad.
    next = { acquisition: { source: p.get('gclid') ? 'google' : p.get('oppref') ? 'chatgpt' : 'facebook',
      medium: p.get('gclid') || p.get('oppref') ? 'cpc' : 'unknown', at, landing: siteUrl(input.url) } };
  } else if (!source && input.allowReferrer !== false) {
    const external = referrerTouch(input.referrer, at);
    if (external) next = { acquisition: { ...external, landing: siteUrl(input.url) } };
  }
  if (source && isInternalSource(source)) {
    next.entry = { source, medium: pick('utm_medium'), url: siteUrl(input.url), at };
    const id = text(p.get('rj_article_id') || (source === 'ridejob_media' ? p.get('utm_content') : ''), 128);
    const priorArticle = current.article?.id === id ? current.article : undefined;
    if (id) next.article = { id, title: text(p.get('rj_article_title'), 180) || priorArticle?.title,
      url: siteUrl(p.get('rj_article_url')) || priorArticle?.url || `https://ridejob.jp/media/blog/${encodeURIComponent(id)}`, at: priorArticle?.at };
    else delete next.article;
  }
  try {
    const u = new URL(input.url);
    const match = u.pathname.match(/^\/media\/blog\/([\w-]+)\/?$/);
    if (match && !['preview', 'category', 'page'].includes(match[1])) {
      next.entry = { source: 'ridejob_media', medium: 'article_view', url: siteUrl(input.url), at };
      next.article = { id: match[1], title: text(input.title, 180), url: siteUrl(input.url), at };
    }
  } catch { /* Bad URL must not affect form submission. */ }
  next = normalizeApplicationContext(next, now);
  if (typeof document !== 'undefined') {
    try {
      let encoded = encodeURIComponent(JSON.stringify(next));
      if (encoded.length > 3500) {
        next = { ...next, truncated: true, article: next.article ? { ...next.article, title: undefined } : undefined,
          acquisition: next.acquisition ? { ...next.acquisition, campaign: undefined, content: undefined, term: undefined, creative: undefined } : undefined };
        encoded = encodeURIComponent(JSON.stringify(next));
      }
      if (encoded.length > 3800) {
        next = { ...next, truncated: true, acquisition: next.acquisition ? {
          source: next.acquisition.source, medium: next.acquisition.medium, id: next.acquisition.id, at: next.acquisition.at,
        } : undefined, entry: next.entry ? { ...next.entry, url: undefined } : undefined,
          article: next.article ? { id: next.article.id } : undefined };
        encoded = encodeURIComponent(JSON.stringify(next));
      }
      if (encoded.length <= 3800) document.cookie = `${APPLICATION_CONTEXT_COOKIE}=${encoded}; path=/; max-age=${30 * 86400}; SameSite=Lax; Secure`;
    } catch { /* Cookie rejection must not block the application. */ }
  }
  return next;
}

export function applicationContextLines(value: unknown, now = Date.now()): string[] {
  const c = normalizeApplicationContext(value, now);
  const mediaTouch = c.entry?.source.toLowerCase() === 'ridejob_media';
  const media = mediaTouch && c.entry?.medium !== 'article_view';
  const sourceNames: Record<string, string> = { fb: 'Facebook', facebook: 'Facebook', ig: 'Instagram', instagram: 'Instagram',
    meta: 'Meta', google: 'Google', yahoo: 'Yahoo!', bing: 'Bing', chatgpt: 'ChatGPT', '{{site_source_name}}': 'Meta（掲載面未確定）' };
  const mediumNames: Record<string, string> = { cpc: '広告', ppc: '広告', paid: '広告', paid_social: '広告',
    organic: '自然流入', referral: '外部リンク', unknown: '広告・自然流入の区別は未確認' };
  const a = c.acquisition;
  const rawSource = a ? [a.source, a.medium].filter(Boolean).join(' / ') : '';
  const medium = a?.medium?.toLowerCase() === 'organic' && ['google', 'yahoo', 'bing'].includes(a.source.toLowerCase())
    ? '自然検索' : a?.medium ? mediumNames[a.medium.toLowerCase()] || a.medium : undefined;
  const source = a ? [sourceNames[a.source.toLowerCase()] || a.source, medium].filter(Boolean).join(' / ') : '';
  const displayedSource = a ? `${source}（計測値: ${rawSource}）` : '未特定（広告・自然検索の区別は未確認）';
  // Historical acquisition is not evidence of this article visit's source, even for the same URL.
  const articleSourceConfirmed = Boolean(a && c.article?.at && c.article.url && a.landing === c.article.url
    && a.at === c.article.at && c.entry && Date.parse(c.article.at) <= Date.parse(c.entry.at));
  return [
    `応募経路: ${media ? 'メディア経由' : mediaTouch ? '未特定（メディア記事の閲覧のみ確認）'
      : c.entry && isInternalSource(c.entry.source) ? 'RIDE JOBサイト経由' : '未特定（メディア経由か未確認）'}`,
    media || c.article ? `記事流入元: ${articleSourceConfirmed ? displayedSource : '未特定（今回の記事到着時の流入元を確認できる計測情報なし）'}` : '',
    `集客元（直近確認）: ${displayedSource}`,
    a ? `集客元の確認範囲: 過去30日以内の直近の確認済み接触${(media || c.article) && !articleSourceConfirmed ? '。今回の記事への流入元と一致するとは限りません' : ''}` : '',
    c.acquisition ? `集客接触日時: ${c.acquisition.at}` : '',
    c.acquisition?.landing ? `初期着地: ${c.acquisition.landing}` : '',
    c.entry ? `応募導線: ${[c.entry.source, c.entry.medium].filter(Boolean).join(' / ')}` : '',
    c.entry ? `導線接触日時: ${c.entry.at}` : '',
    c.article ? `元記事: ${c.article.title || c.article.id}` : '',
    c.article?.url ? `記事URL: ${c.article.url}` : '',
    c.article?.at ? `記事接触日時: ${c.article.at}` : '',
    c.truncated ? '計測補足: 長い項目を一部省略' : '',
  ].filter(Boolean);
}
