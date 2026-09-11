import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hangingFetch, shortenAbortSignalTimeout, stalledBodyFetch } from '../testing/fetch-timeout';
import { sendApplicationSms } from './send-application-sms';

/**
 * eeasy（/api/sms/send）が応答しないときの振る舞い。
 *
 * 応募APIは全タスクを await してからレスポンスを返すので、ここが返らないと Promise.allSettled が張り付き、
 * サマリ行も出ないまま関数が実行上限で打ち切られる。5秒で打ち切り、reason: 'error' で返すことを固定する。
 */

const SMS_INPUT = {
  channel: 'ridejob' as const,
  phone: '09012345678',
  applicantName: 'テスト 太郎',
  media: 'form',
};

describe('sendApplicationSms', () => {
  beforeEach(() => {
    vi.stubEnv('META_SMS_ENABLED', 'true');
    vi.stubEnv('EEASY_SMS_SEND_URL', 'https://leomeet.pmagent.jp/api/sms/send');
    vi.stubEnv('SMS_SEND_SECRET', 'test-secret');
    vi.stubEnv('META_SMS_DRY_RUN', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('eeasy が応答しないとき、5秒のタイムアウトで打ち切って reason: error を返す', async () => {
    const timeoutSpy = shortenAbortSignalTimeout();
    const fetchSpy = hangingFetch();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await sendApplicationSms(SMS_INPUT);

    expect(result).toEqual({ sent: false, reason: 'error', error: expect.stringContaining('TimeoutError') });
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it('本文の読み取り中にタイムアウトしても reason: error を返す（http_200 と誤記録しない）', async () => {
    shortenAbortSignalTimeout();
    vi.stubGlobal('fetch', stalledBodyFetch(200));

    const result = await sendApplicationSms(SMS_INPUT);

    expect(result).toEqual({ sent: false, reason: 'error', error: expect.stringContaining('TimeoutError') });
  });

  it('2xx 以外の応答の本文でタイムアウトしたら、ステータスを残して http_<status> を返す', async () => {
    shortenAbortSignalTimeout();
    vi.stubGlobal('fetch', stalledBodyFetch(503));

    await expect(sendApplicationSms(SMS_INPUT)).resolves.toEqual({ sent: false, reason: 'http_503' });
  });

  it('タイムアウト以外で本文が読めないときは、従来どおり http_<status> を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));

    await expect(sendApplicationSms(SMS_INPUT)).resolves.toEqual({ sent: false, reason: 'http_502' });
  });

  it('応答が返れば、従来どおり送信結果を返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, deliveryOrderId: 42, ref: 'r-1' })));

    await expect(sendApplicationSms(SMS_INPUT)).resolves.toEqual({ sent: true, deliveryOrderId: 42, ref: 'r-1' });
  });
});
