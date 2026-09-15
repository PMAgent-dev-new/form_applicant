import { afterEach, describe, expect, it, vi } from 'vitest';

describe('sendOpenAiConversion relay', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('直接資格情報がない場合は個人情報を除外して内部relayへ送る', async () => {
    vi.stubEnv('OPENAI_ADS_PIXEL_ID', '');
    vi.stubEnv('OPENAI_ADS_CAPI_KEY', '');
    vi.stubEnv('OPENAI_ADS_ADVANCED_MATCHING', 'true');
    vi.stubEnv('OPENAI_ADS_RELAY_URL', 'https://ridejob.jp/entry/api/openai/conversions');
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'relay-secret');
    const fetchMock = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      void url;
      void options;
      return new Response(JSON.stringify({ ok: true, status: 200 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { sendOpenAiConversion } = await import('./capi');
    const result = await sendOpenAiConversion({
      eventId: 'submission-1',
      oppref: 'gAAAAA-relay-test',
      sourceUrl: 'https://ridejob.pmagent.jp/coupang?email=must-not-relay%40example.invalid&utm_source=openai#private',
      email: 'must-not-relay@example.invalid',
      phone: '09012345678',
      clientIpAddress: '192.0.2.1',
      clientUserAgent: 'test-agent',
      validateOnly: true,
      timestampMs: 1773892800000,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ridejob.jp/entry/api/openai/conversions');
    expect(options?.headers).toMatchObject({ 'x-openai-relay-token': 'relay-secret' });
    const payload = JSON.parse(String(options?.body));
    expect(payload).toEqual({
      eventId: 'submission-1',
      oppref: 'gAAAAA-relay-test',
      sourceUrl: 'https://ridejob.pmagent.jp/coupang',
      validateOnly: true,
      timestampMs: 1773892800000,
    });
    expect(JSON.stringify(payload)).not.toContain('must-not-relay');
    expect(JSON.stringify(payload)).not.toContain('09012345678');
    expect(JSON.stringify(payload)).not.toContain('192.0.2.1');
    expect(JSON.stringify(payload)).not.toContain('test-agent');
  });

  it('429または5xxは同じevent IDで1回だけ再試行する', async () => {
    vi.stubEnv('OPENAI_ADS_PIXEL_ID', '');
    vi.stubEnv('OPENAI_ADS_CAPI_KEY', '');
    vi.stubEnv('OPENAI_ADS_RELAY_URL', 'https://ridejob.jp/entry/api/openai/conversions');
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'relay-secret');
    const fetchMock = vi
      .fn<(url: string | URL | Request, options?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, status: 200 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { sendOpenAiConversion } = await import('./capi');
    const result = await sendOpenAiConversion({ eventId: 'retry-id', oppref: 'gAAAAA-retry' });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies.map((body) => body.eventId)).toEqual(['retry-id', 'retry-id']);
  });
});
