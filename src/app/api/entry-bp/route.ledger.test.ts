import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// after() はリクエストの外では動かない。積まれた処理をテストから流して、台帳への書き込みを確かめる。
const afterTasks = vi.hoisted(() => ({ queue: [] as (() => unknown)[] }));
vi.mock('next/server', async (importActual) => ({ ...await importActual<typeof import('next/server')>(), after: (fn: () => unknown) => afterTasks.queue.push(fn) }));

/**
 * 受付台帳（Supabase submissions）の配線テスト。実物の submissionLedger を通す。
 *
 * - 受け入れた申込は、応答を返したあとに1行だけ書かれ、申込者・経路・通知・結果が入る
 * - 検証で弾いた申込と bot 判定は書かない
 * - 台帳の失敗・未設定は応答を変えない
 */

const LEDGER_URL = 'https://tdlnowmdanapxmgebaqu.supabase.co/rest/v1/submissions?on_conflict=source,submission_id';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  SUBMISSION_VAULT_URL: 'https://tdlnowmdanapxmgebaqu.supabase.co',
  SUBMISSION_VAULT_SERVICE_KEY: 'test-vault-key',
};

// Base の認証と通知先。これを足すと「設定済み」、足さなければ「未設定」になる。
const CONFIGURED_ENV: Record<string, string> = {
  APP_ID_MECHANIC: 'cli_mechanic',
  APP_SECRET_MECHANIC: 'secret_mechanic',
  APP_TOKEN_MECHANIC: 'app_mechanic',
  LARK_WEBHOOK_URL_GULLIVER_BP_PROD: 'https://open.larksuite.com/open-apis/bot/v2/hook/bp',
};

