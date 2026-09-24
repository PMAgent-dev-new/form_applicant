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
  'tdlnowmdanapxmgebaqu.supabase.co', // 応募の退避先(submission_vault)
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
  SUBMISSION_VAULT_URL: 'https://tdlnowmdanapxmgebaqu.supabase.co',
  SUBMISSION_VAULT_SERVICE_KEY: 'test-vault-key',
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

  // 2026-09-23: 通知の失敗で 502 を返していたため、応募者に「エラーが発生しました」が出て
  // 送信を繰り返し、冪等性の無い Base Webhook 経由で同じ応募が最大15行に増えた。
  // 応募が Base に残っているなら、通知の失敗は応募者に再送させる理由にならない。
  it('通知が HTTP200 のエラー本文で失敗しても、応募は通して退避に残す', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/im/v1/messages')) return Response.json({ code: 19021, msg: 'message rejected' });
      if (url.includes('/bot/v2/hook/')) return Response.json({ code: 19021, msg: 'message rejected' });
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status, '再送させないこと。再送は重複を増やすだけ').toBe(200);
    const vaultCalls = fetchSpy.mock.calls.filter(
      ([input, init]) => String(input).includes('/rest/v1/submission_vault')
        && (init as RequestInit)?.method === 'POST',
    );
    expect(vaultCalls.length, '誰も気づいていないので退避に残すこと').toBe(1);
    const body = JSON.parse(String((vaultCalls[0][1] as RequestInit)?.body ?? '{}'));
    expect(body.notified, '通知は出せていないと記録すること').toBe(false);
    errorSpy.mockRestore();
  });

  // 2026-09-24: 通知先の設定漏れは Base 保存より手前で 500 を返しており、
  // 応募内容がどこにも残らなかった。設定漏れは無音でデプロイされるので、
  // ここが最後の受け皿になる（newmedia で 2026-09-21 に実際に起きた形）。
  it('通知先が未設定でも、退避に残せたなら応募を通す', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('LARK_SUBMIT_CHAT_ID_RIDEJOB', '');
    vi.stubEnv('LARK_WEBHOOK_URL', '');
    vi.stubEnv('LARK_WEBHOOK_URL_TEST', '');

    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));

    const vaultCalls = fetchSpy.mock.calls.filter(
      ([input, init]) => String(input).includes('/rest/v1/submission_vault')
        && (init as RequestInit)?.method === 'POST',
    );
    expect(vaultCalls.length, '設定漏れで応募を捨てないこと').toBe(1);
    const body = JSON.parse(String((vaultCalls[0][1] as RequestInit)?.body ?? '{}'));
    expect(body.reason, '何が未設定だったか分からないと復旧できない').toContain('not configured');
    expect(body.submission_id, '冪等キーが無いと取り込み時に重複する').toBeTruthy();
    expect(res.status, '退避に残っているので再送させない').toBe(200);

    errorSpy.mockRestore();
  });

  it('通知先が未設定で退避にも失敗したら 500 を返す（どこにも残らないため）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('LARK_SUBMIT_CHAT_ID_RIDEJOB', '');
    vi.stubEnv('LARK_WEBHOOK_URL', '');
    vi.stubEnv('LARK_WEBHOOK_URL_TEST', '');
    const base = fetchSpy.getMockImplementation() as (input: unknown, init?: RequestInit) => Promise<Response>;
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      if (String(input).includes('/rest/v1/submission_vault')) return new Response('boom', { status: 503 });
      return base(input, init);
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status, '本当にどこにも残らないときだけ 500').toBe(500);

    errorSpy.mockRestore();
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
    // 直書きは失敗しても Base Webhook へフォールバックするので、レコードは残る。
    // 「フォールバックした」はログではなく呼び出しの実物で確かめる。
    const fallbackCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/anycross/trigger/'));
    expect(fallbackCalls.length, 'Base Webhook へフォールバックすること').toBeGreaterThan(0);
    const messageCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/im/v1/messages'));
    expect(messageCalls.length, 'Base が落ちたときこそ通知が唯一の記録になる').toBeGreaterThan(0);
    const sent = messageCalls.map(([, init]) => String((init as RequestInit)?.body ?? '')).join('\n');
    expect(sent, '直書きが失敗したことが通知から分かること').toContain('Base直書き失敗');
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

  // レビュー②の指摘: Base が全滅しているときに IM API まで落ちると、
  // 以前は 502 で抜けて応募がどこにも残らなかった。そのときだけ Webhook 通知へ落とす。
  it('Base が全滅し IM API も落ちたら、Webhook 通知へ落として応募は通す', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      if (url.includes('/anycross/trigger/')) return Response.json({ code: 4001, msg: 'automation stopped' });
      if (url.includes('/im/v1/messages')) return Response.json({ code: 19021, msg: 'message rejected' });
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);
    const hookCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/bot/v2/hook/'));
    expect(hookCalls.length, 'IM API が落ちても Webhook 通知で応募を残すこと').toBeGreaterThan(0);
    const sent = hookCalls.map(([, init]) => String((init as RequestInit)?.body ?? '')).join('\n');
    expect(sent).toContain('Base未登録');
    errorSpy.mockRestore();
  });

  // Lark に入らなかった応募は Supabase の退避先に残す。通知は流れて埋もれるため、
  // 「取りこぼした応募」を後から機械的に数えられる受け皿が要る。
  it('Base が全滅したら応募内容を退避先へ書き、通知に「退避済み」と出す', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      if (url.includes('/anycross/trigger/')) return Response.json({ code: 4001, msg: 'automation stopped' });
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);

    const vaultCalls = fetchSpy.mock.calls.filter(
      ([input, init]) => String(input).includes('/rest/v1/submission_vault')
        && (init as RequestInit)?.method === 'POST',
    );
    expect(vaultCalls.length, 'Base に入らなかった応募は退避すること').toBe(1);
    const body = JSON.parse(String((vaultCalls[0][1] as RequestInit)?.body ?? '{}'));
    expect(body.source).toBe('form_applicant/applicants');
    expect(body.kind).toBe('application');
    expect(body.submission_id, '冪等キーを持たせて再送を1行に畳めること').toBeTruthy();
    expect(body.reason, 'なぜ退避したかが分かること').toContain('4001');
    expect(body.payload?.full_name, '応募内容そのものが残ること').toBeTruthy();

    const messageCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/im/v1/messages'));
    const sent = messageCalls.map(([, init]) => String((init as RequestInit)?.body ?? '')).join('\n');
    expect(sent, '通知から退避済みだと分かること').toContain('退避済み');
    errorSpy.mockRestore();
  });

  it('退避先が落ちても応募は通す（退避は応募の成否に影響させない）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (new URL(url).pathname.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      if (url.includes('/anycross/trigger/')) return Response.json({ code: 4001, msg: 'automation stopped' });
      if (url.includes('/rest/v1/submission_vault')) return new Response('boom', { status: 503 });
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);
    const messageCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/im/v1/messages'));
    const sent = messageCalls.map(([, init]) => String((init as RequestInit)?.body ?? '')).join('\n');
    expect(sent, '退避にも失敗したことが通知で分かること').toContain('退避も失敗');
    errorSpy.mockRestore();
  });

  // 2026-09-23 の重複事故の回帰テスト。
  it('直近に同じ電話番号の応募があれば Base Webhook を呼ばない', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const path = new URL(url).pathname;
      // 直書きは失敗させる（いまの本番と同じ状況）
      if (path.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      // 重複チェックの検索には「直近の同じ電話番号」を1件返す
      if (path.endsWith('/records/search')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const cond = body?.filter?.conditions?.[0];
        if (cond?.field_name === '電話番号') {
          return Response.json({
            code: 0,
            data: { items: [{ record_id: 'rec_existing', fields: { 応募日: Date.now() } }] },
          });
        }
        return Response.json({ code: 0, data: { items: [] } });
      }
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);
    const webhookCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/anycross/trigger/'));
    expect(webhookCalls.length, '重複を作らないこと').toBe(0);
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('重複とみなした既存レコードには書き戻さない（他人のメモと冪等キーを消さないため）', async () => {
    // putRecord は PUT で列を**置換**する。重複先は自分が作った行ではないので、
    // ここへ通知済み印を書くと営業の記入・[submission_id:] 冪等キー・カタログ帰属行が消える。
    // 冪等キーが消えると直書き経路が同じ応募をもう一度作る＝重複を止める処理が重複を作る。
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const path = new URL(url).pathname;
      if (path.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      if (path.endsWith('/records/search')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body?.filter?.conditions?.[0]?.field_name === '電話番号') {
          return Response.json({
            code: 0,
            data: {
              items: [{
                record_id: 'rec_existing',
                fields: { 応募日: Date.now(), 対応履歴メモ: '[submission_id:other]\n営業が架電済み' },
              }],
            },
          });
        }
        return Response.json({ code: 0, data: { items: [] } });
      }
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);

    const writes = fetchSpy.mock.calls.filter(
      ([input, init]) => String(input).includes('/records/rec_existing')
        && ['PUT', 'PATCH'].includes(String((init as RequestInit)?.method ?? '')),
    );
    expect(writes.length, '既存レコードを書き換えないこと').toBe(0);

    // 人が気づけるよう、通知は「再送・行は増やしていない」と分かる形で出す。
    const im = fetchSpy.mock.calls.find(([input]) => String(input).includes('/im/v1/messages'));
    expect(im, '重複でも通知は出すこと').toBeTruthy();
    expect(String((im?.[1] as RequestInit)?.body ?? '')).toContain('再送');

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('直近に同じ電話番号が無ければ、これまでどおり Base Webhook で保存する', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const path = new URL(url).pathname;
      if (path.endsWith('/records') && init?.method === 'POST') {
        return Response.json({ code: 4001, msg: 'mapping failed' });
      }
      if (path.endsWith('/records/search')) return Response.json({ code: 0, data: { items: [] } });
      return successResponse(input, init);
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest(applicantBody));
    expect(res.status).toBe(200);
    const webhookCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/anycross/trigger/'));
    expect(webhookCalls.length, '新規の応募は取りこぼさないこと').toBe(1);
    errorSpy.mockRestore();
  });

  it('the allowlist check itself has teeth', () => {
    // A regression that adds fetch('https://evil.example/...') must be caught.
    expect(ALLOWED_HOSTS.has(hostOf('https://evil.example/steal'))).toBe(false);
  });
});
