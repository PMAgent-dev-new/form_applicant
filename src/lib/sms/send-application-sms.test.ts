import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hangingFetch, shortenAbortSignalTimeout, stalledBodyFetch } from '../testing/fetch-timeout';
import { sendApplicationSms, udManufacturingSmsIsReady } from './send-application-sms';

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

  it('UDは専用URLと同じ応募の安定したrefを使い、旧URLへフォールバックしない', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ error: 'NOT_FOUND' }, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const input = { ...SMS_INPUT, channel: 'mechanic' as const, jobKind: 'ud-manufacturing' as const, submissionId: 'ud-application-1', appliedJobId: 'ud-job-test' };
    await expect(sendApplicationSms(input)).resolves.toMatchObject({ sent: false });
    await sendApplicationSms(input);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual(Array(2).fill('https://leomeet.pmagent.jp/api/sms/send/ud-manufacturing'));
    const bodies = fetch.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies[0].ref).toMatch(/^ud-[a-f0-9]{32}$/);
    expect(bodies[0].ref).toBe(bodies[1].ref);
    expect(bodies[0].channel).toBe('mechanic');
  });

  it('UDの求人区分・応募IDが不正なら外部送信しない', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(sendApplicationSms({ ...SMS_INPUT, jobKind: 'ud-manufacturing', submissionId: 'x' })).resolves.toMatchObject({ sent: false });
    await expect(sendApplicationSms({ ...SMS_INPUT, channel: 'mechanic', jobKind: 'ud-manufacturing' })).resolves.toMatchObject({ sent: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('UDの死活確認は認証付きGETのみで、専用版の一致を必須とする', async () => {
    vi.stubEnv('UD_MANUFACTURING_JOB_ID', 'ud-job-test');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ status: 'ready', template: 'ud-manufacturing-v1', jobId: 'ud-job-test' }));
    vi.stubGlobal('fetch', fetch);
    expect(await udManufacturingSmsIsReady()).toBe(true);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer test-secret' } });
    fetch.mockImplementation(async () => Response.json({ status: 'ready' }));
    expect(await udManufacturingSmsIsReady()).toBe(false);
  });
});