function makeRequest(fields: Record<string, string> = {}) {
  const values: Record<string, string> = {
    name: '山田 太郎',
    email: 'bp-test@example.com',
    tel: '090-1234-5678',
    area: '東京都',
    ...fields,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return new Request('https://ridejob.jp/entry/gulliver/newgraduate', {
    method: 'POST',
    headers: {
      referer: 'https://ridejob.jp/entry/gulliver/newgraduate',
      'user-agent': 'vitest',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'x-forwarded-host': 'ridejob.jp',
    },
    body: form,
  });
}

type LedgerBody = {
  source: string;
  kind: string;
  submission_id: string;
  profile: string | null;
  applicant: Record<string, unknown>;
  context: Record<string, unknown>;
  ad: Record<string, unknown>;
  notification: { text?: string; sent?: boolean; via?: string };
  outcome: Record<string, unknown>;
};

describe('entry-bp POST — 受付台帳', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  // Base・通知が通る既定の応答。台帳と退避（Supabase）は 201。
  const healthyResponse = async (input: unknown) => {
    const url = String(input);
    if (url.includes('/auth/v3/tenant_access_token')) {
      return Response.json({ code: 0, tenant_access_token: 't', expire: 7200 });
    }
    if (url.includes('/bitable/v1/apps/')) return Response.json({ code: 0, data: { record: { record_id: 'rec1' } } });
    if (url.includes('/rest/v1/')) return new Response('', { status: 201 });
    return Response.json({ code: 0 });
  };

  const ledgerCalls = () => fetchSpy.mock.calls.filter(([input]) => String(input).includes('/rest/v1/submissions'));
  const vaultPosts = () => fetchSpy.mock.calls.filter(
    ([input, init]) => String(input).includes('/rest/v1/submission_vault') && (init as RequestInit)?.method === 'POST',
  );
  const readBody = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as LedgerBody;
  const ledgerLogs = () => vi.mocked(console.error).mock.calls.filter(([first]) => String(first).startsWith('[ledger]'));

  /** 積まれた after の処理（台帳への書き込み）を流す。 */
  async function flushAfter() {
    const tasks = afterTasks.queue.splice(0);
    await Promise.all(tasks.map((task) => task()));
  }

  /** 台帳への書き込みを流し、ちょうど1回だった書き込みの中身を返す。 */
  async function recordedLedger(): Promise<LedgerBody> {
    await flushAfter();
    const calls = ledgerCalls();
    expect(calls, '台帳への書き込みは1申込につき1回').toHaveLength(1);
    return readBody(calls[0]);
  }

  function stubConfigured() {
    for (const [key, value] of Object.entries(CONFIGURED_ENV)) vi.stubEnv(key, value);
  }

  beforeEach(() => {
    afterTasks.queue = [];
    vi.resetModules();
    for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
    // 既定は Base の認証と通知先が未設定
    for (const key of ['APP_ID_MECHANIC', 'APP_SECRET_MECHANIC', 'APP_TOKEN_MECHANIC',
      'LARK_WEBHOOK_URL_GULLIVER_BP_PROD', 'LARK_WEBHOOK_URL_GULLIVER_BP',
      'LARK_WEBHOOK_URL_MECHANIC_PROD', 'LARK_WEBHOOK_URL_MECHANIC_TEST',
      'LARK_WEBHOOK_URL_MECHANIC', 'LARK_WEBHOOK_URL']) vi.stubEnv(key, '');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(healthyResponse) as unknown as ReturnType<typeof vi.fn>;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('受け入れた申込は、応答のあとに台帳へ1行だけ書き、申込者・経路・通知・結果を残す', async () => {
    stubConfigured();
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // 応答を返した時点では台帳へ書き始めていない（申込者を待たせない）
    expect(afterTasks.queue).toHaveLength(1);
    expect(ledgerCalls()).toHaveLength(0);

    await flushAfter();
    const calls = ledgerCalls();
    expect(calls, '台帳への書き込みは1申込につき1回').toHaveLength(1);
    expect(String(calls[0][0])).toBe(LEDGER_URL);
    expect((calls[0][1] as RequestInit).method).toBe('POST');
    const body = readBody(calls[0]);

    expect(body).toMatchObject({
      source: 'form_applicant/entry-bp',
      kind: 'application',
      submission_id: expect.stringMatching(/^entry-bp:[0-9a-f]{32}$/),
      profile: 'mechanic',
    });
    expect(body.applicant).toEqual({
      name: '山田 太郎',
      email: 'bp-test@example.com',
      tel: '090-1234-5678',
      area: '東京都',
    });
    expect(body.context).toEqual({
      request: {
        referer: 'https://ridejob.jp/entry/gulliver/newgraduate',
        user_agent: 'vitest',
        host: 'ridejob.jp',
      },
      environment: 'production',
    });
    // IP アドレスと Cookie の値は台帳に入れない
    expect(JSON.stringify(body)).not.toMatch(/203\.0\.113\.7|10\.0\.0\.1|fb\.1\.1700000000/);
    expect(body.ad).toEqual({});

    // 通知は実際に送った本文と同じ
    const hook = fetchSpy.mock.calls.find(([input]) => String(input).includes('/bot/v2/hook/'));
    const sentText = JSON.parse(String((hook![1] as RequestInit).body)).content.text as string;
    expect(body.notification).toEqual({ text: sentText, sent: true, via: 'webhook' });
    expect(sentText).toContain('会社説明会のお申し込みが届きました');

    // このルートはメール・SMS・CAPI を呼ばない
    expect(body.outcome).toEqual({
      notified: true,
      vaulted: false,
      email: 'skipped',
      sms: 'skipped',
      meta_capi: 'skipped',
      openai_capi: 'skipped',
      base_only: false,
      base: { ok: true, via: 'direct' },
      http_status: 200,
    });
  });

  it('Base に登録できず退避に残した申込は、vaulted と Base の失敗理由を台帳に残し、受付IDは退避と同じ', async () => {
    stubConfigured();
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/bitable/v1/apps/')
      ? Response.json({ code: 1254045, msg: 'FieldNameNotFound' })
      : healthyResponse(input));
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(vaultPosts(), 'Base に入らなかった申込は退避に残すこと').toHaveLength(1);
    const vaultBody = JSON.parse(String((vaultPosts()[0][1] as RequestInit).body));

    const body = await recordedLedger();
    expect(body.submission_id).toBe(vaultBody.submission_id);
    expect(body.outcome).toMatchObject({ vaulted: true, notified: true, http_status: 200 });
    const base = body.outcome.base as { ok: boolean; via: string; error?: string };
    expect(base).toMatchObject({ ok: false, via: 'none' });
    expect(base.error).toContain('1254045');
    expect(base.error?.length).toBeLessThanOrEqual(200);
    expect(body.notification.text).toContain('Base未登録');
    expect(body.notification.text).toContain(`受付ID: ${body.submission_id}`);
  });

  it('Base と通知先が未設定で、退避に残して返す申込も台帳に残す', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.notification, '通知先が無いので通知の欄は空').toEqual({});
    expect(body.outcome).toMatchObject({
      notified: false,
      vaulted: true,
      base: { ok: false, via: 'none', error: 'Lark Base 認証情報が未設定' },
      http_status: 200,
    });
  });

  it('Base に入っても通知が落ちた申込は、未送信と退避に残したことを台帳に残す', async () => {
    stubConfigured();
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/bot/v2/hook/')
      ? Response.json({ code: 19021, msg: 'sign match fail' })
      : healthyResponse(input));
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.notification).toMatchObject({ sent: false, via: 'webhook' });
    expect(body.outcome).toMatchObject({
      notified: false,
      vaulted: true,
      base: { ok: true, via: 'direct' },
      http_status: 200,
    });
  });

  it('Base にも通知にも退避にも残らず 502 を返す申込も台帳に残す', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/rest/v1/submission_vault')
      ? new Response('boom', { status: 503 })
      : healthyResponse(input));
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);

    const body = await recordedLedger();
    expect(body.outcome).toMatchObject({
      notified: false,
      vaulted: false,
      base: { ok: false, via: 'none' },
      http_status: 502,
    });
  });

  it('受け入れ後の想定外の例外で返す 400 も、例外名つきで台帳に残す', async () => {
    vi.doMock('@/lib/larkBase', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/lib/larkBase')>(),
      isLarkBaseConfigured: vi.fn(() => { throw new RangeError('boom'); }),
    }));
    try {
      const { POST } = await import('./route');
      const res = await POST(makeRequest());
      expect(res.status).toBe(400);

      const body = await recordedLedger();
      expect(body.outcome).toMatchObject({ notified: false, vaulted: false, http_status: 400, error: 'RangeError' });
      expect(body.outcome.base).toBeUndefined();
    } finally {
      vi.doUnmock('@/lib/larkBase');
    }
  });

  describe('台帳に書かない戻り口', () => {
    it('検証で弾いた申込（400）は書かない', async () => {
      stubConfigured();
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ email: 'not-an-email' }));
      expect(res.status).toBe(400);
      expect(afterTasks.queue, '弾いた申込は台帳に積まない').toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    it('bot 判定（隠し欄あり）で黙って捨てた申込は書かない', async () => {
      stubConfigured();
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ company_url: 'https://spam.example/' }));
      expect(res.status).toBe(200);
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    it('フォームとして読めない本文（受け入れ前の例外）は書かない', async () => {
      stubConfigured();
      const { POST } = await import('./route');
      const res = await POST(new Request('https://ridejob.jp/entry/gulliver/newgraduate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"山田 太郎"}',
      }));
      expect(res.status).toBe(400);
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });
  });

  describe('台帳の失敗・未設定は応答を変えない', () => {
    it('台帳への書き込みが 500 で失敗しても、応答は同じで、ログに個人情報を出さない', async () => {
      stubConfigured();
      fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/rest/v1/submissions')
        ? Response.json({ code: '23505', message: 'duplicate key', details: 'Failing row contains (山田 太郎, 090-1234-5678)' }, { status: 500 })
        : healthyResponse(input));
      const { POST } = await import('./route');
      const res = await POST(makeRequest());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      await expect(flushAfter()).resolves.toBeUndefined();
      expect(ledgerCalls()).toHaveLength(1);
      const logs = ledgerLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].join(' ')).toContain('http=500');
      const text = logs.map((args) => args.join(' ')).join('\n');
      for (const pii of ['山田', '090-1234-5678', 'bp-test@example.com']) expect(text).not.toContain(pii);
    });

    for (const name of ['SUBMISSION_VAULT_URL', 'SUBMISSION_VAULT_SERVICE_KEY']) {
      it(`${name} が未設定なら台帳へは書かず、応答は同じ`, async () => {
        stubConfigured();
        vi.stubEnv(name, '');
        const { POST } = await import('./route');
        const res = await POST(makeRequest());
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        await expect(flushAfter()).resolves.toBeUndefined();
        expect(ledgerCalls()).toHaveLength(0);
        expect(ledgerLogs()).toHaveLength(1);
        expect(String(ledgerLogs()[0][0])).toContain('未設定');
      });
    }
  });
});
