import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://ridejob.jp/api/health', { headers });
}

const LARK_ENV = {
  LARK_WEBHOOK_URL: 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaa',
  LARK_BASE_WEBHOOK_URL: 'https://open.larksuite.com/anycross/trigger/bbbb',
};

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns liveness (200 ok) with no token configured, leaking nothing', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', '');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns only liveness when the token is wrong (no config detail)', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    // even if env is broken, an unauthorized caller must not learn that
    const res = await GET(makeRequest({ 'x-health-token': 'wrong' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('reports ready (200) with a valid token when required env is present', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });

  it('reports degraded (503) with a valid token when the Base webhook is missing', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    vi.stubEnv('LARK_WEBHOOK_URL', LARK_ENV.LARK_WEBHOOK_URL);
    vi.stubEnv('LARK_BASE_WEBHOOK_URL', '');
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_PROD', '');
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_TEST', '');
    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', missing: ['lark_base'] });
  });

  it('reports both groups missing when no Lark env is set', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const k of [
      'LARK_WEBHOOK_URL',
      'LARK_WEBHOOK_URL_TEST',
      'LARK_BASE_WEBHOOK_URL',
      'LARK_BASE_WEBHOOK_URL_PROD',
      'LARK_BASE_WEBHOOK_URL_TEST',
    ]) {
      vi.stubEnv(k, '');
    }
    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.missing).toEqual(['lark_notify', 'lark_base']);
  });
});
