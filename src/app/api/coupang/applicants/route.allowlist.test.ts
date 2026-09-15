import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoupangFormData } from '@/app/components/coupang-form/types';

/**
 * クーパン専用ルートの送信先ホスト許可リストガード。
 *
 * 共通ルート(`/api/applicants`)の同名テストと同じ狙い。応募者の個人情報が
 * 許可リスト外のホストへ送られる変更を CI で止める番人であって、
 * happy path の確認を目的にしたものではない。
 *
 * このルートは 2026-08 に自動返信メールとSMSの2経路が増えたため、
 * 共通ルートと同じガードをこちらにも用意する。
 *
 * 限界(意図的):
 * - Gmail 送信は EMAIL_DRY_RUN=true で送信手前で止めている。**global fetch は通る**
 *   （gmail-client.ts が gmail.googleapis.com を fetch する。google-auth-library 経由なのは
 *   トークン取得のみ）。将来 dry-run を外すなら googleapis.com を許可リストに足すこと。
 * - ランタイムテストなので、与えた入力で実行される経路しかカバーしない。
 */

const ALLOWED_HOSTS = new Set([
  'open.larksuite.com', // Lark Bot通知 webhook
  'test-base.jp.larksuite.com', // Lark Base Automation webhook（本番と同じURL形式のダミー）
  'leomeet.pmagent.jp', // eeasy SMS 共通エンドポイント
  'graph.facebook.com', // Meta Conversions API
  // script.google.com は **意図的に外している**。
  // 選択肢マスタ(GAS)の取得は LP 側の /api/coupang/step1-options だけの仕事で、
  // 応募POSTの経路からは 2026-09-10 に外した（恒等一致にしかならないのに 5〜68秒待たされていた）。
  // 誰でもエンドポイントを公開できるホストなので、応募者の個人情報を持つこの経路からは
  // 「触らない」を保証する。
]);

function hostOf(input: unknown): string {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String((input as { url?: string })?.url ?? input);
  return new URL(url).hostname;
}

const ALLOWLISTED_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  LARK_WEBHOOK_URL_COUPANG: 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaaaaaa',
  LARK_BASE_WEBHOOK_URL_COUPANG_PROD:
    'https://test-base.jp.larksuite.com/base/automation/webhook/event/bbbbbbbb',
  GAS_COUPANG_STEP1_OPTIONS_API_URL: 'https://script.google.com/macros/s/dummy/exec',
  META_SMS_ENABLED: 'true',
  EEASY_SMS_SEND_URL: 'https://leomeet.pmagent.jp/api/sms/send',
  SMS_SEND_SECRET: 'test-secret',
  NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
  META_CAPI_ACCESS_TOKEN: 'test-capi-token',
  GMAIL_SENDER_EMAIL: 'support_team@pmagent.jp',
  EMAIL_DRY_RUN: 'true',
  // クーパンのメール/SMSは既定OFF。経路を実際に通すためテストでは点火する。
  COUPANG_EMAIL_ENABLED: 'true',
  COUPANG_SMS_ENABLED: 'true',
};

