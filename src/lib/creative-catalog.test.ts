import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupCatalogCreative, resolveCatalogWithinBudget } from './creative-catalog';
const input = { adId: '52644612217439', domain: 'https://open.larksuite.com', token: 'test-token' };
const record = (id = 'recExact', adId = input.adId) => ({ record_id: id, fields: { ad_id: [{ text: adId, type: 'text' }],
  'CR-ID': [{ text: 'CR-test', type: 'text' }], '画像URL': { link: 'https://example.com/image', text: 'image' }, 'コピー案': [{ text: '原稿\n2行目', type: 'text' }] } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('existing CR master lookup', () => {
  it('matches only complete ad ids including a multi-id cell and returns a master record link', async () => {
    const f = vi.fn().mockResolvedValue(Response.json({ code: 0, data: { has_more: false, items: [record('recExact', `999999, ${input.adId}`), record('recPrefix', `${input.adId}0`)] } })); vi.stubGlobal('fetch', f);
    const result = await lookupCatalogCreative(input);
    expect(result.status).toBe('matched'); expect(result.matches).toHaveLength(1);
    expect(result.matches[0].recordUrl).toContain('&record=recExact'); expect(result.matches[0].copy).toBe('原稿\n2行目');
    const body = JSON.parse(f.mock.calls[0][1].body as string);
    expect(body.filter.conditions).toEqual([{ field_name: 'ad_id', operator: 'contains', value: [input.adId] }]);
    expect(body.field_names).not.toContain('ブリーフ');
  });
  it('does not pretend duplicate or incomplete search results identify a unique CR', async () => {
    const f = vi.fn().mockResolvedValueOnce(Response.json({ code: 0, data: { items: [record(), record('recSecond')] } }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { items: [record()], has_more: true } })); vi.stubGlobal('fetch', f);
    expect((await lookupCatalogCreative(input)).status).toBe('ambiguous'); expect((await lookupCatalogCreative(input)).status).toBe('ambiguous');
  });
  it('makes missing records, rejected access and network failure visible without throwing', async () => {
    const f = vi.fn().mockResolvedValueOnce(Response.json({ code: 0, data: { items: [] } }))
      .mockResolvedValueOnce(Response.json({ code: 1254302 })).mockRejectedValueOnce(new Error('secret')); vi.stubGlobal('fetch', f);
    expect((await lookupCatalogCreative(input)).status).toBe('missing'); expect((await lookupCatalogCreative(input)).status).toBe('unavailable');
    expect((await lookupCatalogCreative(input)).status).toBe('unavailable');
  });
  it('never sends a token to a foreign host or queries an unvalidated ad id', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await lookupCatalogCreative({ ...input, domain: 'https://evil.example' }); await lookupCatalogCreative({ ...input, adId: '{{ad.id}}' });
    expect(f).not.toHaveBeenCalled();
  });
  it('bounds master credentials and lookup together', async () => {
    vi.useFakeTimers(); const pending = resolveCatalogWithinBudget(() => new Promise(() => {}), input.adId);
    await vi.advanceTimersByTimeAsync(3501); expect((await pending).status).toBe('unavailable');
  });
});
