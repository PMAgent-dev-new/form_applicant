/** Server-only read of the existing PM Agent CR master. Never writes records or uploads files. */
export type CatalogCreative = { crId: string; recordUrl: string; imageUrl: string; copy: string; adName: string };
export type CatalogLookup = { matches: CatalogCreative[]; status: 'matched' | 'ambiguous' | 'missing' | 'unavailable' | 'not_configured' };
export type CatalogResolver = (adId: string) => Promise<CatalogLookup>;
const APP = 'APnDb8XOWasQuhsqC0cjt3o9pqb', TABLE = 'tblU576veqObvvs6';
const baseUrl = `https://ipef3glqb1t.jp.larksuite.com/base/${APP}?table=${TABLE}`;
const text = (v: unknown, max = 3000): string => (typeof v === 'string' ? v : Array.isArray(v)
  ? v.map(x => x && typeof x === 'object' && 'text' in x && typeof x.text === 'string' ? x.text : '').join('') : '').trim().slice(0, max);
const safeLink = (v: unknown): string => {
  const raw = typeof v === 'object' && v !== null && 'link' in v ? v.link : v;
  try { const u = new URL(text(raw, 3000)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
};
export async function lookupCatalogCreative(input: { adId: string; domain: string; token: string }): Promise<CatalogLookup> {
  if (!/^\d{5,32}$/.test(input.adId)) return { matches: [], status: 'missing' };
  try {
    const origin = new URL(input.domain).origin;
    if (origin !== 'https://open.larksuite.com') return { matches: [], status: 'unavailable' };
    const response = await fetch(`${origin}/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/search?page_size=100`, {
      method: 'POST', headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_names: ['CR-ID', 'ad_id', '画像URL', 'コピー案', 'Meta広告名(CR-ID先頭必須)'],
        filter: { conjunction: 'and', conditions: [{ field_name: 'ad_id', operator: 'contains', value: [input.adId] }] } }),
      signal: AbortSignal.timeout(2500), redirect: 'error',
    });
    const data = await response.json() as { code?: number; data?: { has_more?: boolean; items?: { record_id: string; fields: Record<string, unknown> }[] } };
    if (!response.ok || data.code !== 0 || !Array.isArray(data.data?.items)) return { matches: [], status: 'unavailable' };
    const matches = data.data.items.filter(r => /^rec[a-zA-Z0-9]+$/.test(r.record_id)
      && (text(r.fields?.ad_id, 10000).match(/\b\d{5,32}\b/g) || []).some(id => id === input.adId)).map(r => ({
        crId: text(r.fields['CR-ID'], 100), recordUrl: `${baseUrl}&record=${r.record_id}`,
        imageUrl: safeLink(r.fields['画像URL']), copy: text(r.fields['コピー案']), adName: text(r.fields['Meta広告名(CR-ID先頭必須)'], 200),
      }));
    return { matches: matches.slice(0, 3), status: data.data.has_more || matches.length > 1 ? 'ambiguous' : matches.length ? 'matched' : 'missing' };
  } catch { return { matches: [], status: 'unavailable' }; }
}

/** Bound credentials + master lookup together; a missing master never holds up intake. */
export async function resolveCatalogWithinBudget(resolver: CatalogResolver | undefined, adId: string): Promise<CatalogLookup> {
  if (!resolver) return { matches: [], status: 'not_configured' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([resolver(adId), new Promise<CatalogLookup>(resolve => {
      timer = setTimeout(() => resolve({ matches: [], status: 'unavailable' }), 3500);
    })]);
  } catch { return { matches: [], status: 'unavailable' }; }
  finally { if (timer) clearTimeout(timer); }
}