function makeRequest(body: unknown) {
  // ハンドラが request.cookies を読むため、素の Request では落ちる。
  return new NextRequest('https://ridejob.jp/entry/api/coupang/applicants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://ridejob.jp/entry/coupang',
      'user-agent': 'vitest',
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
  metaEventId: 'evt-coupang-allowlist-test',
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

describe('coupang applicants POST — outbound host allowlist', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const [key, value] of Object.entries(ALLOWLISTED_ENV)) {
      vi.stubEnv(key, value);
    }
    fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, code: 0, StatusCode: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    // capi.ts は env をモジュール読み込み時に取り込むため、毎回作り直す。
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('許可リスト外のホストへ送信しない', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(coupangBody));
    expect(res.status).toBe(200);

    const hosts = fetchSpy.mock.calls.map((call) => hostOf(call[0]));
    expect(hosts.length).toBeGreaterThan(0);

    const offlist = hosts.filter((host) => !ALLOWED_HOSTS.has(host));
    expect(offlist, `想定外の送信先: ${offlist.join(', ')}`).toEqual([]);
  });

  it('Lark通知・Base・SMS・CAPI の経路を実際に通っている(ガードが空振りでない)', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(coupangBody));

    const hosts = new Set(fetchSpy.mock.calls.map((call) => hostOf(call[0])));
    expect(hosts.has('open.larksuite.com')).toBe(true);
    expect(hosts.has('test-base.jp.larksuite.com')).toBe(true);
    expect(hosts.has('leomeet.pmagent.jp')).toBe(true);
    expect(hosts.has('graph.facebook.com')).toBe(true);
  });

  it('SMSは coupang チャネルで送る(eeasy 側の登録名と一致させる)', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(coupangBody));

    const smsCall = fetchSpy.mock.calls.find(
      (call) => hostOf(call[0]) === 'leomeet.pmagent.jp',
    );
    expect(smsCall, 'SMS 送信が呼ばれていない').toBeTruthy();
    const body = JSON.parse((smsCall![1] as RequestInit).body as string);
    expect(body.channel).toBe('coupang');
    // media は生の utm_source ではなく正規化した値
    expect(body.media).toBe('ig');
  });

  it('script.google.com には一切触らない(応募POSTからGASを引かない)', async () => {
    // script.google.com は誰でもエンドポイントを公開できるホスト。
    // このルートは応募者の個人情報を持つので、触らないことを保証する。
    // 2026-09-10 まではラベル変換のために GET していたが、投稿値が既に最終ラベルのため
    // 恒等一致にしかならず、GAS の遅延(実測5〜68秒)と404を応募者に転嫁していただけだった。
    const { POST } = await import('./route');
    await POST(makeRequest(coupangBody));

    const gasCalls = fetchSpy.mock.calls.filter((call) => hostOf(call[0]) === 'script.google.com');
    expect(gasCalls.length, 'GAS へ触れている').toBe(0);
  });

  it('ラベルはGASなしでも日本語のまま Base へ載る', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(coupangBody));

    const baseCall = fetchSpy.mock.calls.find((call) =>
      String(call[0]).includes('/base/automation/webhook/event/'),
    );
    expect(baseCall, 'Base webhook が呼ばれていない').toBeTruthy();
    const payload = JSON.parse((baseCall![1] as RequestInit).body as string);
    expect(payload.desired_location).toBe('東京');
    expect(payload.job_position).toBe('アカウントマネージャー');
  });

  it('LIFT JOB通知に配置・キャンペーン・CR・広告・LPが載る', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(coupangBody));

    const notifyCall = fetchSpy.mock.calls.find((call) =>
      String(call[0]).includes('/bot/v2/hook/'),
    );
    expect(notifyCall, 'Lark通知 webhook が呼ばれていない').toBeTruthy();
    const payload = JSON.parse((notifyCall![1] as RequestInit).body as string);
    const message = payload.content.text as string;
    expect(message).toContain('LIFT JOB（ロケットナウ）の応募');
    expect(message).toContain('流入経路: Instagram広告（cpc）');
    expect(message).toContain('キャンペーンID: 120234567890');
    expect(message).toContain('広告セットID: 120234567891');
    expect(message).toContain('CR-ID: CR-2608-30');
    expect(message).toContain('広告ID: 120234567892');
    expect(message).toContain('LP: https://ridejob.jp/entry/coupang?utm_source=ig&utm_medium=cpc');
  });

  it('Base payloadに経路の証跡とUTM v3を欠落なく載せる', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(coupangBody));

    const baseCall = fetchSpy.mock.calls.find((call) =>
      String(call[0]).includes('/base/automation/webhook/event/'),
    );
    expect(baseCall, 'Base webhook が呼ばれていない').toBeTruthy();
    const payload = JSON.parse((baseCall![1] as RequestInit).body as string);
    expect(payload).toMatchObject({
      media_name: 'Meta広告',
      application_source: 'ig(ad)',
      utm_source: 'ig',
      utm_medium: 'cpc',
      utm_campaign: '120234567890',
      utm_term: '120234567891',
      utm_content: 'CR-2608-30',
      utm_id: '120234567892',
      utm_creative: 'CR-2608-30_SALES_未経験から法人営業',
      ad_id: '120234567892',
      ad_creative_id: '',
      ad_image_url: '',
      page_url: 'https://ridejob.jp/entry/coupang?utm_source=ig&utm_medium=cpc',
      landing_path: '/entry/coupang',
      initial_referrer: 'https://l.instagram.com/',
      attribution_source: 'query',
      form_origin: 'coupang_rocketnow',
      is_coupang: true,
    });
  });

  it('UTMが無い応募をRIDEJOB HPやMeta広告と推測で埋めない', async () => {
    const { buildLiftJobBasePayload, describeLiftJobRoute, getLiftJobMediaName } = await import('./route');
    expect(describeLiftJobRoute({})).toBe('経路不明（UTM未取得）');
    expect(getLiftJobMediaName({})).toBe('経路不明');
    const payload = buildLiftJobBasePayload({
      utm: {},
      adId: '',
      adCreativeId: '',
      adImageUrl: '',
      formData: coupangBody as CoupangFormData,
      jobPositionLabel: coupangBody.jobPosition,
      desiredLocationLabel: coupangBody.desiredLocation,
      pageUrl: coupangBody.pageUrl,
      landingPath: coupangBody.landingPath,
      initialReferrer: '',
      attributionSource: 'direct',
      userAgent: 'vitest',
      clientIp: '',
      submittedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(payload.application_source).toBe('');
  });

  it('organicや区分不明のMeta系流入を広告と誤表示しない', async () => {
    const { describeLiftJobRoute, getLiftJobMediaName } = await import('./route');
    expect(describeLiftJobRoute({ utm_source: 'ig', utm_medium: 'organic' })).toBe(
      'Instagram（organic）',
    );
    expect(getLiftJobMediaName({ utm_source: 'ig', utm_medium: 'organic' })).not.toBe('Meta広告');
    expect(describeLiftJobRoute({ utm_source: 'fb' })).toBe('Facebook（流入区分未取得）');
  });

  it('壊れたCookie由来の非string UTMでも応募を500にしない', async () => {
    const malformed = {
      ...coupangBody,
      utmParams: {
        utm_source: 123,
        utm_medium: { bad: true },
        utm_campaign: null,
      },
    };
    const { POST } = await import('./route');
    const res = await POST(makeRequest(malformed));
    expect(res.status).toBe(200);

    const baseCall = fetchSpy.mock.calls.find((call) =>
      String(call[0]).includes('/base/automation/webhook/event/'),
    );
    const payload = JSON.parse((baseCall![1] as RequestInit).body as string);
    expect(payload.utm_source).toBe('123');
    expect(payload.utm_medium).toBe('');
  });

  it('toStringできないオブジェクト相当のUTMも空欄として扱う', async () => {
    const hostileObject = { toString: null } as unknown as string;
    const { buildLiftJobBasePayload } = await import('./route');
    const payload = buildLiftJobBasePayload({
      utm: { utm_source: hostileObject },
      adId: '',
      adCreativeId: '',
      adImageUrl: '',
      formData: coupangBody as CoupangFormData,
      jobPositionLabel: coupangBody.jobPosition,
      desiredLocationLabel: coupangBody.desiredLocation,
      pageUrl: coupangBody.pageUrl,
      landingPath: coupangBody.landingPath,
      initialReferrer: '',
      attributionSource: 'direct',
      userAgent: 'vitest',
      clientIp: '',
      submittedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(payload.utm_source).toBe('');
  });

  it('旧クライアントがlandingPathを送らなくてもpageUrlから/entryを復元する', async () => {
    const legacyBody = { ...coupangBody } as Record<string, unknown>;
    delete legacyBody.landingPath;
    const { POST } = await import('./route');
    await POST(makeRequest(legacyBody));

    const baseCall = fetchSpy.mock.calls.find((call) =>
      String(call[0]).includes('/base/automation/webhook/event/'),
    );
    const payload = JSON.parse((baseCall![1] as RequestInit).body as string);
    expect(payload.landing_path).toBe('/entry/coupang');
  });

  it('Lark通知が落ちても応募は成立し、SMSとCAPIは送られる', async () => {
    // 応募を落とさないことの番人。通知の失敗で応募データまで失うのが最悪の壊れ方。
    fetchSpy.mockImplementation(async (input: unknown) => {
      if (hostOf(input) === 'open.larksuite.com' && String(input).includes('/bot/v2/hook/')) {
        throw new TypeError('fetch failed');
      }
      return new Response(JSON.stringify({ ok: true, code: 0, StatusCode: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(coupangBody));

    expect(res.status).toBe(200);
    const hosts = new Set(fetchSpy.mock.calls.map((call) => hostOf(call[0])));
    expect(hosts.has('leomeet.pmagent.jp')).toBe(true);
    expect(hosts.has('graph.facebook.com')).toBe(true);
  });

  it('Larkが HTTP200 でも code!==0 なら失敗として記録する', async () => {
    // 200 だけ見て成功扱いにすると、bot除外やトークン失効で届いていないのに
    // 「sent successfully」と記録され、無言の断線に気づけない。
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown) => {
      const isLarkNotify =
        hostOf(input) === 'open.larksuite.com' && String(input).includes('/bot/v2/hook/');
      return new Response(
        JSON.stringify(isLarkNotify ? { code: 19001, msg: 'bot not in chat' } : { code: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(coupangBody));

    expect(res.status).toBe(200);
    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('Failed to send notification to Lark');
    expect(logged).toContain('19001');
    errorSpy.mockRestore();
  });

  it('Larkが HTTP200 でも空本文なら失敗として記録する', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown) => {
      const isLarkNotify =
        hostOf(input) === 'open.larksuite.com' && String(input).includes('/bot/v2/hook/');
      return isLarkNotify
        ? new Response('', { status: 200 })
        : new Response(JSON.stringify({ code: 0, StatusCode: 0 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(coupangBody));

    expect(res.status).toBe(200);
    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('Failed to send notification to Lark');
    expect(logged).toContain('code=n/a');
    errorSpy.mockRestore();
  });

  it('Base Webhookが HTTP200 でも StatusCode!==0 なら失敗として記録する', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown) => {
      const isBase =
        hostOf(input) === 'test-base.jp.larksuite.com' &&
        String(input).includes('/base/automation/webhook/event/');
      return new Response(
        JSON.stringify(isBase ? { StatusCode: 4001, StatusMessage: 'mapping failed' } : { code: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(coupangBody));

    expect(res.status).toBe(200);
    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('Failed to send to Lark Base Webhook');
    expect(logged).toContain('4001');
    errorSpy.mockRestore();
  });

  it('Base Webhookが HTTP200 でも非JSONなら失敗として記録する', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown) => {
      const isBase =
        hostOf(input) === 'test-base.jp.larksuite.com' &&
        String(input).includes('/base/automation/webhook/event/');
      return isBase
        ? new Response('accepted', { status: 200, headers: { 'content-type': 'text/plain' } })
        : new Response(JSON.stringify({ code: 0, StatusCode: 0 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(coupangBody));

    expect(res.status).toBe(200);
    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('Failed to send to Lark Base Webhook');
    expect(logged).toContain('code=n/a');
    errorSpy.mockRestore();
  });

  it('許可外の通知Webhookは応募者情報を送る前に拒否する', async () => {
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG', 'https://evil.example.com/hook/test');
    vi.resetModules();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('./route');
    const res = await POST(makeRequest(coupangBody));

    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Lark Webhook URL is missing or invalid for Coupang.');
    errorSpy.mockRestore();
  });

  it('許可外のBase Webhookは応募者情報を送る前に拒否する', async () => {
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_COUPANG_PROD', 'https://evil.example.com/base/test');
    vi.resetModules();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('./route');
    const res = await POST(makeRequest(coupangBody));

    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Lark Base Webhook URL is missing or invalid for Coupang.');
    errorSpy.mockRestore();
  });

  it('フラグOFFならメールもSMSも送らない(既定の安全側)', async () => {
    vi.stubEnv('COUPANG_EMAIL_ENABLED', 'false');
    vi.stubEnv('COUPANG_SMS_ENABLED', 'false');
    vi.resetModules();
    const { POST } = await import('./route');
    await POST(makeRequest(coupangBody));

    const hosts = new Set(fetchSpy.mock.calls.map((call) => hostOf(call[0])));
    expect(hosts.has('leomeet.pmagent.jp')).toBe(false);
    // Lark と CAPI は従来どおり動く（フラグは応募者への送信2経路だけを止める）
    expect(hosts.has('open.larksuite.com')).toBe(true);
    expect(hosts.has('graph.facebook.com')).toBe(true);
  });

  it('許可リストの判定自体が機能する', () => {
    expect(ALLOWED_HOSTS.has('evil.example.com')).toBe(false);
    expect(hostOf('https://open.larksuite.com/x')).toBe('open.larksuite.com');
  });
});
