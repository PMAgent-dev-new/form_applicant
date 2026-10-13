import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// after() はリクエストの外では動かない。積まれた処理をテストから流して、台帳への書き込みを確かめる。
const afterTasks = vi.hoisted(() => ({ queue: [] as (() => unknown)[] }));
vi.mock('next/server', async (importActual) => ({ ...await importActual<typeof import('next/server')>(), after: (fn: () => unknown) => afterTasks.queue.push(fn) }));

/**
 * 受付台帳（Supabase submissions）の配線テスト。実物の submissionLedger を通す。
 *
 * - 受け入れた応募は、応答を返したあとに1行だけ書かれ、応募者・経路・広告・通知・結果が入る
 * - 検証で弾いた応募と、再送前提の 503（何も進めていない）は書かない
 * - 台帳の失敗・未設定は応答を変えない
 */

const LEDGER_URL = 'https://tdlnowmdanapxmgebaqu.supabase.co/rest/v1/submissions?on_conflict=source,submission_id';

const ENV: Record<string, string> = {
  NODE_ENV: 'production',
  LARK_WEBHOOK_URL_COUPANG: 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaaaaaa',
  LARK_BASE_WEBHOOK_URL_COUPANG_PROD:
    'https://test-base.jp.larksuite.com/base/automation/webhook/event/bbbbbbbb',
  META_SMS_ENABLED: 'true',
  EEASY_SMS_SEND_URL: 'https://leomeet.pmagent.jp/api/sms/send',
  SMS_SEND_SECRET: 'test-secret',
  NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
  META_CAPI_ACCESS_TOKEN: 'test-capi-token',
  SUBMISSION_VAULT_URL: 'https://tdlnowmdanapxmgebaqu.supabase.co',
  SUBMISSION_VAULT_SERVICE_KEY: 'test-vault-key',
  GMAIL_SENDER_EMAIL: 'support_team@pmagent.jp',
  EMAIL_DRY_RUN: 'true',
  COUPANG_EMAIL_ENABLED: 'true',
  COUPANG_SMS_ENABLED: 'true',
  // 手元の環境値が混ざらないよう、結果を変える設定は空にしておく
  LARK_WEBHOOK_URL_COUPANG_PROD: '',
  LARK_WEBHOOK_URL_COUPANG_TEST: '',
  LARK_BASE_WEBHOOK_URL_COUPANG: '',
  LARK_BASE_WEBHOOK_URL_COUPANG_TEST: '',
  APP_ID_LIFTJOB: '',
  APP_SECRET_LIFTJOB: '',
  APP_TOKEN_LIFTJOB: '',
  LARK_SEND_BASE_ONLY: '',
  META_ACCESS_TOKEN: '',
  META_SMS_DRY_RUN: '',
  ENABLE_EMAIL_NOTIFICATION: '',
  HEALTH_CHECK_TOKEN: '',
  OPENAI_ADS_PIXEL_ID: '',
  OPENAI_ADS_CAPI_KEY: '',
  OPENAI_ADS_RELAY_URL: '',
  OPENAI_ADS_RELAY_TOKEN: '',
};

// Base の直書き（専用の資格情報）を有効にする
const DIRECT_BASE_ENV: Record<string, string> = {
  APP_ID_LIFTJOB: 'cli-lift',
  APP_SECRET_LIFTJOB: 'secret-lift',
  APP_TOKEN_LIFTJOB: 'app-lift',
};

