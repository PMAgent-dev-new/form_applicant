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
  LARK_WEBHOOK_URL: 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaaaaaa',
  LARK_SUBMIT_CHAT_ID_RIDEJOB: 'oc_ridejob',
  LARK_SUBMIT_CHAT_ID_MECHANIC: 'oc_mechanic',
  LARK_BASE_WEBHOOK_URL: 'https://open.larksuite.com/anycross/trigger/bbbbbbbb',
  APP_ID_RIDEJOB: 'cli_ridejob',
  APP_SECRET_RIDEJOB: 'secret_ridejob',
  APP_TOKEN_RIDEJOB: 'app_ridejob',
  APP_ID_MECHANIC: 'cli_mechanic',
  APP_SECRET_MECHANIC: 'secret_mechanic',
  APP_TOKEN_MECHANIC: 'app_mechanic',
  META_SMS_ENABLED: 'true',
  EEASY_SMS_SEND_URL: 'https://leomeet.pmagent.jp/api/sms/send',
  SMS_SEND_SECRET: 'test-secret',
  NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
  META_CAPI_ACCESS_TOKEN: 'test-capi-token',
  SUBMISSION_VAULT_URL: 'https://tdlnowmdanapxmgebaqu.supabase.co',
  SUBMISSION_VAULT_SERVICE_KEY: 'test-vault-key',
  GMAIL_SENDER_EMAIL: 'support_team@pmagent.jp',
  EMAIL_DRY_RUN: 'true',
  // 手元の環境値が混ざらないよう、結果を変える設定は空にしておく
  LARK_WEBHOOK_URL_TEST: '',
  LARK_BASE_WEBHOOK_URL_PROD: '',
  LARK_BASE_WEBHOOK_URL_TEST: '',
  LARK_SEND_BASE_ONLY: '',
  META_ACCESS_TOKEN: '',
  META_SMS_DRY_RUN: '',
  ENABLE_EMAIL_NOTIFICATION: '',
  MICROCMS_SERVICE_DOMAIN: '',
  MICROCMS_API_KEY: '',
  OPENAI_ADS_PIXEL_ID: '',
  OPENAI_ADS_CAPI_KEY: '',
  OPENAI_ADS_RELAY_URL: '',
  OPENAI_ADS_RELAY_TOKEN: '',
};

