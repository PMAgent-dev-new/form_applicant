import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createBaseRecord のリンク解決の失敗', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('例外で失敗したら、そのフィールドを省略してレコードを作り、例外は1行の文字列（describeError）でログに出す', async () => {
    vi.stubEnv('APP_ID_RIDEJOB', 'cli_test');
    vi.stubEnv('APP_SECRET_RIDEJOB', 'test-secret');
    vi.stubEnv('APP_TOKEN_RIDEJOB', 'bascnTest');
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const fetchSpy: ReturnType<typeof vi.fn> = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/tenant_access_token/')) {
        return jsonResponse({ code: 0, tenant_access_token: 't-test', expire: 7200 });
      }
      // リンク先テーブルを調べるためのフィールド一覧の取得を、通信エラーにする
      if (url.includes('/fields')) throw new TypeError('fetch failed', { cause });
      return jsonResponse({ code: 0 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // トークンとマスタの一覧はモジュール内にキャッシュされるので、読み直してから使う。
    vi.resetModules();
    const { createBaseRecord } = await import('./larkBase');

    await expect(
      createBaseRecord('tblTest', { 流入元: 'google', 応募経由: { linkedRecordName: 'google(ad)' } }, 'ridejob'),
    ).resolves.toBeUndefined();

    expect(errorSpy.mock.calls).toEqual([
      ['Lark Base リンク解決に失敗したため「応募経由」を省略します:', 'TypeError: fetch failed cause=ECONNRESET'],
    ]);
    const recordCall = fetchSpy.mock.calls.find((call) => String(call[0]).endsWith('/tables/tblTest/records'));
    expect(recordCall, 'レコード作成が呼ばれていない').toBeTruthy();
    expect(JSON.parse((recordCall![1] as RequestInit).body as string).fields).toEqual({ 流入元: 'google' });
  });
});
