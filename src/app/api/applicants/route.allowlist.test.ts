import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 送信先ホストの許可リストガード。
 *
 * このテストは「正しい happy path」を確認するためのものではなく、
 * 応募者の個人情報が許可リスト外のホストへ送られる変更を CI で止めるための番人。
 *
 * 仕組み: global.fetch をスパイに差し替え、外部送信の全経路(Lark webhook /
 * Base webhook / SMS / Meta CAPI)を「許可リスト内のホスト」に向けて有効化した
 * 状態で POST ハンドラを実走させ、記録された fetch 先ホストがすべて許可リストに
 * 収まることを検証する。route.ts に新しい fetch 先が紛れ込めば、そのホストは
 * 許可リストに無いので fail する。
 *
 * 限界(意図的):
 * - Gmail 送信は google-auth-library(gaxios)経由で global.fetch を通らないため、
 *   このスパイでは観測できない。宛先(googleapis.com)はライブラリ内で固定であり、
 *   この API ハンドラからは差し替えられない。テストでは EMAIL_DRY_RUN=true にして
 *   Gmail 経路を手前で止める。
 * - ランタイムテストなので、与えた入力で実行される経路しかカバーしない。
 *   送信先を「リクエスト本文やテストが設定しない env」から動的に組み立てる細工は
 *   検出できない(= route.ts の残存リスクとして受容済み)。
 */

const ALLOWED_HOSTS = new Set([
  'open.larksuite.com', // Lark webhook / Base webhook
  'leomeet.pmagent.jp', // eeasy SMS 共通エンドポイント
  'graph.facebook.com', // Meta Conversions API
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
  GMAIL_SENDER_EMAIL: 'support_team@pmagent.jp',
  EMAIL_DRY_RUN: 'true',
};

function makeRequest(body: unknown) {
  // The handler reads request.cookies (NextRequest-only), so a plain Request
  // would throw. Construct a NextRequest.
  return new NextRequest('https://ridejob.jp/api/applicants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://ridejob.jp/',
      'user-agent': 'vitest',
    },
    body: JSON.stringify(body),
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
  metaEventId: 'evt-allowlist-test',
  utmParams: { utm_source: 'google', utm_medium: 'search' },
};

describe('applicants POST — outbound host allowlist', () => {
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

  beforeEach(() => {
    for (const [key, value] of Object.entries(ALLOWLISTED_ENV)) {
      vi.stubEnv(key, value);
    }
    fetchSpy = vi.fn(successResponse);
    vi.stubGlobal('fetch', fetchSpy);
    // capi.ts snapshots env at module load, so force a fresh module graph.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('only contacts allowlisted hosts while handling a full submission', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);

    const hosts = fetchSpy.mock.calls.map((call) => hostOf(call[0]));
    expect(hosts.length).toBeGreaterThan(0);

    const offlist = hosts.filter((host) => !ALLOWED_HOSTS.has(host));
    expect(offlist, `unexpected outbound host(s): ${offlist.join(', ')}`).toEqual([]);
  });

  it('actually exercises the Lark, SMS and CAPI paths (guard is not vacuous)', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest(applicantBody));

    const hosts = new Set(fetchSpy.mock.calls.map((call) => hostOf(call[0])));
    expect(hosts.has('open.larksuite.com')).toBe(true);
    expect(hosts.has('leomeet.pmagent.jp')).toBe(true);
    expect(hosts.has('graph.facebook.com')).toBe(true);
  });

  it('treats an HTTP 200 Lark API error body as a notification failure', async () => {
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/im/v1/messages')) return Response.json({ code: 19021, msg: 'message rejected' });
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(502);
  });

  // 2026-09-17〜09-23: Base 保存が失敗すると 500 を返して通知も出していなかったため、
  // 自社LP経由の応募が5日間まるごと失われた（約90件）。Base に入らなくても通知だけは必ず出す。
  it('Bitable が HTTP200 でエラー本文を返しても、応募は通して通知を出す', async () => {
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);
    const messageCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/im/v1/messages'));
    // 直書きは失敗しても Base Webhook へフォールバックするので、レコードは残る
    expect(messageCalls.length, 'Base が落ちたときこそ通知が唯一の記録になる').toBeGreaterThan(0);
  });

  it('直書きも Base Webhook も落ちたら、通知に「Base未登録」を立てたうえで応募は通す', async () => {
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      if (url.includes('/anycross/trigger/')) {
        return Response.json({ code: 4001, msg: 'automation stopped' });
      }
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);
    const messageCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/im/v1/messages'));
    expect(messageCalls.length, 'Base に残らない応募こそ通知が唯一の記録').toBeGreaterThan(0);
    const sent = messageCalls.map(([, init]) => String((init as RequestInit)?.body ?? '')).join('\n');
    expect(sent, '手入力が要ることが通知の先頭で分かること').toContain('Base未登録');
  });

  it('the allowlist check itself has teeth', () => {
    // A regression that adds fetch('https://evil.example/...') must be caught.
    expect(ALLOWED_HOSTS.has(hostOf('https://evil.example/steal'))).toBe(false);
  });
});
