import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('UD受付ゲートは保存・通知・計測より先に閉じる', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('UDのorigin欠落・別origin指定で任意同意ゲートを迂回できない', async () => {
    vi.stubEnv('UD_MANUFACTURING_JOB_ID', 'ud-job-test');
    const fetch = vi.fn(() => { throw new Error('unexpected external request'); });
    vi.stubGlobal('fetch', fetch);
    for (const entry of [
      { body: { appliedJobId: 'ud-job-test' }, referer: 'https://ridejob.jp/' },
      { body: { formOrigin: 'mechanic' }, referer: 'https://ridejob.jp/entry/ud-manufacturing' },
      { body: { formOrigin: 'default', udAdConsent: { accepted: false } }, referer: 'https://ridejob.jp/' },
    ]) {
      const response = await POST(new NextRequest('https://example.invalid/api/applicants', { method: 'POST', headers: { referer: entry.referer }, body: JSON.stringify(entry.body) }));
      expect(response.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('未公開状態では一切外部通信しない', async () => {
    vi.stubEnv('UD_MANUFACTURING_ENABLED', 'false');
    const fetch = vi.fn(() => { throw new Error('unexpected external request'); });
    vi.stubGlobal('fetch', fetch);
    const response = await POST(new NextRequest('https://example.invalid/api/applicants', {
      method: 'POST', body: JSON.stringify({ formOrigin: 'ud_manufacturing', submissionId: 'ud-test' }),
    }));
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('対象求人の変更や不正入力を副作用前に拒否する', async () => {
    for (const [key, value] of Object.entries({ UD_MANUFACTURING_ENABLED: 'true', UD_MANUFACTURING_CONTACT_READY: 'true', UD_MANUFACTURING_JOB_ID: 'ud-job-test', UD_MANUFACTURING_SMS_MODE: 'verified-manufacturing', META_SMS_ENABLED: 'true', EEASY_SMS_SEND_URL: 'https://sms.example.invalid/api/sms/send', SMS_SEND_SECRET: 'test-secret', APP_ID_MECHANIC: 'test', APP_SECRET_MECHANIC: 'test', APP_TOKEN_MECHANIC: 'test' })) vi.stubEnv(key, value);
    const fetch = vi.fn(() => { throw new Error('unexpected external request'); });
    vi.stubGlobal('fetch', fetch);
    for (const appliedJobId of ['other-job', 'ud-job-test']) {
      const response = await POST(new NextRequest('https://example.invalid/api/applicants', {
        method: 'POST', body: JSON.stringify({ formOrigin: 'ud_manufacturing', submissionId: 'ud-test', appliedJobId }),
      }));
      expect(response.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
