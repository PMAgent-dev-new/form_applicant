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
});
