import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hangingFetch, shortenAbortSignalTimeout, stalledBodyFetch } from '../testing/fetch-timeout';

/**
 * 応募受付メール（Gmail API）が応答しないときの振る舞い。
 *
 * 応募APIは全タスクを await してからレスポンスを返すので、ここが返らないと Promise.allSettled が張り付き、
 * サマリ行も出ないまま関数が実行上限で打ち切られる。トークン取得・送信のどちらで止まっても
 * reason: 'error' で返ることを、呼び出し口の sendApplicationConfirmationEmail で固定する。
 *
 * google-auth-library は差し替える。トークン取得は内部の gaxios が node-fetch で行い、global.fetch を通らない。
 * gaxios の timeout の効き方（無応答は1回で打ち切り、再試行しない）は 2026-09-10 に手元で実測した。
 * ここでは、その timeout を渡していることと、失敗したときの返り値を確かめる。
 */

const jwt = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  getAccessToken: vi.fn<() => Promise<{ token?: string | null }>>(),
}));

vi.mock('google-auth-library', () => ({
  JWT: class {
    constructor(options: Record<string, unknown>) {
      jwt.options.push(options);
    }
    getAccessToken() {
      return jwt.getAccessToken();
    }
  },
}));

const INPUT = {
  to: 'applicant@example.com',
  applicantName: 'テスト 太郎',
  email: 'applicant@example.com',
  formOrigin: 'default',
} as const;

/** gmail-client は鍵と JWT クライアントをモジュール内にキャッシュするので、毎回読み込み直す。 */
async function loadEmail() {
  vi.resetModules();
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY_BASE64', '');
  vi.stubEnv(
    'GOOGLE_SERVICE_ACCOUNT_KEY',
    JSON.stringify({ client_email: 'sender@example.iam.gserviceaccount.com', private_key: 'test-key' }),
  );
  vi.stubEnv('GMAIL_SENDER_EMAIL', 'support_team@example.com');
  vi.stubEnv('ENABLE_EMAIL_NOTIFICATION', '');
  vi.stubEnv('EMAIL_DRY_RUN', '');
  vi.stubEnv('GMAIL_CC', '');
  vi.stubEnv('GMAIL_BCC', '');
  return await import('./send-application-confirmation');
}

describe('応募受付メール（Gmail API）のタイムアウト', () => {
  beforeEach(() => {
    jwt.options.length = 0;
    jwt.getAccessToken.mockReset();
    jwt.getAccessToken.mockResolvedValue({ token: 'test-access-token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Gmail API が応答しないとき、5秒のタイムアウトで打ち切って reason: error を返す', async () => {
    const timeoutSpy = shortenAbortSignalTimeout();
    const fetchSpy = hangingFetch();
    vi.stubGlobal('fetch', fetchSpy);
    const { sendApplicationConfirmationEmail } = await loadEmail();

    const result = await sendApplicationConfirmationEmail(INPUT);

    expect(result).toEqual({ sent: false, reason: 'error', error: expect.stringContaining('TimeoutError') });
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it('トークン取得（google-auth-library）にも5秒のタイムアウトを渡す（ライブラリの既定はタイムアウト無し）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'msg-1' })));
    const { sendApplicationConfirmationEmail } = await loadEmail();

    await expect(sendApplicationConfirmationEmail(INPUT)).resolves.toEqual({ sent: true, messageId: 'msg-1' });
    expect(jwt.options).toHaveLength(1);
    expect(jwt.options[0]).toMatchObject({ transporterOptions: { timeout: 5000 } });
  });

  it('トークン取得が打ち切られたら送信せずに reason: error を返し、トークン取得の失敗だと分かる', async () => {
    // gaxios は無応答を timeout で打ち切ると、この文言のエラーで reject する（実測）
    jwt.getAccessToken.mockRejectedValue(new Error('The operation was aborted.'));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { sendApplicationConfirmationEmail } = await loadEmail();

    const result = await sendApplicationConfirmationEmail(INPUT);

    expect(result).toEqual({ sent: false, reason: 'error', error: expect.stringContaining('access token') });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('送信が 2xx なら、messageId の読み取り中にタイムアウトしても送信済みとして返す', async () => {
    shortenAbortSignalTimeout();
    vi.stubGlobal('fetch', stalledBodyFetch(200));
    const { sendApplicationConfirmationEmail } = await loadEmail();

    await expect(sendApplicationConfirmationEmail(INPUT)).resolves.toEqual({ sent: true, messageId: undefined });
  });

  it('エラー応答の本文の読み取り中にタイムアウトしても、HTTP ステータスを残して reason: error を返す', async () => {
    shortenAbortSignalTimeout();
    vi.stubGlobal('fetch', stalledBodyFetch(503));
    const { sendApplicationConfirmationEmail } = await loadEmail();

    const result = await sendApplicationConfirmationEmail(INPUT);

    expect(result).toEqual({ sent: false, reason: 'error', error: expect.stringContaining('(503)') });
  });
});
