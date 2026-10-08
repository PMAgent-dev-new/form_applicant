import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichApplication, applicantRemarks, applicationNotificationText, saveCreativeMaterial, type ApplicationEnrichment } from './application-enrichment';
const now = Date.parse('2026-10-08T01:00:00Z');
const touch = { acquisition: { source: 'fb', medium: 'cpc', id: '52648617245839', at: new Date(now).toISOString() } };
const ad = { id: '52648617245839', account_id: '1435983094817075', name: 'CR-test', creative: { id: '111111111', body: '本文\n2行目', title: '見出し', image_url: 'https://a.fbcdn.net/a.jpg', effective_object_story_id: '12345_67890' } };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('application enrichment failure isolation and exact ad matching', () => {
  it('keeps Japanese text including its truncation notice within the byte budget', () => {
    const text = applicationNotificationText(['日本語😀'.repeat(10000)], 10000);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(10000);
    expect(text).toContain('続きはLark応募記録');
  });
  it('resolves an exact account-scoped ad and snapshots multiline copy', async () => {
    vi.stubEnv('META_ACCESS_TOKEN', 'test-token'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(ad)));
    const e = await enrichApplication(touch, {}, now);
    expect(e.creativeId).toBe('111111111'); expect(e.creativeText).toContain('本文\n2行目'); expect(e.creativeText).toContain('facebook.com/12345_67890');
    expect(e.dynamic).toBe(false);
  });
  it('rejects another account, API failure and unresolved macros without throwing', async () => {
    vi.stubEnv('META_ACCESS_TOKEN', 'test-token'); const f = vi.fn().mockResolvedValue(Response.json({ ...ad, account_id: '99999' })); vi.stubGlobal('fetch', f);
    expect((await enrichApplication(touch, {}, now)).creativeId).toBe('');
    f.mockRejectedValue(new Error('timeout secret')); expect((await enrichApplication(touch, {}, now)).creativeText).toContain('取得失敗');
    f.mockClear(); await enrichApplication({}, { source: 'meta', id: '{{ad.id}}' }, now); expect(f).not.toHaveBeenCalled();
  });
  it('never treats an internal CTA as proof of HP or as a Meta ad', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const e = await enrichApplication({}, { source: 'ridejob_media', medium: 'article_cta', content: 'article1' }, now);
    expect(e.lines.join('\n')).toContain('記事流入元: 未特定'); expect(e.lines.join('\n')).toContain('集客元（直近確認）: 未特定'); expect(e.lines.join('\n')).toContain('応募経路: メディア経由'); expect(e.lines.join('\n')).toContain('article_cta'); expect(f).not.toHaveBeenCalled();
  });
  it('labels dynamic candidates, rather than claiming a rendered combination', async () => {
    vi.stubEnv('META_ACCESS_TOKEN', 'test-token'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...ad, creative: { ...ad.creative, asset_feed_spec: { bodies: [{ text: '候補B' }] } } })));
    const e = await enrichApplication(touch, {}, now); expect(e.dynamic).toBe(true); expect(e.creativeText).toContain('未確定'); expect(e.creativeText).toContain('候補B');
  });
  it('retains and bounds existing free text, not arbitrary JSON', () => {
    expect(applicantRemarks({ note: '日産→タクシー\n休日の相談', password: 'secret' })).toEqual(['応募時備考: 日産→タクシー\n休日の相談']);
    expect(applicantRemarks({ remarks: 'a'.repeat(5000) })[0].length).toBeLessThan(2020);
  });
});
describe('durable creative attachment', () => {
  const e: ApplicationEnrichment = { adId: '12345', creativeId: '67890', imageUrl: 'https://a.fbcdn.net/a.jpg', dynamic: false, lines: [], creativeText: '', materialStatus: '素材保存待ち' };
  it('uploads into the existing Base and saves only the attachment/status columns', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })).mockResolvedValueOnce(Response.json({ code: 0, data: { file_token: 'file-token' } })); vi.stubGlobal('fetch', f);
    const update = vi.fn().mockResolvedValue(undefined);
    await saveCreativeMaterial({ enrichment: e, domain: 'https://open.larksuite.com', token: 'token', appToken: 'existing-base', update });
    expect(update).toHaveBeenCalledWith({ CR素材: [{ file_token: 'file-token' }], CR素材状態: '保存済み（動画の場合はサムネイル）' });
    const form = f.mock.calls[1][1].body as FormData; expect(form.get('parent_type')).toBe('bitable_image'); expect(form.get('parent_node')).toBe('existing-base');
  });
  it('does not fetch foreign hosts and makes failure visible without rejecting intake', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f); const update = vi.fn().mockResolvedValue(undefined);
    await saveCreativeMaterial({ enrichment: { ...e, imageUrl: 'https://evil.example/a.jpg' }, domain: 'https://open.larksuite.com', token: 'token', appToken: 'existing', update });
    expect(f).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledWith({ CR素材状態: '素材保存失敗（広告リンクで確認）' });
  });
});