function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  // ハンドラが request.cookies を読むため、素の Request ではなく NextRequest で作る。
  return new NextRequest('https://ridejob.jp/api/applicants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://ridejob.jp/',
      'user-agent': 'vitest',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'x-forwarded-host': 'ridejob.jp',
      cookie: '_fbp=fb.1.1700000000.111; _fbc=fb.1.1700000000.AbC',
      ...extraHeaders,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const applicantBody = {
  formOrigin: 'default',
  birthDate: '1990-01-01',
  fullName: '田中 太郎',
  fullNameKana: 'たなか たろう',
  postalCode: '1234567',
  prefectureName: '東京都',
  municipalityName: '千代田区',
  phoneNumber: '07031415926',
  email: 'applicant@example.com',
  submissionId: 'ledger-test',
  metaEventId: 'evt-ledger-test',
  utmParams: { utm_source: 'google', utm_medium: 'search' },
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

describe('applicants POST — 受付台帳', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  const successResponse = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('tenant_access_token')) {
      return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
    }
    if (url.includes('/records/search')) return Response.json({ code: 0, data: { items: [] } });
    if (url.includes('/fields')) return Response.json({ code: 0, data: { items: [] } });
    if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
      return Response.json({ code: 0, data: { record: { record_id: 'rec-test' } } });
    }
    if (url.includes('/im/v1/messages')) {
      return Response.json({ code: 0, data: { message_id: 'om-test' } });
    }
    return new Response(JSON.stringify({ ok: true, code: 0, StatusCode: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
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

  // 通知先を消す。Base 側（直書き・Base Webhook）は生かしたまま。
  function stubNoNotificationTarget() {
    vi.stubEnv('LARK_SUBMIT_CHAT_ID_RIDEJOB', '');
    vi.stubEnv('LARK_WEBHOOK_URL', '');
  }

  // Base への保存経路も消す（直書きの認証 + Base Webhook）。
  function stubNoBasePersistence() {
    vi.stubEnv('APP_ID_RIDEJOB', '');
    vi.stubEnv('APP_SECRET_RIDEJOB', '');
    vi.stubEnv('APP_TOKEN_RIDEJOB', '');
    vi.stubEnv('LARK_BASE_WEBHOOK_URL', '');
  }

  beforeEach(() => {
    afterTasks.queue = [];
    for (const [key, value] of Object.entries(ENV)) {
      vi.stubEnv(key, value);
    }
    fetchSpy = vi.fn(successResponse);
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
    const at = new Date().toISOString();
    const { POST } = await import('./route');
    const res = await POST(makeRequest({
      ...applicantBody,
      submissionId: 'ledger-full',
      oppref: 'op-test',
      fbclid: 'fb-click-1',
      attributionLastTouchAt: at,
      experiment: { name: 'exp1', variant: 'b' },
      applicationContext: { acquisition: { source: 'google', medium: 'search', at } },
    }));
    expect(res.status).toBe(200);

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
      source: 'form_applicant/applicants',
      kind: 'application',
      submission_id: 'ledger-full',
      profile: 'ridejob',
    });
    // 応募者が入力した項目だけ
    expect(body.applicant).toEqual({
      birth_date: '1990-01-01',
      full_name: '田中 太郎',
      full_name_kana: 'たなか たろう',
      postal_code: '1234567',
      prefecture_name: '東京都',
      municipality_name: '千代田区',
      phone_number: '07031415926',
      email: 'applicant@example.com',
      form_origin: 'default',
    });
    expect(body.context).toEqual({
      application_context: { acquisition: { source: 'google', medium: 'search', at } },
      utm: { utm_source: 'google', utm_medium: 'search' },
      oppref: 'op-test',
      catalog: {},
      fbclid: 'fb-click-1',
      attribution_last_touch_at: at,
      experiment: { name: 'exp1', variant: 'b' },
      request: {
        referer: 'https://ridejob.jp/',
        user_agent: 'vitest',
        host: 'ridejob.jp',
      },
      environment: 'production',
    });
    // IP アドレスと Cookie の値は台帳に入れない
    expect(JSON.stringify(body)).not.toMatch(/203\.0\.113\.7|10\.0\.0\.1|fb\.1\.1700000000/);
    expect(body.ad).toMatchObject({ ad_id: '', ad_creative_id: '', ad_image_url: '' });
    expect(body.ad.enrichment).toEqual({
      // 広告IDが無いときは、クリエイティブ欄と同じく参照状態が入る
      creative_text: '広告IDなし・CR未特定',
      summary_lines: expect.any(Array),
      reference_status: '広告IDなし・CR未特定',
      dynamic: false,
    });
    expect(body.ad.catalog).toEqual({});

    // 通知は実際に送った本文と同じ
    const im = fetchSpy.mock.calls.find(([input]) => String(input).includes('/im/v1/messages'));
    const sentText = JSON.parse(JSON.parse(String((im![1] as RequestInit).body)).content).text as string;
    expect(body.notification).toEqual({ text: sentText, sent: true, via: 'im' });
    expect(sentText).toContain('新しい応募がありました！');

    expect(body.outcome).toEqual({
      notified: true,
      vaulted: false,
      email: 'skipped',
      sms: 'sent',
      meta_capi: 'sent',
      openai_capi: 'skipped',
      base_only: false,
      base: { ok: true, via: 'direct', record_id: 'rec-test' },
      http_status: 200,
    });
  });

  it('Meta 広告経由の応募は、広告ID・クリエイティブID・画像URL・CR本文を ad に残す', async () => {
    vi.stubEnv('META_ACCESS_TOKEN', 'test-meta-read');
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => String(input).includes('graph.facebook.com')
      ? Response.json({ id: '123456789', account_id: '1435983094817075', creative: { id: '987654321', image_url: 'https://a.fbcdn.net/test.jpg', body: 'CR本文' } })
      : successResponse(input, init));
    const { POST } = await import('./route');
    const res = await POST(makeRequest({
      ...applicantBody,
      metaEventId: undefined,
      submissionId: 'ledger-meta-ad',
      utmParams: { utm_source: 'fb', utm_medium: 'cpc', utm_id: '123456789' },
    }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.ad).toMatchObject({
      ad_id: '123456789',
      ad_creative_id: '987654321',
      ad_image_url: 'https://a.fbcdn.net/test.jpg',
    });
    expect(String((body.ad.enrichment as { creative_text: string }).creative_text)).toContain('CR本文');
  });

  it('整備士のフォームは profile が mechanic になる', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...applicantBody, formOrigin: 'mechanic', submissionId: 'ledger-mechanic' }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.profile).toBe('mechanic');
    expect(body.applicant.form_origin).toBe('mechanic');
  });

  it('Base に保存できず退避に残した応募は、vaulted と Base の失敗理由を台帳に残す', async () => {
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      if (url.includes('/anycross/trigger/')) return Response.json({ code: 4001, msg: 'automation stopped' });
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-base-down' }));
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

  it('IM API が落ちて Webhook へ落とした通知は、経路が webhook・送信済みで残る', async () => {
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => String(input).includes('/im/v1/messages')
      ? Response.json({ code: 19021, msg: 'message rejected' })
      : successResponse(input, init));
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-webhook-fallback' }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    const hook = fetchSpy.mock.calls.find(([input]) => String(input).includes('/bot/v2/hook/'));
    const sentText = JSON.parse(String((hook![1] as RequestInit).body)).content.text as string;
    expect(body.notification).toEqual({ text: sentText, sent: true, via: 'webhook' });
    expect(body.outcome).toMatchObject({ notified: true, vaulted: false, http_status: 200 });
  });

  it('通知を1つも出せなかった応募は、未送信のまま退避に残したことを台帳に残す', async () => {
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/im/v1/messages') || url.includes('/bot/v2/hook/')) {
        return Response.json({ code: 19021, msg: 'message rejected' });
      }
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-no-notice' }));
    expect(res.status, '応募は Base に残っているので再送させない').toBe(200);

    const body = await recordedLedger();
    expect(body.notification).toMatchObject({ sent: false, via: 'webhook' });
    expect(body.notification.text).toContain('新しい応募がありました！');
    expect(body.outcome).toMatchObject({ notified: false, vaulted: true, http_status: 200 });
    expect(body.outcome.base).toMatchObject({ ok: true, via: 'direct' });
  });

  it('通知先が無くても Base に保存できる応募は続行し、通知の欄は空・退避に残したことを台帳に残す', async () => {
    stubNoNotificationTarget();
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-no-target' }));
    expect(res.status).toBe(200);
    expect(vaultPosts(), '通知先が無いことは退避に記録すること').toHaveLength(1);

    const body = await recordedLedger();
    expect(body.notification).toEqual({});
    expect(body.outcome).toMatchObject({ notified: false, vaulted: true, http_status: 200 });
    expect(body.outcome.base).toMatchObject({ ok: true, via: 'direct' });
  });

  it('保存先が無く、退避に残して返す応募も台帳に残す（Base は試していない）', async () => {
    stubNoNotificationTarget();
    stubNoBasePersistence();
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-bail-ok' }));
    expect(res.status).toBe(200);

    const body = await recordedLedger();
    expect(body.profile).toBe('ridejob');
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
    stubNoNotificationTarget();
    stubNoBasePersistence();
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => String(input).includes('/rest/v1/submission_vault')
      ? new Response('boom', { status: 503 })
      : successResponse(input, init));
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-bail-ng' }));
    expect(res.status).toBe(500);

    const body = await recordedLedger();
    expect(body.outcome).toMatchObject({ vaulted: false, notified: false, http_status: 500 });
    expect(body.outcome.base).toMatchObject({ ok: false, via: 'none', error: 'not_configured' });
  });

  it('通知済みの書き戻しに3回失敗して返す 503 は、そこまで進んでいるので台帳に残す', async () => {
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => init?.method === 'PUT'
      ? Response.json({ code: 4001, msg: 'update failed' })
      : successResponse(input, init));
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-writeback' }));
    expect(res.status).toBe(503);

    const body = await recordedLedger();
    expect(body.outcome).toMatchObject({
      notified: true,
      vaulted: false,
      http_status: 503,
      base: { ok: true, via: 'direct', record_id: 'rec-test' },
      // 後続（メール・SMS・CAPI）へ進む前に返している
      sms: 'skipped',
      meta_capi: 'skipped',
    });
    expect(body.notification).toMatchObject({ sent: true, via: 'im' });
  }, 15000);

  it('受け入れ後の想定外の例外で返す 500 も、例外名つきで台帳に残す', async () => {
    vi.doMock('@/lib/application-enrichment', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/lib/application-enrichment')>(),
      enrichApplication: vi.fn().mockRejectedValue(new RangeError('boom')),
    }));
    try {
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-throw-after-accept' }));
      expect(res.status).toBe(500);

      const body = await recordedLedger();
      expect(body.profile).toBe('ridejob');
      expect(body.outcome).toMatchObject({ notified: false, vaulted: false, http_status: 500, error: 'RangeError' });
      expect(body.outcome.base).toBeUndefined();
    } finally {
      vi.doUnmock('@/lib/application-enrichment');
    }
  });

  describe('台帳に書かない戻り口', () => {
    it('受付IDが無い応募（400）は書かない', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...applicantBody, submissionId: undefined, metaEventId: undefined }));
      expect(res.status).toBe(400);
      expect(afterTasks.queue, '弾いた応募は台帳に積まない').toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    it('本文が JSON でない応募（受け入れ前の例外）は書かない', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeRequest('{broken'));
      expect(res.status).toBe(500);
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    it('カタログ求人の確認が一時的に失敗した 503（再送前提）は書かない', async () => {
      const { POST } = await import('./route');
      const res = await POST(makeRequest({
        ...applicantBody,
        submissionId: 'ledger-catalog-503',
        catalogJobId: 'job-1',
        catalogClickedAt: new Date().toISOString(),
        catalogSource: 'meta',
        catalogMedium: 'catalog',
        appliedJobId: 'job-1',
      }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: 'Catalog job source is temporarily unavailable' });
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    // 先着が通知を終えていない同じ受付IDは、先着の完了を最大3秒待ってから 503 を返す。
    async function postWithExistingRecord(submissionId: string, submittedAgoMs: number) {
      fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => String(input).includes('/records/search')
        ? Response.json({ code: 0, data: { items: [{ record_id: 'rec-first', fields: { 応募日: Date.now() - submittedAgoMs } }] } })
        : successResponse(input, init));
      const { POST } = await import('./route');
      return POST(makeRequest({ ...applicantBody, submissionId }));
    }

    it('先着が通知まで終えた重複の再送は書かない（先着の記録を残す）', async () => {
      fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => String(input).includes('/records/search')
        ? Response.json({ code: 0, data: { items: [{ record_id: 'rec-first', fields: { 応募日: Date.now() - 60_000, 対応履歴メモ: '[submission_id:ledger-dup]\n[lark_notified:ledger-dup]' } }] } })
        : successResponse(input, init));
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-dup' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: 'Application submitted successfully!', duplicate: true });
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    });

    it('別のリクエストが処理中の 503（再送前提）は書かない', async () => {
      const res = await postWithExistingRecord('ledger-in-progress', 0);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: 'Application is still being processed; retry shortly' });
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    }, 15000);

    it('通知の自動復旧期限を過ぎた 503（再送前提）は書かない', async () => {
      const res = await postWithExistingRecord('ledger-recovery-expired', 56 * 60_000);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: 'Notification recovery requires manual confirmation' });
      expect(afterTasks.queue).toHaveLength(0);
      expect(ledgerCalls()).toHaveLength(0);
    }, 15000);
  });

  describe('台帳の失敗・未設定は応答を変えない', () => {
    it('台帳への書き込みが 500 で失敗しても、応答は同じで、ログに個人情報を出さない', async () => {
      fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => String(input).includes('/rest/v1/submissions')
        ? Response.json({ code: '23505', message: 'duplicate key', details: 'Failing row contains (田中 太郎, 07031415926)' }, { status: 500 })
        : successResponse(input, init));
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-500' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: 'Application submitted successfully!' });

      await expect(flushAfter()).resolves.toBeUndefined();
      expect(ledgerCalls()).toHaveLength(1);
      const logs = ledgerLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].join(' ')).toContain('http=500');
      const text = logs.map((args) => args.join(' ')).join('\n');
      for (const pii of ['田中', '07031415926', 'applicant@example.com']) expect(text).not.toContain(pii);
    });

    it('台帳への接続が例外で終わっても、応答は同じ', async () => {
      fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
        if (String(input).includes('/rest/v1/submissions')) throw new TypeError('fetch failed');
        return successResponse(input, init);
      });
      const { POST } = await import('./route');
      const res = await POST(makeRequest({ ...applicantBody, submissionId: 'ledger-throw' }));
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
        const res = await POST(makeRequest({ ...applicantBody, submissionId: `ledger-unset-${name}` }));
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
