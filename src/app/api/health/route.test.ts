import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEEP_CHECK_PROFILES, GET, findMissingEnvGroups, resolveExpectedColumnsGroups } from './route';

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://ridejob.jp/api/health', { headers });
}

const LARK_ENV = {
  LARK_WEBHOOK_URL: 'https://open.larksuite.com/open-apis/bot/v2/hook/aaaa',
  LARK_SUBMIT_CHAT_ID_RIDEJOB: 'oc_ridejob',
  LARK_SUBMIT_CHAT_ID_MECHANIC: 'oc_mechanic',
  LARK_BASE_WEBHOOK_URL: 'https://open.larksuite.com/anycross/trigger/bbbb',
  APP_ID_RIDEJOB: 'cli_ridejob',
  APP_SECRET_RIDEJOB: 'secret_ridejob',
  APP_TOKEN_RIDEJOB: 'app_ridejob',
  APP_ID_MECHANIC: 'cli_mechanic',
  APP_SECRET_MECHANIC: 'secret_mechanic',
  APP_TOKEN_MECHANIC: 'app_mechanic',
  SUBMISSION_VAULT_URL: 'https://tdlnowmdanapxmgebaqu.supabase.co',
  SUBMISSION_VAULT_SERVICE_KEY: 'test-vault-key',
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

/**
 * URL で振り分ける fetch スタブ。
 * deep チェック（tenant_access_token）と relay チェックが同じ fetch を通るので、
 * どちらか一方だけをスタブすると、もう一方が実ネットワークへ出てしまう。
 */
type LarkAuthMode = 'ok' | 'bad_credentials' | 'http_500' | 'no_token' | 'timeout';

function stubFetch({
  larkAuth = 'ok',
  relay,
  missingColumns,
  fieldsError,
}: {
  /** 一様に指定するか、プロファイル別に指定する（一部だけ壊れた状態を作れる） */
  larkAuth?: LarkAuthMode | Partial<Record<'ridejob' | 'mechanic' | 'liftjob', LarkAuthMode>>;
  relay?: { status: number; body: unknown };
  /** プロファイル別に「無いことにする」列名。省略時は期待列がすべて揃った応答を返す。 */
  missingColumns?: Partial<Record<'ridejob' | 'mechanic' | 'liftjob', string[]>>;
  /** プロファイル別に、列一覧の読み取りそのものを失敗させる応答。 */
  fieldsError?: Partial<Record<'ridejob' | 'mechanic' | 'liftjob', { status: number; body: unknown }>>;
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('tenant_access_token')) {
        // どのプロファイルの呼び出しかは app_id で分かる（LARK_ENV は cli_<profile>）。
        let appId = '';
        try {
          appId = String(JSON.parse(String(init?.body ?? '{}')).app_id ?? '');
        } catch {
          /* 解析できなければ既定の ok で扱う */
        }
        const profile = appId.replace(/^cli_/, '');
        const mode: LarkAuthMode =
          typeof larkAuth === 'string'
            ? larkAuth
            : ((larkAuth as Record<string, LarkAuthMode>)[profile] ?? 'ok');
        if (mode === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        if (mode === 'http_500') return new Response('{}', { status: 500 });
        if (mode === 'no_token') {
          // code:0 なのに token が無い。中継や仕様変更で起こり得る。
          return new Response(JSON.stringify({ code: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (mode === 'bad_credentials') {
          // Lark は HTTP 200 で code!=0 を返す。これが 2026-09 の障害で起きたこと。
          return new Response(JSON.stringify({ code: 10003, msg: 'invalid app_id or app_secret' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 't-xxx', expire: 7200 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/fields')) {
        // どのプロファイル向けの呼び出しかは tableId で分かる。
        const group = resolveExpectedColumnsGroups().find((g) => url.includes(`/tables/${g.tableId}/fields`));
        const failure = group ? fieldsError?.[group.profile] : undefined;
        if (failure) {
          return new Response(JSON.stringify(failure.body), {
            status: failure.status,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const drop = new Set(group ? missingColumns?.[group.profile] ?? [] : []);
        const items = (group?.expected ?? [])
          .filter((name) => !drop.has(name))
          .map((name) => ({ field_name: name }));
        return new Response(JSON.stringify({ code: 0, data: { items, has_more: false } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const r = relay ?? { status: 200, body: { status: 'ready' } };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

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
    stubFetch();
    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', deep: true });
  });

  it('reports degraded (503) with a valid token when the Base webhook is missing', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch();
    vi.stubEnv('LARK_BASE_WEBHOOK_URL', '');
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_PROD', '');
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_TEST', '');
    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', deep: true, missing: ['lark_base'] });
  });

  it('RIDE JOBの直接Base資格情報が欠けたら求人帰属を守るためdegradedにする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch();
    vi.stubEnv('APP_SECRET_RIDEJOB', '');
    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    // APP_* の欠落は missing で名指し済み。unreachable（資格情報が通らない）には載せない。
    // 載せると監視側で 🔴（毎回）に倒れ、既知の設定漏れで鳴りっぱなしになる。
    expect(await res.json()).toEqual({
      status: 'degraded',
      deep: true,
      missing: ['lark_ridejob_app_secret'],
    });
  });

  it('reports both groups missing when no Lark env is set', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const k of [
      'LARK_WEBHOOK_URL',
      'LARK_WEBHOOK_URL_TEST',
      'LARK_SUBMIT_CHAT_ID_RIDEJOB',
      'LARK_SUBMIT_CHAT_ID_MECHANIC',
      'SUBMISSION_VAULT_URL',
      'SUBMISSION_VAULT_SERVICE_KEY',
      'LARK_BASE_WEBHOOK_URL',
      'LARK_BASE_WEBHOOK_URL_PROD',
      'LARK_BASE_WEBHOOK_URL_TEST',
      'APP_ID_RIDEJOB',
      'APP_SECRET_RIDEJOB',
      'APP_TOKEN_RIDEJOB',
      'APP_ID_MECHANIC',
      'APP_SECRET_MECHANIC',
      'APP_TOKEN_MECHANIC',
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
      'lark_ridejob_chat',
      'lark_mechanic_chat',
      'submission_vault_url',
      'submission_vault_key',
      'lark_base',
      'lark_ridejob_app_id',
      'lark_ridejob_app_secret',
      'lark_ridejob_app_token',
      'lark_mechanic_app_id',
      'lark_mechanic_app_secret',
      'lark_mechanic_app_token',
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
    stubFetch();

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', deep: true });
  });

  it('relay先が認証不一致または未readyならdegradedにする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('OPENAI_ADS_PIXEL_ID', '');
    vi.stubEnv('OPENAI_ADS_CAPI_KEY', '');
    vi.stubEnv('OPENAI_ADS_RELAY_URL', 'https://ridejob.jp/entry/api/openai/conversions');
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'wrong-relay-secret');
    stubFetch({ relay: { status: 401, body: { status: 'unauthorized' } } });

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'degraded',
      deep: true,
      missing: ['openai_ads_relay_upstream'],
    });
  });

  it('LIFT JOB専用の通知Webhookが欠けたら degraded にする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch();
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG_PROD', '');
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG', '');

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', deep: true, missing: ['lark_liftjob_notify'] });
  });

  it('直接Base資格情報が揃えば旧Base Webhookがなくてもreadyにする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch();
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_COUPANG_PROD', '');
    vi.stubEnv('LARK_BASE_WEBHOOK_URL_COUPANG', '');

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', deep: true });
  });

  it('Base-onlyモードでは通知Webhookを必須扱いしない', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch();
    vi.stubEnv('LARK_SEND_BASE_ONLY', 'true');
    vi.stubEnv('LARK_WEBHOOK_URL', '');
    vi.stubEnv('LARK_WEBHOOK_URL_TEST', '');
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG_PROD', '');
    vi.stubEnv('LARK_WEBHOOK_URL_COUPANG', '');

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', deep: true });
  });

  // ここから: env が「在る」ことと「効く」ことは別（2026-09-17〜24 の障害）
  it('envが全部揃っていても資格情報が失効していればdegradedにする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch({ larkAuth: 'bad_credentials' });

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; unreachable: string[] };
    expect(body.status).toBe('degraded');
    // 3プロファイルすべてが落ちる
    expect(body.unreachable).toEqual([
      'lark_auth_ridejob:lark_code_10003',
      'lark_auth_mechanic:lark_code_10003',
      'lark_auth_liftjob:lark_code_10003',
    ]);
  });

  it('Larkへ到達できない（タイムアウト）ときもdegradedにする', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch({ larkAuth: 'timeout' });

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { unreachable: string[] };
    expect(body.unreachable.every((u) => u.endsWith(':timeout'))).toBe(true);
  });

  it('応答に秘密情報を一切含めない', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    // 失敗の形ごとに別の経路を通るので、全部の経路で確かめる。
    // とくに例外経路は fetch の例外メッセージに URL が入ることがある。
    for (const mode of ['bad_credentials', 'http_500', 'no_token', 'timeout'] as const) {
      stubFetch({ larkAuth: mode });
      const r = await GET(makeRequest({ 'x-health-token': 'secret' }));
      const t = JSON.stringify(await r.json());
      for (const secret of [
        'secret_ridejob', 'secret_mechanic', 'secret_liftjob',
        'cli_ridejob', 'cli_mechanic', 'cli_liftjob',
        'app_ridejob', 'test-vault-key', 'relay-secret', 'open.larksuite.com',
      ]) {
        expect(t, `mode=${mode}`).not.toContain(secret);
      }
    }
    stubFetch({ larkAuth: 'bad_credentials' });

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    const text = JSON.stringify(await res.json());
    for (const secret of [
      'secret_ridejob', 'secret_mechanic', 'secret_liftjob',
      'cli_ridejob', 'cli_mechanic', 'cli_liftjob',
      'app_ridejob', 'test-vault-key', 'relay-secret', 'open.larksuite.com',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('deep=0 なら実接続チェックを省き、省いたことが応答で分かる', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    // 資格情報が壊れていても deep=0 なら ready（省略したことは deep:false で分かる）
    stubFetch({ larkAuth: 'bad_credentials' });

    const req = new NextRequest('https://ridejob.jp/api/health?deep=0', {
      headers: { 'x-health-token': 'secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready', deep: false });
  });

  it('無認証の呼び出しでは実接続チェックを走らせない（外部から叩かせない）', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const res = await GET(makeRequest({ 'x-health-token': 'wrong' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('壊れたプロファイルだけが unreachable に並ぶ', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch({ larkAuth: { mechanic: 'bad_credentials' } });

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'degraded',
      deep: true,
      unreachable: ['lark_auth_mechanic:lark_code_10003'],
    });
  });

  it.each([
    ['http_500' as const, 'lark_auth_ridejob:http_500'],
    ['no_token' as const, 'lark_auth_ridejob:no_token'],
    ['timeout' as const, 'lark_auth_ridejob:timeout'],
  ])('%s を理由として名指しする', async (mode, expected) => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    stubFetch({ larkAuth: { ridejob: mode } });

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect((await res.json()).unreachable).toEqual([expected]);
  });

  it('スキームの無い LARK_DOMAIN_* は bad_domain（unreachable に潰さない）', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    // 2026-09-17〜24 の障害で実際に起きた形。fetch はネットワークに出る前に TypeError を投げ、
    // 素朴に catch すると「Lark が落ちている」と区別がつかなくなる。
    vi.stubEnv('LARK_DOMAIN_RIDEJOB', 'open.larksuite.com');
    stubFetch();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'degraded',
      deep: true,
      unreachable: ['lark_auth_ridejob:bad_domain'],
    });
    // ridejob は fetch にすら行かない（mechanic と liftjob の 2 回だけ）
    const larkCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('tenant_access_token'));
    expect(larkCalls).toHaveLength(2);
  });

  it('プロファイルごとに LARK_DOMAIN_<PROFILE> を使う', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('LARK_DOMAIN_MECHANIC', 'https://open.feishu.cn');
    stubFetch();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(200);
    const urls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('tenant_access_token'));
    expect(urls.filter((u) => u.startsWith('https://open.feishu.cn/'))).toHaveLength(1);
    expect(urls.filter((u) => u.startsWith('https://open.larksuite.com/'))).toHaveLength(2);
  });

  it('relay が落ちていても deep は走り、両方を返す', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('OPENAI_ADS_PIXEL_ID', '');
    vi.stubEnv('OPENAI_ADS_CAPI_KEY', '');
    vi.stubEnv('OPENAI_ADS_RELAY_URL', 'https://ridejob.jp/entry/api/openai/conversions');
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'relay-secret');
    // Lark も壊れているが、relay で止まるのでそこまで進まない
    stubFetch({ relay: { status: 500, body: {} }, larkAuth: 'bad_credentials' });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      status: 'degraded',
      deep: true,
      missing: ['openai_ads_relay_upstream'],
      unreachable: [
        'lark_auth_ridejob:lark_code_10003',
        'lark_auth_mechanic:lark_code_10003',
        'lark_auth_liftjob:lark_code_10003',
      ],
    });
    const larkCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('tenant_access_token'));
    expect(larkCalls).toHaveLength(3);
  });

  it('env が足りなくても、資格情報の破損は隠れない（2026-09-24 の本番の状態）', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    // 本番は SUBMISSION_VAULT_* が未設定。旧実装はここで missing を返して終わり、
    // 資格情報が壊れていても unreachable が付かなかった＝死活監視が盲目だった。
    vi.stubEnv('SUBMISSION_VAULT_URL', '');
    vi.stubEnv('SUBMISSION_VAULT_SERVICE_KEY', '');
    stubFetch({ larkAuth: { ridejob: 'bad_credentials' } });

    const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.missing).toEqual(expect.arrayContaining(['submission_vault_url']));
    expect(body.unreachable).toEqual(['lark_auth_ridejob:lark_code_10003']);
  });

  it.each(['deep=1', 'deep=false', 'deep=', 'deep=00'])(
    '?%s では実接続チェックを省かない（deep=0 だけが省略）',
    async (q) => {
      vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
      for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
      stubFetch({ larkAuth: 'bad_credentials' });

      const req = new NextRequest(`https://ridejob.jp/api/health?${q}`, {
        headers: { 'x-health-token': 'secret' },
      });
      expect((await GET(req)).status).toBe(503);
    },
  );

  it('env が足りないときは relay を叩かない（叩いても意味がない）', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('SUBMISSION_VAULT_URL', '');
    vi.stubEnv('OPENAI_ADS_PIXEL_ID', '');
    vi.stubEnv('OPENAI_ADS_CAPI_KEY', '');
    vi.stubEnv('OPENAI_ADS_RELAY_URL', 'https://ridejob.jp/entry/api/openai/conversions');
    vi.stubEnv('OPENAI_ADS_RELAY_TOKEN', 'relay-secret');
    stubFetch();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    await GET(makeRequest({ 'x-health-token': 'secret' }));
    // tenant_access_token（deep認証）と /fields（列チェック）は missing と無関係に走る。
    // relay 呼び出しはそのどちらでもない呼び出しとして判別する。
    const relayCalls = fetchMock.mock.calls.filter(
      (c) => !String(c[0]).includes('tenant_access_token') && !String(c[0]).includes('/fields'),
    );
    expect(relayCalls).toHaveLength(0);
  });

  it('degraded にも deep が入り、実接続まで見たかが受け手に分かる', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    vi.stubEnv('SUBMISSION_VAULT_URL', '');
    stubFetch();

    // deep=0: env だけを見た。資格情報が無事かは分からない
    const r0 = await GET(
      new NextRequest('https://ridejob.jp/api/health?deep=0', { headers: { 'x-health-token': 'secret' } }),
    );
    expect(await r0.json()).toEqual({ status: 'degraded', deep: false, missing: ['submission_vault_url'] });

    // 既定: 資格情報まで見たうえで、env だけが足りない
    const r1 = await GET(makeRequest({ 'x-health-token': 'secret' }));
    expect(await r1.json()).toEqual({ status: 'degraded', deep: true, missing: ['submission_vault_url'] });
  });


  it.each(
    DEEP_CHECK_PROFILES.flatMap((p) =>
      ['ID', 'SECRET', 'TOKEN'].map((k) => `APP_${k}_${p.toUpperCase()}`),
    ),
  )('%s が欠けたら missing に出る（not_configured を捨ててよい前提）', (name) => {
    // route.ts は not_configured を unreachable に載せない。それが安全なのは APP_* の欠落が
    // missing で必ず名指しされるから。プロファイルを足して必須 env に入れ忘れると、
    // 資格情報が無いのに誰も鳴らない状態が黙って生まれる。それをここで止める。
    for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
    expect(findMissingEnvGroups()).toEqual([]);
    vi.stubEnv(name, '');
    expect(findMissingEnvGroups().length).toBeGreaterThan(0);
  });

  // ここから: Lark Base の表に、書き込み側が使う列がそろっているかの確認（mismatched）
  describe('Base の列チェック（mismatched）', () => {
    it('通知のあとに書き戻す列も、整備士と liftjob の期待列に入れる', () => {
      const expectedOf = (profile: string) =>
        resolveExpectedColumnsGroups().find((g) => g.profile === profile)!.expected;
      expect(expectedOf('mechanic')).toContain('Lark通知送信済み');
      expect(expectedOf('liftjob')).toContain('Lark通知送信済み');
      // ridejob は対応履歴メモに印を書く
      expect(expectedOf('ridejob')).not.toContain('Lark通知送信済み');
      expect(expectedOf('ridejob')).toContain('対応履歴メモ');
    });

    it('列がすべてそろっていれば ready のまま', async () => {
      vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
      for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
      stubFetch();

      const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ready', deep: true });
    });

    it('ridejob の表に列が1つ無ければ 503・mismatched に列名が入る', async () => {
      vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
      for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
      const missingColumn = resolveExpectedColumnsGroups().find((g) => g.profile === 'ridejob')!.expected[0];
      stubFetch({ missingColumns: { ridejob: [missingColumn] } });

      const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        status: 'degraded',
        deep: true,
        mismatched: [`lark_columns_ridejob:${missingColumn}`],
      });
    });

    it('表が読めなければ列の不足と分けて lark_base_ で返す', async () => {
      vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
      for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
      const missingColumn = resolveExpectedColumnsGroups().find((g) => g.profile === 'ridejob')!.expected[0];
      stubFetch({
        missingColumns: { ridejob: [missingColumn] },
        fieldsError: {
          mechanic: { status: 403, body: { code: 91403, msg: 'Forbidden' } },
          liftjob: { status: 200, body: { code: 1254003, msg: 'WrongBaseToken' } },
        },
      });

      const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        status: 'degraded',
        deep: true,
        mismatched: [
          `lark_columns_ridejob:${missingColumn}`,
          'lark_base_mechanic:http_403',
          'lark_base_liftjob:lark_code_1254003',
        ],
      });
    });

    it('認証が通らないプロファイルは列を調べない', async () => {
      vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
      for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
      stubFetch({ larkAuth: { mechanic: 'bad_credentials' } });
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

      await GET(makeRequest({ 'x-health-token': 'secret' }));
      const mechanicTableId = resolveExpectedColumnsGroups().find((g) => g.profile === 'mechanic')!.tableId;
      const fieldsCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/fields'));
      expect(fieldsCalls.some((c) => String(c[0]).includes(`/tables/${mechanicTableId}/fields`))).toBe(false);
      // 認証が通った ridejob / liftjob は調べにいく
      expect(fieldsCalls.length).toBeGreaterThan(0);
    });

    it('?deep=0 では列を調べない', async () => {
      vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
      for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
      stubFetch();
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

      const req = new NextRequest('https://ridejob.jp/api/health?deep=0', {
        headers: { 'x-health-token': 'secret' },
      });
      const res = await GET(req);
      expect(await res.json()).toEqual({ status: 'ready', deep: false });
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/fields'))).toBe(false);
    });

    it('列不足の応答にも秘密情報を含めない', async () => {
      vi.stubEnv('HEALTH_CHECK_TOKEN', 'secret');
      for (const [k, v] of Object.entries(LARK_ENV)) vi.stubEnv(k, v);
      const missingColumn = resolveExpectedColumnsGroups().find((g) => g.profile === 'ridejob')!.expected[0];
      stubFetch({ missingColumns: { ridejob: [missingColumn] } });

      const res = await GET(makeRequest({ 'x-health-token': 'secret' }));
      expect(res.status).toBe(503);
      const text = JSON.stringify(await res.json());
      for (const secret of [
        'secret_ridejob', 'secret_mechanic', 'secret_liftjob',
        'cli_ridejob', 'cli_mechanic', 'cli_liftjob',
        'app_ridejob', 'test-vault-key', 'relay-secret', 'open.larksuite.com',
      ]) {
        expect(text).not.toContain(secret);
      }
    });
  });
});
