import { format } from 'node:util';
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
 * - Gmail 送信は EMAIL_DRY_RUN=true で送信手前で止めている。**global fetch は通る**
 *   （gmail-client.ts が gmail.googleapis.com を fetch する。google-auth-library 経由なのは
 *   トークン取得のみ）。将来 dry-run を外すなら googleapis.com を許可リストに足すこと。
 * - ランタイムテストなので、与えた入力で実行される経路しかカバーしない。
 */

const ALLOWED_HOSTS = new Set([
  'open.larksuite.com', // Lark 通知 webhook / Base webhook
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
  LARK_BASE_WEBHOOK_URL_COUPANG_PROD: 'https://open.larksuite.com/anycross/trigger/bbbbbbbb',
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

/** 本文を文字列のまま渡す（壊れた JSON を送るため）。 */
function makeRawRequest(rawBody: string) {
  // ハンドラが request.cookies を読むため、素の Request では落ちる。
  return new NextRequest('https://ridejob.jp/entry/api/coupang/applicants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://ridejob.jp/entry/coupang',
      'user-agent': 'vitest',
    },
    body: rawBody,
  });
}

function makeRequest(body: unknown) {
  return makeRawRequest(JSON.stringify(body));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type ConsoleSpy = { mock: { calls: unknown[][] } };

const SUMMARY_PREFIX = '[coupang] submission settled:';

/** 応募1件ごとに出るサマリ行（`[coupang] submission settled:` ＋ 1行の JSON）の中身。 */
function settledSummaries(logSpy: ConsoleSpy) {
  return logSpy.mock.calls
    .filter((call) => call[0] === SUMMARY_PREFIX)
    .map((call) => JSON.parse(String(call[1])) as Record<string, unknown>);
}

/** console に実際に出る文字列（Error はスタック込み、オブジェクトは inspect 済み）に直す。 */
function printed(...spies: ConsoleSpy[]) {
  return spies.flatMap((spy) => spy.mock.calls.map((call) => format(call[0], ...call.slice(1))));
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
    vi.restoreAllMocks();
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
      String(call[0]).includes('/anycross/trigger/'),
    );
    expect(baseCall, 'Base webhook が呼ばれていない').toBeTruthy();
    const payload = JSON.parse((baseCall![1] as RequestInit).body as string);
    expect(payload.desired_location).toBe('東京');
    expect(payload.job_position).toBe('アカウントマネージャー');
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

  /**
   * 副作用の失敗をサマリの failed に載せる。throw だけでなく HTTP エラーも数えないと、
   * サマリ行が「失敗0件」と嘘をつく。共通ルート（`/api/applicants`）の同種のテストと同じ狙い。
   */
  describe('副作用の失敗を集計する', () => {
    const allOk = () => jsonResponse({ ok: true, code: 0, StatusCode: 0 });

    it('Meta CAPI が HTTP エラーなら meta-capi を失敗として集計する', async () => {
      // sendMetaCapiLead は HTTP エラーでも throw せず ok:false を返す。戻り値を見ないと数えられない。
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) =>
        hostOf(input) === 'graph.facebook.com'
          ? jsonResponse({ error: { message: 'Invalid parameter' } }, 400)
          : allOk(),
      );
      const { POST } = await import('./route');
      const res = await POST(makeRequest(coupangBody));

      expect(res.status).toBe(200);
      expect(settledSummaries(logSpy)[0]?.failed).toEqual(['meta-capi']);
    });

    it('Meta CAPI が未設定ならスキップ扱いで、失敗に数えない', async () => {
      // 未設定なら自動スキップする付加機能（src/app/api/health/route.ts）。数えると、
      // 未設定の環境（プレビュー等）では全応募が failed になり、サマリが読まれなくなる。
      vi.stubEnv('META_CAPI_ACCESS_TOKEN', '');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { POST } = await import('./route');
      await POST(makeRequest(coupangBody));

      expect(settledSummaries(logSpy)[0]?.failed).toEqual([]);
      expect(fetchSpy.mock.calls.some((call) => hostOf(call[0]) === 'graph.facebook.com')).toBe(false);
    });

    it('Base Webhook が HTTP エラーなら lark-base-webhook を失敗として集計し、応答本文はログに出さない', async () => {
      // 相手が送った応募データを引用して返す場合に備え、応答は code と msg だけを出す。
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) =>
        String(input).includes('/anycross/trigger/')
          ? jsonResponse({ code: 1254302, msg: 'permission denied', data: { full_name: coupangBody.fullName } }, 403)
          : allOk(),
      );
      const { POST } = await import('./route');
      const res = await POST(makeRequest(coupangBody));

      expect(res.status).toBe(200);
      const logged = printed(errorSpy).join('\n');
      expect(logged).toContain('Failed to send to Lark Base Webhook (http=403 code=1254302');
      expect(logged).not.toContain(coupangBody.fullName);
      expect(settledSummaries(logSpy)[0]?.failed).toEqual(['lark-base-webhook']);
    });

    it('Base Webhook が HTTP200 で code≠0 を返しても失敗には数えず、警告だけ残す', async () => {
      // Base 自動化 Webhook（anycross）が成功時に何を返すかは一次情報が無い。決めつけると誤警報になりうるので、
      // HTTP ステータスで判定し（PR #79・#80 と同じ）、code は警告として見えるようにする。
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) =>
        String(input).includes('/anycross/trigger/')
          ? jsonResponse({ code: 1254302, msg: 'permission denied' })
          : allOk(),
      );
      const { POST } = await import('./route');
      await POST(makeRequest(coupangBody));

      expect(printed(warnSpy).join('\n')).toContain('code=1254302');
      expect(settledSummaries(logSpy)[0]?.failed).toEqual([]);
    });

    it('Lark 通知の本文を読んでいる途中でタイムアウトしたら、成功扱いにせず失敗として集計する', async () => {
      // ヘッダだけ返して本文が止まる相手。本文の読み取り失敗を握りつぶすと、code を確かめないまま
      // HTTP 200 だけで「sent successfully」と記録される。
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) => {
        if (!String(input).includes('/bot/v2/hook/')) return allOk();
        const stalled = new ReadableStream({
          start(controller) {
            controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
          },
        });
        return new Response(stalled, { status: 200, headers: { 'content-type': 'application/json' } });
      });
      const { POST } = await import('./route');
      const res = await POST(makeRequest(coupangBody));

      expect(res.status).toBe(200);
      expect(printed(errorSpy).join('\n')).toContain('lark-notification threw and was swallowed: TimeoutError');
      expect(printed(logSpy).join('\n')).not.toContain('Lark notification sent successfully');
      expect(settledSummaries(logSpy)[0]?.failed).toEqual(['lark-notification']);
    });
  });

  describe('サマリ行', () => {
    it('応募1件につき1行（JSON）で出す（全経路が成功なら failed は空）', async () => {
      // オブジェクトのまま渡すと util.inspect が複数行に折り返し、行単位の grep で failed が見えなくなる。
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { POST } = await import('./route');
      await POST(makeRequest(coupangBody));

      const lines = printed(logSpy).filter((line) => line.startsWith(SUMMARY_PREFIX));
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain('\n');
      expect(settledSummaries(logSpy)[0]).toMatchObject({ mode: 'full', failed: [] });
    });

    it('Baseのみ経路（LARK_SEND_BASE_ONLY=true）でも1行出し、Base の失敗も載せる', async () => {
      vi.stubEnv('LARK_SEND_BASE_ONLY', 'true');
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async () => jsonResponse({ code: 1254302, msg: 'permission denied' }, 403));
      const { POST } = await import('./route');
      const res = await POST(makeRequest(coupangBody));

      expect(res.status).toBe(200);
      const lines = printed(logSpy).filter((line) => line.startsWith(SUMMARY_PREFIX));
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain('\n');
      expect(settledSummaries(logSpy)[0]).toMatchObject({
        mode: 'base-only',
        tasks: 1,
        failed: ['lark-base-webhook'],
      });
      // 通知・メール・SMS・CAPI は送らない
      expect(fetchSpy.mock.calls.every((call) => String(call[0]).includes('/anycross/trigger/'))).toBe(true);
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
    // （CI は Node 20）。処理系の文言に依存しない確認は、下の「副作用が SyntaxError を投げても」で行う。
    it.skipIf(!engineEchoesJsonInput)('応募本文の JSON が壊れていても、氏名などの断片をログに出さない', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { POST } = await import('./route');
      const res = await POST(makeRawRequest(brokenBody));

      expect(res.status).toBe(500);
      const logged = printed(errorSpy).join('\n');
      expect(logged).toContain('SyntaxError');
      expect(logged).not.toContain('TANAKA');
    });

    it('副作用が SyntaxError を投げても、message（入力の断片を含みうる）をログに出さない', async () => {
      // name と message に絞っても、断片は message 側に残る。処理系の文言に依存しないよう、
      // 断片入りの SyntaxError をこちらで作って投げる。
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      fetchSpy.mockImplementation(async (input: unknown) => {
        if (String(input).includes('/bot/v2/hook/')) {
          throw new SyntaxError(
            `Unexpected token, "${coupangBody.fullName} ${coupangBody.phoneNumber}"... is not valid JSON`,
          );
        }
        return jsonResponse({ ok: true, code: 0, StatusCode: 0 });
      });
      const { POST } = await import('./route');
      const res = await POST(makeRequest(coupangBody));

      expect(res.status).toBe(200);
      const logged = printed(errorSpy).join('\n');
      expect(logged).toContain('lark-notification threw and was swallowed: SyntaxError');
      expect(logged).not.toContain(coupangBody.fullName);
      expect(logged).not.toContain(coupangBody.phoneNumber);
      expect(settledSummaries(logSpy)[0]?.failed).toEqual(['lark-notification']);
    });

    it('通常の応募で、応募者の氏名・メール・電話をログに出さない', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { POST } = await import('./route');
      await POST(makeRequest(coupangBody));

      const lines = printed(logSpy, errorSpy, warnSpy)
        // メール送信ライブラリのドライランは宛先確認のために宛先を出す（本番では EMAIL_DRY_RUN を立てない）。
        .filter((line) => !line.startsWith('[EMAIL_DRY_RUN]'));
      // 空振り防止: サマリ行まで到達している
      expect(lines.some((line) => line.startsWith(SUMMARY_PREFIX))).toBe(true);
      for (const pii of [coupangBody.email, coupangBody.phoneNumber, coupangBody.fullName]) {
        expect(lines.filter((line) => line.includes(pii)), `ログに ${pii} が出ている`).toEqual([]);
      }
    });
  });
});
