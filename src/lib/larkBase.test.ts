import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV = {
  APP_ID_LIFTJOB: 'cli-test',
  APP_SECRET_LIFTJOB: 'secret-test',
  APP_TOKEN_LIFTJOB: 'app-test',
  LARK_DOMAIN_LIFTJOB: 'https://open.larksuite.com',
};

function stubEnv() {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
}

describe('Lark Base submission_id upsert', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('未登録のsubmission_idは検索後に1件作成する', async () => {
    stubEnv();
    const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      if (url.includes('/records/search')) {
        const body = JSON.parse(init?.body as string);
        expect(body.filter.conditions[0]).toEqual({
          field_name: 'submission_id',
          operator: 'is',
          value: ['submission-1'],
        });
        return Response.json({ code: 0, data: { items: [] } });
      }
      if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
        expect(new URL(url).searchParams.get('client_token')).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const body = JSON.parse(init.body as string);
        expect(body.fields).toMatchObject({ submission_id: 'submission-1', 求職者名: 'E2Eテスト' });
        return Response.json({ code: 0, data: { record: { record_id: 'rec-created' } } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { upsertBaseRecordByTextField } = await import('./larkBase');
    const result = await upsertBaseRecordByTextField(
      'tbl-test',
      'submission_id',
      'submission-1',
      { submission_id: 'submission-1', 求職者名: 'E2Eテスト' },
      'liftjob',
    );
    expect(result).toEqual({ recordId: 'rec-created', created: true, previousFields: {} });
  });

  it('既存のsubmission_idは同じrecord_idを更新し、前回の通知状態を返す', async () => {
    stubEnv();
    const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      if (url.includes('/records/search')) {
        return Response.json({
          code: 0,
          data: { items: [{ record_id: 'rec-existing', fields: { Lark通知送信済み: true } }] },
        });
      }
      if (url.endsWith('/records/rec-existing') && init?.method === 'PUT') {
        return Response.json({ code: 0 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { upsertBaseRecordByTextField } = await import('./larkBase');
    const result = await upsertBaseRecordByTextField(
      'tbl-test',
      'submission_id',
      'submission-1',
      { submission_id: 'submission-1', 求職者名: '再送' },
      'liftjob',
    );
    expect(result).toEqual({
      recordId: 'rec-existing',
      created: false,
      previousFields: { Lark通知送信済み: true },
    });
  });

  it('再送時は既存レコードを更新せず通知済み状態だけを返せる', async () => {
    stubEnv();
    const fetchSpy = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      if (url.includes('/records/search')) {
        return Response.json({
          code: 0,
          data: { items: [{ record_id: 'rec-existing', fields: { 対応履歴メモ: '[lark_notified:submission-1]' } }] },
        });
      }
      throw new Error(`unexpected write on retry: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { upsertBaseRecordByTextField } = await import('./larkBase');
    await expect(upsertBaseRecordByTextField(
      'tbl-test',
      '対応履歴メモ',
      '[submission_id:submission-1]',
      { 対応履歴メモ: '[submission_id:submission-1]' },
      'liftjob',
      'contains',
      false,
    )).resolves.toEqual({
      recordId: 'rec-existing',
      created: false,
      previousFields: { 対応履歴メモ: '[lark_notified:submission-1]' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('同時作成でclient_tokenが競合したら勝者レコードを再検索する', async () => {
    stubEnv();
    let searchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      if (url.includes('/records/search')) {
        searchCount += 1;
        return Response.json({
          code: 0,
          data: { items: searchCount === 1 ? [] : [{ record_id: 'rec-winner', fields: { submission_id: 'submission-race' } }] },
        });
      }
      if (new URL(url).pathname.endsWith('/records')) {
        return Response.json({ code: 1254608, msg: 'client token duplicate' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const { upsertBaseRecordByTextField } = await import('./larkBase');
    await expect(upsertBaseRecordByTextField(
      'tbl-test',
      'submission_id',
      'submission-race',
      { submission_id: 'submission-race' },
      'liftjob',
      'is',
      false,
    )).resolves.toEqual({
      recordId: 'rec-winner',
      created: false,
      previousFields: { submission_id: 'submission-race' },
    });
  });

  it('同じsubmission_idが複数ある場合は上書きしない', async () => {
    stubEnv();
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      return Response.json({
        code: 0,
        data: { items: [{ record_id: 'rec-1' }, { record_id: 'rec-2' }] },
      });
    }));
    const { upsertBaseRecordByTextField } = await import('./larkBase');
    await expect(
      upsertBaseRecordByTextField(
        'tbl-test',
        'submission_id',
        'duplicate',
        { submission_id: 'duplicate' },
        'liftjob',
      ),
    ).rejects.toThrow('複数件');
  });

  it('既存メモ列に含まれるsubmission markerでも検索できる', async () => {
    stubEnv();
    const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      if (url.includes('/records/search')) {
        const body = JSON.parse(init?.body as string);
        expect(body.filter.conditions[0]).toEqual({
          field_name: '対応履歴メモ',
          operator: 'contains',
          value: ['[submission_id:submission-2]'],
        });
        return Response.json({ code: 0, data: { items: [] } });
      }
      return Response.json({ code: 0, data: { record: { record_id: 'rec-created' } } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { upsertBaseRecordByTextField } = await import('./larkBase');
    await upsertBaseRecordByTextField(
      'tbl-test',
      '対応履歴メモ',
      '[submission_id:submission-2]',
      { 対応履歴メモ: '[submission_id:submission-2]' },
      'liftjob',
      'contains',
    );
  });

  it('検索時にtenant tokenが失効していたら更新して1度だけ再試行する', async () => {
    stubEnv();
    let authCount = 0;
    let searchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        authCount += 1;
        return Response.json({ code: 0, tenant_access_token: `token-${authCount}`, expire: 7200 });
      }
      if (url.includes('/records/search')) {
        searchCount += 1;
        if (searchCount === 1) return Response.json({ code: 99991663, msg: 'token expired' });
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-2');
        return Response.json({ code: 0, data: { items: [] } });
      }
      if (new URL(url).pathname.endsWith('/records')) {
        return Response.json({ code: 0, data: { record: { record_id: 'rec-after-refresh' } } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const { upsertBaseRecordByTextField } = await import('./larkBase');
    await expect(upsertBaseRecordByTextField(
      'tbl-test',
      'submission_id',
      'submission-refresh',
      { submission_id: 'submission-refresh' },
      'liftjob',
    )).resolves.toMatchObject({ recordId: 'rec-after-refresh', created: true });
    expect({ authCount, searchCount }).toEqual({ authCount: 2, searchCount: 2 });
  });
});

describe('Lark IM idempotent send', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uuidを衝突しにくい50文字のハッシュにして送信する', async () => {
    stubEnv();
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input).includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      const body = JSON.parse(String(init?.body));
      expect(body.uuid).toBe(createHash('sha256').update('x'.repeat(80)).digest('hex').slice(0, 50));
      expect(body.receive_id).toBe('oc_test');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ code: 0, data: { message_id: 'om_test' } });
    }));

    const { sendLarkTextMessage } = await import('./larkBase');
    await expect(sendLarkTextMessage('oc_test', 'test', 'x'.repeat(80), 'liftjob'))
      .resolves.toMatchObject({ ok: true, messageId: 'om_test' });
  });

  it('通信結果不明はWebhookへ即時フォールバックしない判定を返す', async () => {
    stubEnv();
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      if (String(input).includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      throw new DOMException('timed out', 'TimeoutError');
    }));

    const { sendLarkTextMessage } = await import('./larkBase');
    await expect(sendLarkTextMessage('oc_test', 'test', 'submission-1', 'liftjob'))
      .resolves.toMatchObject({ ok: false, status: 0, ambiguous: true });
  });
});

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

describe('findRecentRecordByPhone（Webhook経路の重複止血）', () => {
  const WINDOW = 60 * 60 * 1000;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.useRealTimers();
  });

  // 検索が返すレコードを与えて findRecentRecordByPhone を呼ぶ。検索リクエストも記録する。
  async function run(items: Array<{ record_id: string; fields: Record<string, unknown> }>) {
    for (const [key, value] of Object.entries({
      APP_ID_RIDEJOB: 'cli-test',
      APP_SECRET_RIDEJOB: 'secret-test',
      APP_TOKEN_RIDEJOB: 'app-test',
    })) vi.stubEnv(key, value);
    const searches: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
      }
      if (url.includes('/records/search')) {
        searches.push({ url, body: JSON.parse(init?.body as string) });
        return Response.json({ code: 0, data: { items } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const { findRecentRecordByPhone } = await import('./larkBase');
    const hit = await findRecentRecordByPhone('tbl-test', '09012345678', WINDOW, 'ridejob');
    return { hit, searches };
  }

  it('新しい順に十分な件数を引く（同じ人が何行もある前提）', async () => {
    // 2026-09-23 の実測で1人15行まで出た。page_size=2・無ソートだと
    // 行が多い人＝いちばん止めたい人ほど重複判定が空振りする。
    const { searches } = await run([]);
    expect(new URL(searches[0].url).searchParams.get('page_size')).toBe('20');
    expect(searches[0].body.sort).toEqual([{ field_name: '応募日', desc: true }]);
    expect((searches[0].body.filter as { conditions: unknown[] }).conditions[0]).toEqual({
      field_name: '電話番号',
      operator: 'is',
      value: ['09012345678'],
    });
  });

  it('窓の中に1行でもあれば重複とみなす', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const now = Date.now();
    const { hit } = await run([
      { record_id: 'rec-old', fields: { 応募日: now - 5 * WINDOW } },
      { record_id: 'rec-recent', fields: { 応募日: now - 10 * 60 * 1000, 対応履歴メモ: '営業の記入' } },
    ]);
    expect(hit?.recordId).toBe('rec-recent');
    // 書き戻しの可否を判断するため、呼び出し元にメモを返すこと（PUT は列を置換するので消してはいけない）。
    expect(hit?.fields['対応履歴メモ']).toBe('営業の記入');
  });

  it('窓の外だけなら重複としない（別の応募として通す）', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const now = Date.now();
    const { hit } = await run([
      { record_id: 'rec-a', fields: { 応募日: now - WINDOW - 1000 } },
      { record_id: 'rec-b', fields: { 応募日: now - 3 * WINDOW } },
    ]);
    expect(hit).toBeNull();
  });

  it('応募日が読めない行は重複としない（作る側に倒す）', async () => {
    // 判定できないことを理由に応募を握りつぶすと、止血のはずが欠落になる。
    const { hit } = await run([
      { record_id: 'rec-x', fields: {} },
      { record_id: 'rec-y', fields: { 応募日: '2026-09-23' } },
      { record_id: 'rec-z', fields: { 応募日: 0 } },
    ]);
    expect(hit).toBeNull();
  });

  it('電話番号が空なら検索そのものをしない', async () => {
    for (const [key, value] of Object.entries({
      APP_ID_RIDEJOB: 'cli-test',
      APP_SECRET_RIDEJOB: 'secret-test',
      APP_TOKEN_RIDEJOB: 'app-test',
    })) vi.stubEnv(key, value);
    const fetchSpy = vi.fn(async () => Response.json({ code: 0, data: { items: [] } }));
    vi.stubGlobal('fetch', fetchSpy);
    const { findRecentRecordByPhone } = await import('./larkBase');
    expect(await findRecentRecordByPhone('tbl-test', '  ', WINDOW, 'ridejob')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
