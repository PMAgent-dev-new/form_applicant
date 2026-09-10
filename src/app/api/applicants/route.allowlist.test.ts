import { format } from 'node:util';
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
  LARK_BASE_WEBHOOK_URL: 'https://open.larksuite.com/anycross/trigger/bbbbbbbb',
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 本文を文字列のまま渡す（壊れた JSON を送るため）。 */
function makeRawRequest(rawBody: string) {
  return new NextRequest('https://ridejob.jp/api/applicants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://ridejob.jp/',
      'user-agent': 'vitest',
    },
    body: rawBody,
  });
}

type ConsoleSpy = { mock: { calls: unknown[][] } };

/** 応募1件ごとに出るサマリ行（`[applicants] submission settled:` ＋ 1行の JSON）の中身。 */
function settledSummaries(logSpy: ConsoleSpy) {
  return logSpy.mock.calls
    .filter((call) => call[0] === '[applicants] submission settled:')
    .map((call) => JSON.parse(String(call[1])) as Record<string, unknown>);
}

/** console に実際に出る文字列（Error はスタック込み、オブジェクトは inspect 済み）に直す。 */
function printed(...spies: ConsoleSpy[]) {
  return spies.flatMap((spy) => spy.mock.calls.map((call) => format(call[0], ...call.slice(1))));
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
    // capi.ts snapshots env at module load, so force a fresh module graph.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it('the allowlist check itself has teeth', () => {
    // A regression that adds fetch('https://evil.example/...') must be caught.
    expect(ALLOWED_HOSTS.has(hostOf('https://evil.example/steal'))).toBe(false);
  });

  /**
   * 副作用（Lark通知・Base保存・メール・SMS・CAPI）の失敗を無言にしない。
   * 以前は各タスクが try/catch を持たず、fetch の throw を Promise.allSettled が握りつぶして
   * 成功ログも失敗ログも残らなかった（クーパン専用ルートで 2026-09-10 に本番で発生。PR #79）。
   */
  describe('副作用の失敗を無言にしない', () => {
    const allOk = () => jsonResponse({ ok: true, code: 0, StatusCode: 0 });

    it('Lark通知が落ちても応募は成立し、Base・SMS・CAPIは送られる（例外はログに残す）', async () => {
      // 応募を落とさないことの番人。通知の失敗で応募データまで失うのが最悪の壊れ方。
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) => {
        if (String(input).includes('/bot/v2/hook/')) throw new TypeError('fetch failed');
        return allOk();
      });
      const { POST } = await import('./route');
      const res = await POST(makeRequest(applicantBody));

      expect(res.status).toBe(200);
      const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes('/anycross/trigger/'))).toBe(true);
      expect(urls.some((url) => hostOf(url) === 'leomeet.pmagent.jp')).toBe(true);
      expect(urls.some((url) => hostOf(url) === 'graph.facebook.com')).toBe(true);
      expect(printed(errorSpy).join('\n')).toContain(
        'lark-notification threw and was swallowed: TypeError: fetch failed',
      );
      expect(settledSummaries(logSpy)[0]?.failed).toEqual(['lark-notification']);
    });

    it('Larkが HTTP200 でも code!==0 なら失敗として記録する', async () => {
      // 200 だけ見て成功扱いにすると、bot除外やトークン失効で届いていないのに
      // 「sent successfully」と記録され、無言の断線に気づけない。
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) =>
        String(input).includes('/bot/v2/hook/')
          ? jsonResponse({ code: 19001, msg: 'bot not in chat' })
          : allOk(),
      );
      const { POST } = await import('./route');
      const res = await POST(makeRequest(applicantBody));

      expect(res.status).toBe(200);
      const logged = printed(errorSpy).join('\n');
      expect(logged).toContain('Failed to send notification to Lark');
      expect(logged).toContain('code=19001');
      expect(settledSummaries(logSpy)[0]?.failed).toEqual(['lark-notification']);
    });

    it('Base Webhook が HTTP エラーなら、レコード未保存(lark-base)として記録する', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) =>
        String(input).includes('/anycross/trigger/')
          ? jsonResponse({ code: 1254302, msg: 'permission denied' }, 403)
          : allOk(),
      );
      const { POST } = await import('./route');
      const res = await POST(makeRequest(applicantBody));

      expect(res.status).toBe(200);
      expect(printed(errorSpy).join('\n')).toContain(
        'Failed to send to Lark Base Webhook (http=403 code=1254302',
      );
      expect(settledSummaries(logSpy)[0]).toMatchObject({ failed: ['lark-base'], base: 'none' });
    });

    it('Base Webhook が HTTP200 で code≠0 を返しても失敗には数えず、警告だけ残す', async () => {
      // Base 自動化 Webhook が成功時に何を返すかは一次情報が無い。決めつけると誤警報になりうるので、
      // HTTP ステータスで判定し（PR #79 と同じ）、code は警告として見えるようにする。
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) =>
        String(input).includes('/anycross/trigger/')
          ? jsonResponse({ code: 1254302, msg: 'permission denied' })
          : allOk(),
      );
      const { POST } = await import('./route');
      await POST(makeRequest(applicantBody));

      expect(printed(warnSpy).join('\n')).toContain('code=1254302');
      expect(settledSummaries(logSpy)[0]).toMatchObject({ failed: [], base: 'webhook' });
    });

    it('Base Webhook が throw しても応募は成立し、lark-base と例外がログに残る', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) => {
        if (String(input).includes('/anycross/trigger/')) {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        }
        return allOk();
      });
      const { POST } = await import('./route');
      const res = await POST(makeRequest(applicantBody));

      expect(res.status).toBe(200);
      expect(printed(errorSpy).join('\n')).toContain(
        'lark-base threw and was swallowed: TimeoutError: The operation was aborted due to timeout',
      );
      expect(settledSummaries(logSpy)[0]).toMatchObject({ failed: ['lark-base'], base: 'none' });
    });

    it('SMS・CAPI の HTTP エラーも失敗として集計する（throw だけ拾うとサマリが「失敗0件」と嘘をつく）', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) => {
        const host = hostOf(input);
        if (host === 'leomeet.pmagent.jp') return jsonResponse({ ok: false, error: 'BAD_REQUEST' }, 400);
        if (host === 'graph.facebook.com') return jsonResponse({ error: { message: 'Invalid parameter' } }, 400);
        return allOk();
      });
      const { POST } = await import('./route');
      const res = await POST(makeRequest(applicantBody));

      expect(res.status).toBe(200);
      const failed = settledSummaries(logSpy)[0]?.failed as string[];
      expect([...failed].sort()).toEqual(['application-sms', 'meta-capi']);
    });

    it('応募1件につきサマリを1行だけ出す（全経路が成功なら failed は空）', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { POST } = await import('./route');
      await POST(makeRequest(applicantBody));

      const summaries = settledSummaries(logSpy);
      expect(summaries).toHaveLength(1);
      // Bitable 直書きの認証情報を与えていないので、Base は Webhook 経路で保存される。
      expect(summaries[0]).toMatchObject({ mode: 'full', origin: 'default', failed: [], base: 'webhook' });
    });

    it('Bitable直書きが失敗したら lark-base-direct を記録し、Webhook で救済する', async () => {
      // Webhook 経路では utm・広告ID などが失われる。保存できても「劣化した」ことは足跡に残す。
      vi.stubEnv('APP_ID_RIDEJOB', 'cli_test');
      vi.stubEnv('APP_SECRET_RIDEJOB', 'test-secret');
      vi.stubEnv('APP_TOKEN_RIDEJOB', 'bascnTest');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) =>
        String(input).includes('/tenant_access_token/')
          ? jsonResponse({ code: 10014, msg: 'app secret invalid' })
          : allOk(),
      );
      const { POST } = await import('./route');
      const res = await POST(makeRequest(applicantBody));

      expect(res.status).toBe(200);
      expect(printed(errorSpy).join('\n')).toContain('Lark Base 直書き失敗、Webhook にフォールバック');
      expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/anycross/trigger/'))).toBe(true);
      expect(settledSummaries(logSpy)[0]).toMatchObject({ failed: ['lark-base-direct'], base: 'webhook' });
    });

    it('Bitable直書きが通れば Webhook は叩かず、base: direct と記録する', async () => {
      vi.stubEnv('APP_ID_RIDEJOB', 'cli_test');
      vi.stubEnv('APP_SECRET_RIDEJOB', 'test-secret');
      vi.stubEnv('APP_TOKEN_RIDEJOB', 'bascnTest');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/tenant_access_token/')) {
          return jsonResponse({ code: 0, tenant_access_token: 't-test', expire: 7200 });
        }
        // 応募経由マスタ・応募職種マスタへのリンク解決（applicantBody は google/search・タクシーLP）
        if (url.includes('/fields')) {
          return jsonResponse({
            code: 0,
            data: {
              items: [
                { field_name: '応募経由(マスタ連動)', property: { table_id: 'tblSource' } },
                { field_name: 'マスタ-応募職種', property: { table_id: 'tblJob' } },
              ],
            },
          });
        }
        if (url.includes('/tables/tblSource/records')) {
          return jsonResponse({ code: 0, data: { items: [{ record_id: 'recSource', fields: { 名前: 'google(ad)' } }] } });
        }
        if (url.includes('/tables/tblJob/records')) {
          return jsonResponse({ code: 0, data: { items: [{ record_id: 'recJob', fields: { 名前: 'タクシードライバー' } }] } });
        }
        return allOk();
      });
      const { POST } = await import('./route');
      const res = await POST(makeRequest(applicantBody));

      expect(res.status).toBe(200);
      expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/anycross/trigger/'))).toBe(false);
      expect(settledSummaries(logSpy)[0]).toMatchObject({ failed: [], base: 'direct' });
    });

    it('Lark 通知・Base Webhook の fetch にはタイムアウトの signal を渡す', async () => {
      // 無いと相手が無応答のとき allSettled が張り付き、サマリ行も出ないまま実行上限で落ちる。
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const { POST } = await import('./route');
      await POST(makeRequest(applicantBody));

      const larkCalls = fetchSpy.mock.calls.filter((call) =>
        ['/bot/v2/hook/', '/anycross/trigger/'].some((path) => String(call[0]).includes(path)),
      );
      expect(larkCalls).toHaveLength(2);
      for (const call of larkCalls) {
        expect((call[1] as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it('Baseのみ経路（LARK_SEND_BASE_ONLY=true）でもサマリを1行出す', async () => {
      vi.stubEnv('LARK_SEND_BASE_ONLY', 'true');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { POST } = await import('./route');
      const res = await POST(makeRequest(applicantBody));

      expect(res.status).toBe(200);
      const summaries = settledSummaries(logSpy);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ mode: 'base-only', tasks: 1, failed: [], base: 'webhook' });
      // 通知・SMS・CAPI は送らない
      expect(fetchSpy.mock.calls.every((call) => String(call[0]).includes('/anycross/trigger/'))).toBe(true);
    });

    it('意図的なスキップ（SMS無効・Meta CAPI未設定）は失敗に数えず、メールの設定漏れは失敗に数える', async () => {
      // 未設定なら自動スキップする付加機能（src/app/api/health/route.ts）を失敗に数えると、
      // その環境では全応募が failed になり、サマリが読まれなくなる。
      vi.stubEnv('META_SMS_ENABLED', '');
      vi.stubEnv('META_CAPI_ACCESS_TOKEN', '');
      vi.stubEnv('GMAIL_SENDER_EMAIL', '');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { POST } = await import('./route');
      await POST(makeRequest(applicantBody));

      expect(settledSummaries(logSpy)[0]?.failed).toEqual(['confirmation-email']);
      const hosts = new Set(fetchSpy.mock.calls.map((call) => hostOf(call[0])));
      expect(hosts.has('leomeet.pmagent.jp')).toBe(false);
      expect(hosts.has('graph.facebook.com')).toBe(false);
    });
  });

  describe('ログに個人情報を出さない', () => {
    // V8 の JSON の SyntaxError は message 自体に入力の断片を載せる（Node v25.3.0 で実測）。
    // エラーを丸ごと（あるいは name と message だけでも）ログに出すと、そのまま漏れる。
    const brokenBody = '{"fullName":TANAKA TARO,"email":"taro@example.com"}';
    const engineEchoesJsonInput = (() => {
      try {
        JSON.parse(brokenBody);
      } catch (e) {
        return e instanceof Error && e.message.includes('TANAKA');
      }
      return false;
    })();

    // 断片を載せない処理系では、この経路の漏れ自体が起きない。空振りで通すと気づけないので skip で見せる
    // （CI は Node 20。手元で実測したのは Node 25 のみ）。
    it.skipIf(!engineEchoesJsonInput)('応募本文の JSON が壊れていても、氏名などの断片をログに出さない', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { POST } = await import('./route');
      const res = await POST(makeRawRequest(brokenBody));

      expect(res.status).toBe(500);
      const logged = printed(errorSpy).join('\n');
      expect(logged).toContain('SyntaxError');
      expect(logged).not.toContain('TANAKA');
    });

    it('通常の応募で、応募者の氏名・メール・電話をログに出さない', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { POST } = await import('./route');
      await POST(makeRequest(applicantBody));

      const lines = printed(logSpy, errorSpy, warnSpy)
        // メール送信ライブラリのドライランは宛先確認のために宛先を出す（本番では EMAIL_DRY_RUN を立てない）。
        .filter((line) => !line.startsWith('[EMAIL_DRY_RUN]'));
      for (const pii of [applicantBody.email, applicantBody.phoneNumber, applicantBody.fullName]) {
        expect(lines.filter((line) => line.includes(pii)), `ログに ${pii} が出ている`).toEqual([]);
      }
    });
  });
});
