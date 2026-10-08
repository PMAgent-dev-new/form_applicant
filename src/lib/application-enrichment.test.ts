import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichApplication, applicantRemarks, applicationDetailsWithRemarks, applicationNotificationText } from './application-enrichment';
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
  it('shows remarks before long creative copy can exhaust the notification budget', async () => {
    const e = await enrichApplication(touch, {}, now);
    e.creativeText = '広告文'.repeat(10000); e.lines[e.lines.length - 1] = e.creativeText;
    const lines = applicationDetailsWithRemarks(e, { remarks: '休日を確認したい' });
    expect(applicationNotificationText(lines)).toContain('応募時備考: 休日を確認したい');
  });
});
describe('existing CR master references', () => {
  const cr = { crId: 'CR-test', recordUrl: 'https://example.com/cr', imageUrl: 'https://example.com/image', copy: '原稿', adName: '台帳名' };
  it('preserves master link and draft copy when Meta is unavailable, without downloading or uploading images', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const resolve = vi.fn().mockResolvedValue({ status: 'matched', matches: [cr] });
    const e = await enrichApplication(touch, {}, now, resolve);
    expect(resolve).toHaveBeenCalledWith(ad.id); expect(f).not.toHaveBeenCalled();
    expect(e.creativeText).toContain('CR台帳リンク: https://example.com/cr');
    expect(e.creativeText).toContain('CR台帳コピー案（配信本文と一致するとは限りません）: 原稿');
    expect(e.lines.join('\n')).not.toContain('保存待ち');
  });
  it('shows multiple matches as candidates and does not select one CR', async () => {
    const e = await enrichApplication(touch, {}, now, async () => ({ status: 'ambiguous', matches: [cr, { ...cr, crId: 'CR-other' }] }));
    expect(e.creativeText).toContain('対象CRは未確定'); expect(e.creativeText).toContain('CR台帳候補: CR-other');
  });
  it('keeps intake and Meta copy working when the master throws', async () => {
    vi.stubEnv('META_ACCESS_TOKEN', 'test-token'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(ad)));
    const e = await enrichApplication(touch, {}, now, async () => { throw new Error('secret'); });
    expect(e.creativeText).toContain('台帳参照失敗'); expect(e.creativeText).toContain('本文\n2行目'); expect(e.creativeText).not.toContain('secret');
  });
  it('does not query the master with internal CTA ids or unresolved ad ids', async () => {
    const resolve = vi.fn(); await enrichApplication({}, { source: 'ridejob_media', content: 'article1' }, now, resolve);
    expect(resolve).not.toHaveBeenCalled();
  });
});
