import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://ridejob.jp/api/health', { headers });
}

const LARK_ENV = {
  LARK_WEBHOOK_URL: 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaa',
  LARK_BASE_WEBHOOK_URL: 'https://open.larksuite.com/anycross/trigger/bbbb',
  LARK_WEBHOOK_URL_COUPANG_PROD: 'https://open.larksuite.com/open-apis/bot/v2/hook/cccc',
  LARK_BASE_WEBHOOK_URL_COUPANG_PROD: 'https://open.larksuite.com/anycross/trigger/dddd',
  APP_ID_LIFTJOB: 'cli_liftjob',
  APP_SECRET_LIFTJOB: 'secret_liftjob',
  APP_TOKEN_LIFTJOB: 'app_liftjob',
  LARK_BASE_TABLE_ID_LIFTJOB: 'tbl_liftjob',
  OPENAI_ADS_PIXEL_ID: 'pixel_openai',
  OPENAI_ADS_CAPI_KEY: 'key_openai',
  OPENAI_ADS_RELAY_TOKEN: 'relay-secret',
};

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
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
      'LARK_WEBHOOK_URL_COUPANG_PROD',
      'LARK_WEBHOOK_URL_COUPANG',
      'LARK_BASE_WEBHOOK_URL_COUPANG_PROD',
      'LARK_BASE_WEBHOOK_URL_COUPANG',
      'APP_ID_LIFTJOB',
      'APP_SECRET_LIFTJOB',
      'APP_TOKEN_LIFTJOB',
      'LARK_BASE_TABLE_ID_LIFTJOB',
      'OPENAI_ADS_PIXEL_ID',
      'OPENAI_ADS_CAPI_KEY',
      'OPENAI_ADS_RELAY_URL',
      'OPENAI_ADS_RELAY_TOKEN',
    ]) {
      vi.stubEnv(k, '');
    }
    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.missing).toEqual([
      'lark_notify',
      'lark_base',
      'lark_liftjob_notify',
      'lark_liftjob_app_id',
      'lark_liftjob_app_secret',
      'lark_liftjob_app_token',
      'lark_liftjob_table',
      'openai_ads_delivery',
    ]);
  });

  it('OpenAI直接資格情報がなくてもrelay一式があればreadyにする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('OPENAI_ADS_PIXEL_ID', '');
    vi.stubEnv('OPENAI_ADS_CAPI_KEY', '');
    vi.stubEnv('OPENAI_ADS_RELAY_URL', 'https://ridejob.jp/entry/api/openai/conversions');
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'relay-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ status: 'ready' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });

  it('relay先が認証不一致または未readyならdegradedにする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('OPENAI_ADS_PIXEL_ID', '');
    vi.stubEnv('OPENAI_ADS_CAPI_KEY', '');
    vi.stubEnv('OPENAI_ADS_RELAY_URL', 'https://ridejob.jp/entry/api/openai/conversions');
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'wrong-relay-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'unauthorized' }), { status: 401 })),
    );

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'degraded',
      missing: ['openai_ads_relay_upstream'],
    });
  });

  it('LIFT JOB専用の通知Webhookが欠けたら degraded にする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG_PROD', '');
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG', '');

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', missing: ['lark_liftjob_notify'] });
  });

  it('直接Base資格情報が揃えば旧Base Webhookがなくてもreadyにする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_COUPANG_PROD', '');
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_COUPANG', '');

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });

  it('Base-onlyモードでは通知Webhookを必須扱いしない', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('LARK_SEND_BASE_ONLY', 'true');
    vi.stubEnv('LARK_WEBHOOK_URL', '');
    vi.stubEnv('LARK_WEBHOOK_URL_TEST', '');
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG_PROD', '');
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG', '');

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });
});
