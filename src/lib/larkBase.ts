// Lark Bitable(Base)へレコードを作成する軽量クライアント。
// tenant_access_token を取得 →（プロファイル別にプロセス内キャッシュ）→ 指定テーブルへ records 作成。
// プロファイル = .env の接尾辞。APP_ID_<PROFILE> / APP_SECRET_<PROFILE> / APP_TOKEN_<PROFILE> /
// LARK_DOMAIN_<PROFILE> を読む（例: MECHANIC, RIDEJOB）。
// Webhook 方式と異なり、フィールドを直接指定して書けるのが利点。

// 認証プロファイル。投入先 Base（Bitable アプリ）ごとに異なるアプリ資格情報を使う。
//   mechanic … 求職者DB👷‍♂️ / IDOM_新卒2027 等（既存 APP_*_MECHANIC）
//   ridejob  … 求職者DB🚕 等（APP_*_RIDEJOB）
export type LarkProfile = "mechanic" | "ridejob";

const DEFAULT_PROFILE: LarkProfile = "mechanic";

interface LarkBaseConfig {
  domain: string;
  appId: string;
  appSecret: string;
  appToken: string;
}

// Bitable のフィールド値。Text/Select=string、MultiSelect=string[]、Number/DateTime=number、Checkbox=boolean。
export type LarkFieldValue = string | number | boolean | string[];

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

// tenant_access_token はアプリ（プロファイル）単位で払い出されるためプロファイル別にキャッシュする。
const tokenCacheByProfile = new Map<LarkProfile, TokenCache>();

function readConfig(profile: LarkProfile): LarkBaseConfig | null {
  const suffix = profile.toUpperCase();
  const domain = (process.env[`LARK_DOMAIN_${suffix}`] || "https://open.larksuite.com").replace(/\/+$/, "");
  const appId = process.env[`APP_ID_${suffix}`];
  const appSecret = process.env[`APP_SECRET_${suffix}`];
  const appToken = process.env[`APP_TOKEN_${suffix}`];
  if (!appId || !appSecret || !appToken) return null;
  return { domain, appId, appSecret, appToken };
}

// 認証情報が揃っているか。未設定なら呼び出し側で Base 登録をスキップ／Webhook にフォールバックできる
// （本番に env がまだ無い状態でデプロイされてもフォームを止めないため）。
export function isLarkBaseConfigured(profile: LarkProfile = DEFAULT_PROFILE): boolean {
  return readConfig(profile) !== null;
}

async function fetchTenantAccessToken(cfg: LarkBaseConfig, profile: LarkProfile): Promise<string> {
  const now = Date.now();
  // 期限の30秒前までは使い回す。
  const cached = tokenCacheByProfile.get(profile);
  if (cached && cached.expiresAt > now + 30_000) return cached.token;

  const res = await fetch(`${cfg.domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    code?: number;
    tenant_access_token?: string;
    expire?: number; // 秒
    msg?: string;
  };
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`tenant_access_token 取得失敗: code=${data.code} msg=${data.msg}`);
  }
  const token = data.tenant_access_token;
  tokenCacheByProfile.set(profile, {
    token,
    expiresAt: now + (data.expire ?? 7200) * 1000,
  });
  return token;
}

async function postRecord(
  cfg: LarkBaseConfig,
  token: string,
  tableId: string,
  fields: Record<string, LarkFieldValue>
): Promise<{ code?: number; msg?: string; ok: boolean }> {
  const url = `${cfg.domain}/open-apis/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/records`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
  return { code: data.code, msg: data.msg, ok: res.ok };
}

// 指定プロファイルのアプリで、指定テーブルにレコードを1件作成する。失敗時は throw。
// undefined / 空文字のフィールドは送信しない。
export async function createBaseRecord(
  tableId: string,
  fields: Record<string, LarkFieldValue | undefined>,
  profile: LarkProfile = DEFAULT_PROFILE
): Promise<void> {
  const cfg = readConfig(profile);
  if (!cfg) {
    const s = profile.toUpperCase();
    throw new Error(`Lark Base 認証情報（APP_ID_${s} / APP_SECRET_${s} / APP_TOKEN_${s}）が未設定です。`);
  }

  const cleaned: Record<string, LarkFieldValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== "") cleaned[k] = v;
  }

  let token = await fetchTenantAccessToken(cfg, profile);
  let result = await postRecord(cfg, token, tableId, cleaned);

  // トークン失効（99991661/99991663 など）時はキャッシュを捨てて1度だけ再試行。
  if (!result.ok || (typeof result.code !== "undefined" && result.code !== 0)) {
    if (result.code === 99991661 || result.code === 99991663) {
      tokenCacheByProfile.delete(profile);
      token = await fetchTenantAccessToken(cfg, profile);
      result = await postRecord(cfg, token, tableId, cleaned);
    }
  }

  if (!result.ok || (typeof result.code !== "undefined" && result.code !== 0)) {
    throw new Error(`Base レコード作成失敗: code=${result.code} msg=${result.msg}`);
  }
}