function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  // ハンドラが request.cookies を読むため、素の Request ではなく NextRequest で作る。
  return new NextRequest('https://ridejob.jp/entry/api/coupang/applicants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://ridejob.jp/entry/coupang',
      'user-agent': 'vitest',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'x-forwarded-host': 'ridejob.jp',
      cookie: '_fbp=fb.1.1700000000.111; _fbc=fb.1.1700000000.AbC',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

const coupangBody = {
  email: 'applicant@example.com',
  fullName: 'テスト　太郎',
  fullNameKana: 'てすとたろう',
  phoneNumber: '07031415926',
  jobPosition: 'アカウントマネージャー',
  desiredLocation: '東京',
  age: '30',
  birthDate: '19960101',
  submissionId: 'ledger-coupang',
  metaEventId: 'ledger-coupang',
  utmParams: {
    utm_source: 'ig',
    utm_medium: 'cpc',
    utm_campaign: '120234567890',
    utm_term: '120234567891',
    utm_content: 'CR-2608-30',
    utm_id: '120234567892',
    utm_creative: 'CR-2608-30_SALES_未経験から法人営業',
  },
  pageUrl: 'https://ridejob.jp/entry/coupang?utm_source=ig&utm_medium=cpc',
  landingPath: '/entry/coupang',
  initialReferrer: 'https://l.instagram.com/',
  attributionSource: 'query',
};

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

describe('coupang applicants POST — 受付台帳', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  // 既定の応答。Lark・SMS・CAPI・退避・台帳のどれも成功扱い。
  const okResponse = async () => new Response(JSON.stringify({ ok: true, code: 0, StatusCode: 0 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  // Base 直書き（Lark API）が通る応答。
  const directBaseResponse = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('tenant_access_token')) {
      return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
    }
    if (url.includes('/records/search')) return Response.json({ code: 0, data: { items: [] } });
    if (url.includes('/fields')) return Response.json({ code: 0, data: { items: [] } });
    if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
      return Response.json({ code: 0, data: { record: { record_id: 'rec-lift' } } });
    }
    if (url.endsWith('/records/rec-lift') && init?.method === 'PUT') return Response.json({ code: 0 });
    return okResponse();
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
    expect(calls, '台帳への書き込みは1応募につき1回').toHaveLength(1);
    return readBody(calls[0]);
  }

  function stubDirectBase() {
    for (const [key, value] of Object.entries(DIRECT_BASE_ENV)) vi.stubEnv(key, value);
  }

  beforeEach(() => {
    afterTasks.queue = [];
    for (const [key, value] of Object.entries(ENV)) {
      vi.stubEnv(key, value);
    }
    fetchSpy = vi.fn(okResponse);
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // capi.ts は env をモジュール読み込み時に取り込むため、毎回作り直す。
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('受け入れた応募は、応答のあとに台帳へ1行だけ書き、応募者・経路・広告・通知・結果を残す', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-full', oppref: 'op-test' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Application submitted successfully!' });

    // 応答を返した時点では台帳へ書き始めていない（応募者を待たせない）
    expect(afterTasks.queue).toHaveLength(1);
    expect(ledgerCalls()).toHaveLength(0);

    await flushAfter();
    const calls = ledgerCalls();
    expect(calls, '台帳への書き込みは1応募につき1回').toHaveLength(1);
    expect(String(calls[0][0])).toBe(LEDGER_URL);
    expect((calls[0][1] as RequestInit).method).toBe('POST');
    const body = readBody(calls[0]);

    expect(body).toMatchObject({
      source: 'form_applicant/coupang',
      kind: 'application',
      submission_id: 'ledger-coupang-full',
      profile: 'liftjob',
    });
    expect(body.applicant).toEqual({
      full_name: 'テスト　太郎',
      full_name_kana: 'てすとたろう',
      phone_number: '07031415926',
      email: 'applicant@example.com',
      birth_date: '1996/01/01',
      age: '30',
      job_position: 'アカウントマネージャー',
      desired_location: '東京',
    });
    expect(body.context).toEqual({
      utm: coupangBody.utmParams,
      oppref: 'op-test',
      page_url: 'https://ridejob.jp/entry/coupang?utm_source=ig&utm_medium=cpc',
      landing_path: '/entry/coupang',
      initial_referrer: 'https://l.instagram.com/',
      attribution_source: 'query',
      test_mode: false,
      request: {
        referer: 'https://ridejob.jp/entry/coupang',
        user_agent: 'vitest',
        host: 'ridejob.jp',
      },
      environment: 'production',
    });
    // IP アドレスと Cookie の値は台帳に入れない
    expect(JSON.stringify(body)).not.toMatch(/203\.0\.113\.7|10\.0\.0\.1|fb\.1\.1700000000/);
    // 広告ID は URL から取れるが、Meta の参照権限が無いので素材は空
    expect(body.ad).toEqual({ ad_id: '120234567892', ad_creative_id: '', ad_image_url: '' });

    // 通知は実際に送った本文と同じ
    const hook = fetchSpy.mock.calls.find(([input]) => String(input).includes('/bot/v2/hook/'));
    const sentText = JSON.parse(String((hook![1] as RequestInit).body)).content.text as string;
    expect(body.notification).toEqual({ text: sentText, sent: true, via: 'webhook' });
    expect(sentText).toContain('LIFT JOB（ロケットナウ）の応募');

    expect(body.outcome).toEqual({
      notified: true,
      vaulted: false,
      email: 'skipped',
      sms: 'sent',
      meta_capi: 'sent',
      openai_capi: 'skipped',
      base_only: false,
      base: { ok: true, via: 'webhook' },
      http_status: 200,
    });
  });

  it('Meta 広告の素材が取れた応募は、クリエイティブIDと画像URLを ad に残す', async () => {
    vi.stubEnv('META_ACCESS_TOKEN', 'test-meta-read');
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      return url.includes('graph.facebook.com') && url.includes('/120234567892?')
        ? Response.json({ creative: { id: '987654321', image_url: 'https://a.fbcdn.net/test.jpg' } })
        : okResponse();
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-ad' }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.ad).toEqual({
      ad_id: '120234567892',
      ad_creative_id: '987654321',
      ad_image_url: 'https://a.fbcdn.net/test.jpg',
    });
  });

  it('Base を直書きした応募は、経路が direct・レコードIDつきで残る', async () => {
    stubDirectBase();
    fetchSpy.mockImplementation(directBaseResponse);
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-direct' }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.outcome).toMatchObject({
      notified: true,
      vaulted: false,
      base: { ok: true, via: 'direct', record_id: 'rec-lift' },
      http_status: 200,
    });
    expect(body.notification).toMatchObject({ sent: true, via: 'webhook' });
  });

  it('認証つきの E2E モードの応募には test_mode が付く', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'health-secret');
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-e2e', testMode: true }, { 'x-e2e-token': 'health-secret' }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.context).toMatchObject({ test_mode: true });
    // 応募者への送信（メール・SMS・Meta CAPI）は抑止される
    expect(body.outcome).toMatchObject({ email: 'skipped', sms: 'skipped', meta_capi: 'skipped', http_status: 200 });
  });

  it('Base に保存できず退避に残した応募は、vaulted と Base の失敗理由を台帳に残す', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/base/automation/webhook/event/')
      ? Response.json({ code: 4001, msg: 'mapping failed' })
      : okResponse());
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-base-down' }));
    expect(res.status).toBe(200);
    expect(vaultPosts(), 'Base に入らなかった応募は退避に残すこと').toHaveLength(1);

    const body = await recordedLedger();
    expect(body.outcome).toMatchObject({ vaulted: true, notified: true, http_status: 200 });
    const base = body.outcome.base as { ok: boolean; via: string; error?: string };
    expect(base).toMatchObject({ ok: false, via: 'none' });
    expect(base.error).toContain('4001');
    expect(base.error?.length).toBeLessThanOrEqual(200);
    expect(body.notification.text).toContain('Base未登録（退避済み・要取り込み）');
  });

  it('通知が落ちた応募は、未送信と退避に残したことを台帳に残す', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/bot/v2/hook/')
      ? Response.json({ code: 19001, msg: 'bot not in chat' })
      : okResponse());
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-no-notice' }));
    expect(res.status, '応募は Base に残っているので再送させない').toBe(200);

    const body = await recordedLedger();
    expect(body.notification).toMatchObject({ sent: false, via: 'webhook' });
    expect(body.notification.text).toContain('LIFT JOB（ロケットナウ）の応募');
    expect(body.outcome).toMatchObject({
      notified: false,
      vaulted: true,
      base: { ok: true, via: 'webhook' },
      http_status: 200,
    });
  });

  it('通知先が許可外でも Base に保存できる応募は続行し、通知の欄は空・退避に残したことを台帳に残す', async () => {
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG', 'https://evil.example.com/hook/test');
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-bad-hook' }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.notification).toEqual({});
    expect(body.outcome).toMatchObject({
      notified: false,
      vaulted: true,
      base: { ok: true, via: 'webhook' },
      http_status: 200,
    });
  });

  it('保存先が無く、退避に残して返す応募も台帳に残す（Base は試していない）', async () => {
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_COUPANG_PROD', 'https://evil.example.com/base/test');
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-bail-ok' }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.profile).toBe('liftjob');
    expect(body.notification).toEqual({});
    expect(body.outcome).toEqual({
      notified: false,
      vaulted: true,
      email: 'skipped',
      sms: 'skipped',
      meta_capi: 'skipped',
      openai_capi: 'skipped',
      base_only: false,
      base: { ok: false, via: 'none', error: 'not_configured' },
      http_status: 200,
    });
  });

  it('保存先が無く、退避にも失敗して 500 を返す応募も台帳に残す', async () => {
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_COUPANG_PROD', 'https://evil.example.com/base/test');
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/rest/v1/submission_vault')
      ? new Response('boom', { status: 503 })
      : okResponse());
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-bail-ng' }));
    expect(res.status).toBe(500);

    const body = await recordedLedger();
    expect(body.outcome).toMatchObject({ vaulted: false, notified: false, http_status: 500 });
    expect(body.outcome.base).toMatchObject({ ok: false, via: 'none', error: 'not_configured' });
  });

  it('受け入れ後の想定外の例外で返す 500 も、例外名つきで台帳に残す', async () => {
    vi.doMock('@/lib/meta/resolveAdImage', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/lib/meta/resolveAdImage')>(),
      resolveAdImageUrl: vi.fn().mockRejectedValue(new RangeError('boom')),
    }));
    try {
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-throw' }));
      expect(res.status).toBe(500);

      const body = await recordedLedger();
      expect(body.outcome).toMatchObject({ notified: false, vaulted: false, http_status: 500, error: 'RangeError' });
      expect(body.outcome.base).toBeUndefined();
    } finally {
      vi.doUnmock('@/lib/meta/resolveAdImage');
    }
  });

  describe('台帳に書かない戻り口', () => {
    it('生年月日が不正な応募（400）は書かない', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...coupangBody, birthDate: '19860230' }));
      expect(res.status).toBe(400);
      expect(afterTasks.queue, '弾いた応募は台帳に積まない').toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('受付IDが無い応募（400）は書かない', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...coupangBody, submissionId: undefined, metaEventId: undefined }));
      expect(res.status).toBe(400);
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    it('E2E モードで認証に通らない応募（401）は書かない', async () => {
      vi.stubEnv('HEALTH_CHECK_TOKEN', 'health-secret');
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...coupangBody, testMode: true }, { 'x-e2e-token': 'wrong' }));
      expect(res.status).toBe(401);
      expect(afterTasks.queue).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('本文が JSON でない応募（受け入れ前の例外）は書かない', async () => {
      const { POST } = await import('./route');
      const res = await POST(new NextRequest('https://ridejob.jp/entry/api/coupang/applicants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{broken',
      }));
      expect(res.status).toBe(500);
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    it('先着が通知まで終えた重複の再送は書かない（先着の記録を残す）', async () => {
      stubDirectBase();
      fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => String(input).includes('/records/search')
        ? Response.json({ code: 0, data: { items: [{ record_id: 'rec-first', fields: { 応募日: Date.now() - 60_000, Lark通知送信済み: true } }] } })
        : directBaseResponse(input, init));
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-dup' }));
      expect(res.status).toBe(200);
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    // 先着が通知を終えていない同じ受付IDは、先着の完了を最大3秒待ってから 503 を返す。
    it('別のリクエストが処理中の 503（再送前提）は書かない', async () => {
      stubDirectBase();
      fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => String(input).includes('/records/search')
        ? Response.json({ code: 0, data: { items: [{ record_id: 'rec-first', fields: { 応募日: Date.now() } }] } })
        : directBaseResponse(input, init));
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-in-progress' }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: 'Application is still being processed; retry shortly' });
      expect(afterTasks.queue, '再送前提の 503 は台帳に積まない').toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    }, 15000);
  });

  describe('台帳の失敗・未設定は応答を変えない', () => {
    it('台帳への書き込みが 500 で失敗しても、応答は同じで、ログに個人情報を出さない', async () => {
      fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/rest/v1/submissions')
        ? Response.json({ code: '23505', message: 'duplicate key', details: 'Failing row contains (テスト　太郎, 07031415926)' }, { status: 500 })
        : okResponse());
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-500' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: 'Application submitted successfully!' });

      await expect(flushAfter()).resolves.toBeUndefined();
      expect(ledgerCalls()).toHaveLength(1);
      const logs = ledgerLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].join(' ')).toContain('http=500');
      const text = logs.map((args) => args.join(' ')).join('\n');
      for (const pii of ['テスト', '07031415926', 'applicant@example.com']) expect(text).not.toContain(pii);
    });

    it('台帳への接続が例外で終わっても、応答は同じ', async () => {
      fetchSpy.mockImplementation(async (input: unknown) => {
        if (String(input).includes('/rest/v1/submissions')) throw new TypeError('fetch failed');
        return okResponse();
      });
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...coupangBody, submissionId: 'ledger-coupang-throw-ledger' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: 'Application submitted successfully!' });

      await expect(flushAfter()).resolves.toBeUndefined();
      expect(ledgerCalls()).toHaveLength(1);
      expect(ledgerLogs()).toHaveLength(1);
    });

    for (const name of ['SUBMISSION_VAULT_URL', 'SUBMISSION_VAULT_SERVICE_KEY']) {
      it(`${name} が未設定なら台帳へは書かず、応答は同じ`, async () => {
        vi.stubEnv(name, '');
        const { POST } = await import('./route');
        const res = await POST(makeRequest({ ...coupangBody, submissionId: `ledger-coupang-unset-${name}` }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ message: 'Application submitted successfully!' });

        await expect(flushAfter()).resolves.toBeUndefined();
        expect(ledgerCalls()).toHaveLength(0);
        expect(ledgerLogs()).toHaveLength(1);
        expect(String(ledgerLogs()[0][0])).toContain('未設定');
      });
    }
  });
});
