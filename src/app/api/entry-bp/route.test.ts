import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 2026-09-24: このルートは Base 未設定かつ Webhook 未設定のとき、何も残さずに
// `{ ok: true }` を返していた。申込が無音で消える形（2026-09-17〜24 の障害と同じ型）。
// Base 登録失敗時も通知の手前で 502 を返しており、そこでも申込は残らなかった。

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  SUBMISSION_VAULT_URL: 'https://tdlnowmdanapxmgebaqu.supabase.co',
  SUBMISSION_VAULT_SERVICE_KEY: 'test-vault-key',
};

function makeRequest() {
  const form = new FormData();
  form.set('name', '武田 喜一');
  form.set('email', 'bp-test@example.com');
  form.set('tel', '090-1234-5678');
  form.set('area', '東京都');
  return new Request('https://ridejob.jp/entry/gulliver/newgraduate', { method: 'POST', body: form });
}

describe('entry-bp POST — 申込をどこにも残さない経路を作らない', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    for (const [k, v] of Object.entries(BASE_ENV)) vi.stubEnv(k, v);
    // Base の認証と通知先は未設定＝本番で env が欠けた状態
    for (const k of ['APP_ID_MECHANIC', 'APP_SECRET_MECHANIC', 'APP_TOKEN_MECHANIC',
      'LARK_WEBHOOK_URL_GULLIVER_BP_PROD', 'LARK_WEBHOOK_URL_GULLIVER_BP',
      'LARK_WEBHOOK_URL_MECHANIC_PROD', 'LARK_WEBHOOK_URL_MECHANIC_TEST',
      'LARK_WEBHOOK_URL_MECHANIC', 'LARK_WEBHOOK_URL']) vi.stubEnv(k, '');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      if (String(input).includes('/rest/v1/submission_vault')) return new Response('', { status: 201 });
      return new Response('{}', { status: 200 });
    }) as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Base も通知先も未設定なら、申込を退避に残して通す', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await import('./route');
    const res = await POST(makeRequest());

    expect(res.status, '退避に残っているので再送させない').toBe(200);
    const vaultPosts = fetchSpy.mock.calls.filter(
      ([target, init]) => String(target).includes('/rest/v1/submission_vault')
        && (init as RequestInit)?.method === 'POST',
    );
    expect(vaultPosts.length, '設定漏れで申込を捨てないこと').toBe(1);
    const body = JSON.parse(String((vaultPosts[0][1] as RequestInit)?.body ?? '{}'));
    expect(body.submission_id, '冪等キーが無いと取り込み時に重複する').toBeTruthy();
    expect(body.payload?.email, '連絡先が無いと退避しても意味がない').toBe('bp-test@example.com');
    warnSpy.mockRestore();
  });

  it('Base も通知先も未設定で退避にも失敗したら 502（どこにも残らないため）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async () => new Response('boom', { status: 503 }));

    const { POST } = await import('./route');
    const res = await POST(makeRequest());

    // 修正前はここが 200。申込は無音で消えていた。
    expect(res.status, 'どこにも残らないのに成功を返さないこと').toBe(502);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('Base が未設定でも、通知が出せたなら申込は通す', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('LARK_WEBHOOK_URL_GULLIVER_BP_PROD', 'https://open.larksuite.com/open-apis/bot/v2/hook/bp');
    fetchSpy.mockImplementation(async (input: unknown) => {
      if (String(input).includes('/rest/v1/submission_vault')) return new Response('boom', { status: 503 });
      return Response.json({ code: 0 });
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest());

    expect(res.status, '通知が出ているので申込は通す').toBe(200);
    const notify = fetchSpy.mock.calls.find(([target]) => String(target).includes('/bot/v2/hook/'));
    expect(String((notify?.[1] as RequestInit)?.body ?? ''), 'Base に入っていないことを通知で分かるようにする')
      .toContain('Base未登録');
    warnSpy.mockRestore();
  });
});
