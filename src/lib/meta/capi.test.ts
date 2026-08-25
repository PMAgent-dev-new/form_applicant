import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Meta Conversions API のペイロード形状を固定するテスト。
 *
 * 目的は「送れること」ではなく、Events Manager 側の設定が前提にしている
 * 2点をコード変更から守ること:
 *  1. custom_data.content_name — クーパンのカスタムコンバージョン
 *     「RIDEJOB_クーパン応募」は content_name が 'coupang_rocketnow' と
 *     等しいことだけをルールにしている。これが落ちるとCVが0件になる。
 *  2. event_source_url に空文字を送らない — website イベントで無効なURLを
 *     送るとイベントが破棄されうる。値が無いときはキーごと落とす。
 *
 * capi.ts は env をモジュール読み込み時に定数へ取り込むため、
 * stubEnv → resetModules → 動的 import の順で読み込む。
 */

async function loadCapi() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '1945615652686189');
  vi.stubEnv('META_CAPI_ACCESS_TOKEN', 'test-token');
  return await import('./capi');
}

/** 直近の fetch 呼び出しから送信された data[0] を取り出す。 */
function sentEvent(fetchSpy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
  const body = JSON.parse(init.body as string) as { data: Record<string, unknown>[] };
  return body.data[0];
}

describe('sendMetaCapiLead のペイロード', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('contentName を渡すと custom_data.content_name に載る', async () => {
    const { sendMetaCapiLead } = await loadCapi();
    await sendMetaCapiLead({ eventId: 'e1', contentName: 'coupang_rocketnow' });

    const event = sentEvent(fetchSpy);
    expect((event.custom_data as Record<string, unknown>).content_name).toBe('coupang_rocketnow');
  });

  it('contentName を渡さなければ content_name を送らない（他職種の Lead を巻き込まない）', async () => {
    const { sendMetaCapiLead } = await loadCapi();
    await sendMetaCapiLead({ eventId: 'e2' });

    const event = sentEvent(fetchSpy);
    expect((event.custom_data as Record<string, unknown>).content_name).toBeUndefined();
  });

  it('eventSourceUrl が空文字なら event_source_url のキーごと落とす', async () => {
    const { sendMetaCapiLead } = await loadCapi();
    await sendMetaCapiLead({ eventId: 'e3', eventSourceUrl: '' });

    const event = sentEvent(fetchSpy);
    expect('event_source_url' in event).toBe(false);
  });

  it('eventSourceUrl があればそのまま載せ、event_id と action_source も維持する', async () => {
    const { sendMetaCapiLead } = await loadCapi();
    await sendMetaCapiLead({ eventId: 'e4', eventSourceUrl: 'https://ridejob.jp/entry/coupang' });

    const event = sentEvent(fetchSpy);
    expect(event.event_source_url).toBe('https://ridejob.jp/entry/coupang');
    expect(event.event_id).toBe('e4');
    expect(event.action_source).toBe('website');
    expect(event.event_name).toBe('Lead');
  });
});
