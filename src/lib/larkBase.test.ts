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
