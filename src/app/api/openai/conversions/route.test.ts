import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { sendDirect } = vi.hoisted(() => ({ sendDirect: vi.fn() }));

vi.mock('@/lib/openai/capi', () => ({
  sendOpenAiConversionDirect: sendDirect,
}));

import { GET, POST } from './route';

function makeRequest(token: string, body: Record<string, unknown>) {
  return new NextRequest('https://ridejob.jp/entry/api/openai/conversions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-openai-relay-token': token,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/openai/conversions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    sendDirect.mockReset();
  });

  it('relay token不一致を401で拒否する', async () => {
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'expected-token');
    const res = await POST(makeRequest('wrong-token', { eventId: 'id', oppref: 'oppref' }));
    expect(res.status).toBe(401);
    expect(sendDirect).not.toHaveBeenCalled();
  });

  it('GETはtokenと直接資格情報の両方が揃った場合だけreadyを返す', async () => {
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'expected-token');
    vi.stubEnv('OPENAI_ADS_PIXEL_ID', 'pixel');
    vi.stubEnv('OPENAI_ADS_CAPI_KEY', 'key');
    const ready = await GET(makeRequest('expected-token', {}));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ready' });

    vi.stubEnv('OPENAI_ADS_CAPI_KEY', '');
    const degraded = await GET(makeRequest('expected-token', {}));
    expect(degraded.status).toBe(503);
    expect(await degraded.json()).toEqual({ status: 'degraded' });
  });

  it('認証済みの最小payloadだけを直接送信へ渡す', async () => {
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'expected-token');
    sendDirect.mockResolvedValue({ ok: true, status: 200 });
    const res = await POST(
      makeRequest('expected-token', {
        eventId: 'submission-1',
        oppref: 'gAAAAA-test',
        sourceUrl: 'https://ridejob.pmagent.jp/coupang',
        validateOnly: true,
        timestampMs: 1773892800000,
        email: 'ignored@example.invalid',
      }),
    );

    expect(res.status).toBe(200);
    expect(sendDirect).toHaveBeenCalledWith({
      eventId: 'submission-1',
      oppref: 'gAAAAA-test',
      sourceUrl: 'https://ridejob.pmagent.jp/coupang',
      validateOnly: true,
      timestampMs: 1773892800000,
    });
  });
});
