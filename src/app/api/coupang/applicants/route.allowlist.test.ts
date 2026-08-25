import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
 * - Gmail 送信は google-auth-library 経由で global.fetch を通らないため観測できない。
 *   宛先(googleapis.com)はライブラリ内で固定。テストでは EMAIL_DRY_RUN=true にして
 *   Gmail 経路を手前で止める。
 * - ランタイムテストなので、与えた入力で実行される経路しかカバーしない。
 */

const ALLOWED_HOSTS = new Set([
  'open.larksuite.com', // Lark 通知 webhook / Base webhook
  'leomeet.pmagent.jp', // eeasy SMS 共通エンドポイント
  'graph.facebook.com', // Meta Conversions API
  'script.google.com', // 職種×勤務地の選択肢マスタ(GAS)
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
  LARK_BASE_WEBHOOK_URL_COUPANG_PROD: 'https://open.larksuite.com/anycross/trigger/bbbbbbbb',
  GAS_COUPANG_STEP1_OPTIONS_API_URL: 'https://script.google.com/macros/s/dummy/exec',
  META_SMS_ENABLED: 'true',
  EEASY_SMS_SEND_URL: 'https://leomeet.pmagent.jp/api/sms/send',
  SMS_SEND_SECRET: 'test-secret',
  NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
  META_CAPI_ACCESS_TOKEN: 'test-capi-token',
  GMAIL_SENDER_EMAIL: 'support_team@pmagent.jp',
  EMAIL_DRY_RUN: 'true',
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
  utmParams: { utm_source: 'ig', utm_medium: 'cpc', utm_content: 'CR-2608-30' },
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

  it('Lark・SMS・CAPI の経路を実際に通っている(ガードが空振りでない)', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(coupangBody));

    const hosts = new Set(fetchSpy.mock.calls.map((call) => hostOf(call[0])));
    expect(hosts.has('open.larksuite.com')).toBe(true);
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

  it('許可リストの判定自体が機能する', () => {
    expect(ALLOWED_HOSTS.has('evil.example.com')).toBe(false);
    expect(hostOf('https://open.larksuite.com/x')).toBe('open.larksuite.com');
  });
});
