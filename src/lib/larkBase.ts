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

export type LarkLinkedRecordName = {
  linkedRecordName: string;
};

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

// tenant_access_token はアプリ（プロファイル）単位で払い出されるためプロファイル別にキャッシュする。
const tokenCacheByProfile = new Map<LarkProfile, TokenCache>();

// マスタ（応募経由・応募職種）はほぼ変わらないのに、リンク解決のたびに fields と records を取りに行くと
// 応募1件あたり4リクエスト増える。応募の待ち時間に直結するのでプロセス内で短時間だけ持つ。
// 選択肢を足した直後はこの時間だけ古い一覧を見るが、解決できなければそのフィールドを落とすだけで応募は通る。
const MASTER_CACHE_TTL_MS = 10 * 60 * 1000;

// リンク解決に使ってよい合計時間。レコード作成1回あたりの上限で、リンクフィールドが増えても伸びない。
// 個々のリクエストは5秒で切れるが、Lark API が遅いときに直列で積み上がると応募APIごと
// Vercel の実行時間上限に当たり、Webhook フォールバックにも入れないまま応募を落としかねない。
// 超えた分は解決を諦めてフィールドを空欄にする（応募そのものは通す）。
const LINK_RESOLVE_BUDGET_MS = 6000;

type CacheEntry<T> = { value: T; expiresAt: number };
type LinkedRecord = { record_id?: string; fields?: Record<string, unknown> };
type TableField = Record<string, unknown>;
const tableFieldsCache = new Map<string, CacheEntry<TableField[]>>();
const linkedRecordsCache = new Map<string, CacheEntry<LinkedRecord[]>>();

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + MASTER_CACHE_TTL_MS });
}

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

async function getJson(
  cfg: LarkBaseConfig,
  token: string,
  path: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${cfg.domain}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.code !== 0) {
    throw new Error(`Base API読取失敗: code=${data.code} msg=${data.msg}`);
  }
  return data;
}

function containsText(value: unknown, expected: string): boolean {
  if (typeof value === "string") return value === expected;
  if (Array.isArray(value)) return value.some((item) => containsText(item, expected));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => containsText(item, expected));
  }
  return false;
}

// テーブル単位でキャッシュする。同じテーブルのリンクフィールドが複数あっても取得は1回で済む。
async function fetchTableFields(
  cfg: LarkBaseConfig,
  token: string,
  tableId: string
): Promise<TableField[]> {
  const cacheKey = `${cfg.appToken}/${tableId}`;
  const cached = readCache(tableFieldsCache, cacheKey);
  if (cached) return cached;

  const fieldsResponse = await getJson(
    cfg,
    token,
    `/open-apis/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/fields?page_size=100`
  );
  const fields = ((fieldsResponse.data as { items?: TableField[] } | undefined)?.items) ?? [];
  writeCache(tableFieldsCache, cacheKey, fields);
  return fields;
}

async function fetchLinkedTableId(
  cfg: LarkBaseConfig,
  token: string,
  tableId: string,
  fieldName: string
): Promise<string> {
  const fields = await fetchTableFields(cfg, token, tableId);
  const field = fields.find((item) => item.field_name === fieldName);
  const linkedTableId = (field?.property as { table_id?: string } | undefined)?.table_id;
  if (!linkedTableId) {
    throw new Error(`リンクフィールド「${fieldName}」のリンク先テーブルを取得できません`);
  }
  return linkedTableId;
}

async function fetchLinkedRecords(
  cfg: LarkBaseConfig,
  token: string,
  linkedTableId: string
): Promise<LinkedRecord[]> {
  const cacheKey = `${cfg.appToken}/${linkedTableId}`;
  const cached = readCache(linkedRecordsCache, cacheKey);
  if (cached) return cached;

  const items: LinkedRecord[] = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);
    const recordsResponse = await getJson(
      cfg,
      token,
      `/open-apis/bitable/v1/apps/${cfg.appToken}/tables/${linkedTableId}/records?${query}`
    );
    const data = recordsResponse.data as {
      items?: LinkedRecord[];
      has_more?: boolean;
      page_token?: string;
    } | undefined;
    items.push(...(data?.items ?? []));
    pageToken = data?.has_more ? (data.page_token || "") : "";
  } while (pageToken);

  writeCache(linkedRecordsCache, cacheKey, items);
  return items;
}

async function resolveLinkedRecordId(
  cfg: LarkBaseConfig,
  token: string,
  tableId: string,
  fieldName: string,
  recordName: string
): Promise<string> {
  const linkedTableId = await fetchLinkedTableId(cfg, token, tableId, fieldName);
  const records = await fetchLinkedRecords(cfg, token, linkedTableId);
  const match = records.find((record) => containsText(record.fields, recordName));
  if (match?.record_id) return match.record_id;
  throw new Error(`リンク先に「${recordName}」のレコードが見つかりません`);
}

// 指定プロファイルのアプリで、指定テーブルにレコードを1件作成する。失敗時は throw。
// undefined / 空文字のフィールドは送信しない。
export async function createBaseRecord(
  tableId: string,
  fields: Record<string, LarkFieldValue | LarkLinkedRecordName | undefined>,
  profile: LarkProfile = DEFAULT_PROFILE
): Promise<void> {
  const cfg = readConfig(profile);
  if (!cfg) {
    const s = profile.toUpperCase();
    throw new Error(`Lark Base 認証情報（APP_ID_${s} / APP_SECRET_${s} / APP_TOKEN_${s}）が未設定です。`);
  }

  let token = await fetchTenantAccessToken(cfg, profile);
  const cleaned: Record<string, LarkFieldValue> = {};
  const linkResolveDeadline = Date.now() + LINK_RESOLVE_BUDGET_MS;
  for (const [k, v] of Object.entries(fields)) {
    if (v && typeof v === "object" && !Array.isArray(v) && "linkedRecordName" in v) {
      try {
        if (Date.now() >= linkResolveDeadline) {
          throw new Error(`リンク解決の制限時間(${LINK_RESOLVE_BUDGET_MS}ms)を超えました`);
        }
        cleaned[k] = [await resolveLinkedRecordId(cfg, token, tableId, k, v.linkedRecordName)];
      } catch (e) {
        // リンク解決に失敗しても、そのフィールドを落としてレコード作成は続ける。
        // ここで throw すると呼び出し側が Base Webhook にフォールバックし、utm・広告ID・保有資格など
        // 他の全フィールドまで失われる（2026-08-12 に欠損レコードが実際に発生した）。
        console.error(`Lark Base リンク解決に失敗したため「${k}」を省略します:`, e);
      }
    } else if (v !== undefined && v !== "") {
      cleaned[k] = v as LarkFieldValue;
    }
  }

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
