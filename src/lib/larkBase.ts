// Lark Bitable(Base)へレコードを作成する軽量クライアント。
// tenant_access_token を取得 →（プロファイル別にプロセス内キャッシュ）→ 指定テーブルへ records 作成。
// プロファイル = .env の接尾辞。APP_ID_<PROFILE> / APP_SECRET_<PROFILE> / APP_TOKEN_<PROFILE> /
// LARK_DOMAIN_<PROFILE> を読む（例: MECHANIC, RIDEJOB）。
// Webhook 方式と異なり、フィールドを直接指定して書けるのが利点。

import { createHash } from "node:crypto";

import { describeError } from "./describe-error";

// 認証プロファイル。投入先 Base（Bitable アプリ）ごとに異なるアプリ資格情報を使う。
//   mechanic … 求職者DB👷‍♂️ / IDOM_新卒2027 等（既存 APP_*_MECHANIC）
//   ridejob  … 求職者DB🚕 等（APP_*_RIDEJOB）
export type LarkProfile = "mechanic" | "ridejob" | "liftjob";

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
const TOKEN_ERROR_CODES = new Set([99991661, 99991663, 99991664]);

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

async function withTokenRefresh<T extends { code?: number }>(
  cfg: LarkBaseConfig,
  profile: LarkProfile,
  operation: (token: string) => Promise<T>,
): Promise<T> {
  let token = await fetchTenantAccessToken(cfg, profile);
  let result = await operation(token);
  if (typeof result.code === "number" && TOKEN_ERROR_CODES.has(result.code)) {
    tokenCacheByProfile.delete(profile);
    token = await fetchTenantAccessToken(cfg, profile);
    result = await operation(token);
  }
  return result;
}

async function postRecord(
  cfg: LarkBaseConfig,
  token: string,
  tableId: string,
  fields: Record<string, LarkFieldValue>,
  clientToken?: string,
): Promise<{ code?: number; msg?: string; ok: boolean; recordId?: string }> {
  const query = clientToken ? `?client_token=${encodeURIComponent(clientToken)}` : "";
  const url = `${cfg.domain}/open-apis/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/records${query}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    data?: { record?: { record_id?: string } };
  };
  return {
    code: data.code,
    msg: data.msg,
    ok: res.ok,
    recordId: data.data?.record?.record_id,
  };
}

/** 任意の安定IDをLark client_token用の決定的UUID v4表現へ変換する。 */
function idempotencyToken(value: string): string {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function putRecord(
  cfg: LarkBaseConfig,
  token: string,
  tableId: string,
  recordId: string,
  fields: Record<string, LarkFieldValue>
): Promise<{ code?: number; msg?: string; ok: boolean }> {
  const url = `${cfg.domain}/open-apis/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/records/${recordId}`;
  const res = await fetch(url, {
    method: "PUT",
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

async function prepareFields(
  cfg: LarkBaseConfig,
  token: string,
  tableId: string,
  fields: Record<string, LarkFieldValue | LarkLinkedRecordName | undefined>,
): Promise<Record<string, LarkFieldValue>> {
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
        // エラーオブジェクトを丸ごと渡さない。message にリンク先の値（市区町村名など）が
        // 載ることがあり、スタックごとログに出すと個人情報の断片が残る（describeError 参照）。
        console.error(`Lark Base リンク解決に失敗したため「${k}」を省略します:`, describeError(e));
      }
    } else if (v !== undefined && v !== "") {
      cleaned[k] = v as LarkFieldValue;
    }
  }
  return cleaned;
}

type SearchRecord = {
  record_id?: string;
  fields?: Record<string, unknown>;
};

async function searchRecordsByTextField(
  cfg: LarkBaseConfig,
  profile: LarkProfile,
  tableId: string,
  fieldName: string,
  value: string,
  operator: "is" | "contains" = "is",
  // 一意キーの upsert は2件あれば「複数件」を検出できるので既定は2のまま。
  // 電話番号のように1人が複数行を持ちうる検索では、呼び出し側が広げて新しい順に並べる。
  opts: { pageSize?: number; sortByNewest?: boolean } = {},
): Promise<SearchRecord[]> {
  const pageSize = opts.pageSize ?? 2;
  const url = `${cfg.domain}/open-apis/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/records/search?page_size=${pageSize}`;
  const result = await withTokenRefresh(cfg, profile, async (token) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        filter: {
          conjunction: "and",
          conditions: [{ field_name: fieldName, operator, value: [value] }],
        },
        // 並び順を指定しないと、Lark の既定順（概ね作成順）の先頭 pageSize 件しか返らない。
        // 同じ電話番号に古い行が複数あると新しい行が落ち、重複判定がいちばん効いてほしい
        // 相手（既に何行もある人）に効かなくなる。
        ...(opts.sortByNewest ? { sort: [{ field_name: "応募日", desc: true }] } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      data?: { items?: SearchRecord[] };
    };
    return { ok: res.ok, ...data };
  });
  if (!result.ok || result.code !== 0) {
    throw new Error(`Base レコード検索失敗: code=${result.code} msg=${result.msg}`);
  }
  return result.data?.items ?? [];
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
  const cleaned = await prepareFields(cfg, token, tableId, fields);

  let result = await postRecord(cfg, token, tableId, cleaned);

  // トークン失効（99991661/99991663 など）時はキャッシュを捨てて1度だけ再試行。
  if (!result.ok || (typeof result.code !== "undefined" && result.code !== 0)) {
    if (typeof result.code === "number" && TOKEN_ERROR_CODES.has(result.code)) {
      tokenCacheByProfile.delete(profile);
      token = await fetchTenantAccessToken(cfg, profile);
      result = await postRecord(cfg, token, tableId, cleaned);
    }
  }

  if (!result.ok || (typeof result.code !== "undefined" && result.code !== 0)) {
    throw new Error(`Base レコード作成失敗: code=${result.code} msg=${result.msg}`);
  }
}

export type BaseUpsertResult = {
  recordId: string;
  created: boolean;
  previousFields: Record<string, unknown>;
};

/** Text列の一意キーで既存なら任意で更新し、無ければ作成する。 */
/**
 * 同じ応募が直近に入っていないかを、電話番号で1件だけ確かめる。
 *
 * ## なぜ電話番号で見るのか
 *
 * 冪等キー（submission_id）は Bitable への直書き経路にしか実装されていない。
 * 直書きが失敗して Base 自動化 Webhook に落ちると、自動化は submission_id を
 * 対応履歴メモに書かないため、次の再送で「既存レコードあり」と判定できず
 * 同じ応募が何行も増える。
 *
 * 2026-09-23 に実際そうなった。#93 で Webhook フォールバックを戻した直後、
 * 自社LP経由 45レコードに対し実人数は 8人（電話番号ベース・最多の人は15行）。
 * 障害前の 9/16 は 25レコード / 24人 だった。
 *
 * 電話番号は必須項目で全件埋まっており、この経路で使える唯一の実質的な鍵。
 * **完全な冪等キーではない**（同じ人が別職種へ応募する場合がある）ので、
 * 直近の短い時間窓に限って「取り違え」より「重複」を止めることを優先する。
 * 本来の解は直書きを直すことで、これはその間のつっかえ棒。
 */
export async function findRecentRecordByPhone(
  tableId: string,
  phoneNumber: string,
  withinMs: number,
  profile: LarkProfile = DEFAULT_PROFILE,
): Promise<{ recordId: string; fields: Record<string, unknown> } | null> {
  const cfg = readConfig(profile);
  const phone = (phoneNumber || "").trim();
  if (!cfg || !phone) return null;
  // 1人が複数行を持ちうるので、件数を広げて新しい順に取る。
  const found = await searchRecordsByTextField(
    cfg, profile, tableId, "電話番号", phone, "is",
    { pageSize: 20, sortByNewest: true },
  );
  const now = Date.now();
  for (const r of found) {
    if (!r.record_id) continue;
    const submittedAt = Number(r.fields?.["応募日"]);
    // ⚠️ 応募日が読めない行は**重複と判定しない**。
    //
    // 求職者DB🚕 は Meta・Indeed・自社HP など全チャネルの応募が入るテーブルで、
    // 応募日が埋まっていない行（手入力・他媒体の取り込み）が混ざる。これを
    // 「直近の重複」とみなすと、半年前の別応募のせいで今回の応募が1行も作られない。
    // #89 の教訓どおり、重複は後から統合できるが、失われた応募は戻らない。
    // 判定できない行は「窓の外」として扱い、作る側に倒す。
    if (!Number.isFinite(submittedAt) || submittedAt <= 0) continue;
    if (now - submittedAt <= withinMs) {
      return { recordId: r.record_id, fields: r.fields ?? {} };
    }
  }
  return null;
}

export async function upsertBaseRecordByTextField(
  tableId: string,
  uniqueFieldName: string,
  uniqueValue: string,
  fields: Record<string, LarkFieldValue | LarkLinkedRecordName | undefined>,
  profile: LarkProfile = DEFAULT_PROFILE,
  operator: "is" | "contains" = "is",
  updateExisting = true,
): Promise<BaseUpsertResult> {
  const cfg = readConfig(profile);
  if (!cfg) {
    const s = profile.toUpperCase();
    throw new Error(`Lark Base 認証情報（APP_ID_${s} / APP_SECRET_${s} / APP_TOKEN_${s}）が未設定です。`);
  }
  if (!uniqueValue.trim()) throw new Error("Base upsertの一意キーが空です。");

  const searchCurrent = () => searchRecordsByTextField(
    cfg,
    profile,
    tableId,
    uniqueFieldName,
    uniqueValue,
    operator,
  );
  const records = await searchCurrent();
  if (records.length > 1) {
    throw new Error(`Base upsertの一意キー「${uniqueValue}」が複数件あります。`);
  }

  const existing = records[0];
  if (existing?.record_id) {
    // 応募受付の再送では、通知済み印を含む既存レコードを読み取り専用で扱う。
    // 更新すると通知済み印が消え、次回の再送で二重通知になるため。
    if (!updateExisting) {
      return {
        recordId: existing.record_id,
        created: false,
        previousFields: existing.fields ?? {},
      };
    }
    const token = await fetchTenantAccessToken(cfg, profile);
    const cleaned = await prepareFields(cfg, token, tableId, fields);
    const result = await withTokenRefresh(
      cfg,
      profile,
      (freshToken) => putRecord(cfg, freshToken, tableId, existing.record_id!, cleaned),
    );
    if (!result.ok || result.code !== 0) {
      throw new Error(`Base レコード更新失敗: code=${result.code} msg=${result.msg}`);
    }
    return {
      recordId: existing.record_id,
      created: false,
      previousFields: existing.fields ?? {},
    };
  }

  const token = await fetchTenantAccessToken(cfg, profile);
  const cleaned = await prepareFields(cfg, token, tableId, fields);
  // 検索→作成の間に同じsubmission_idが同時到着しても、Lark側で作成を1件に畳む。
  const result = await withTokenRefresh(
    cfg,
    profile,
    (freshToken) => postRecord(
      cfg,
      freshToken,
      tableId,
      cleaned,
      idempotencyToken(`${cfg.appToken}/${tableId}/${uniqueFieldName}/${uniqueValue}`),
    ),
  );
  if (result.code === 1254608) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const replayed = await searchCurrent();
    if (replayed.length !== 1 || !replayed[0]?.record_id) {
      throw new Error(`Base client_token重複後の再検索に失敗しました: matches=${replayed.length}`);
    }
    return {
      recordId: replayed[0].record_id,
      created: false,
      previousFields: replayed[0].fields ?? {},
    };
  }
  if (!result.ok || result.code !== 0 || !result.recordId) {
    throw new Error(`Base レコード作成失敗: code=${result.code} msg=${result.msg}`);
  }
  return { recordId: result.recordId, created: true, previousFields: {} };
}

export async function updateBaseRecord(
  tableId: string,
  recordId: string,
  fields: Record<string, LarkFieldValue | LarkLinkedRecordName | undefined>,
  profile: LarkProfile = DEFAULT_PROFILE,
): Promise<void> {
  const cfg = readConfig(profile);
  if (!cfg) {
    const s = profile.toUpperCase();
    throw new Error(`Lark Base 認証情報（APP_ID_${s} / APP_SECRET_${s} / APP_TOKEN_${s}）が未設定です。`);
  }
  const token = await fetchTenantAccessToken(cfg, profile);
  const cleaned = await prepareFields(cfg, token, tableId, fields);
  const result = await withTokenRefresh(
    cfg,
    profile,
    (freshToken) => putRecord(cfg, freshToken, tableId, recordId, cleaned),
  );
  if (!result.ok || result.code !== 0) {
    throw new Error(`Base レコード更新失敗: code=${result.code} msg=${result.msg}`);
  }
}

export type LarkMessageSendResult = {
  ok: boolean;
  status: number;
  code?: number;
  message?: string;
  messageId?: string;
  /** 通信例外で、Lark側だけ成功した可能性がある状態。Webhookへ即時フォールバックしない。 */
  ambiguous?: boolean;
};

/** 最大50文字の制約内で、長い応募IDも先頭一致による衝突を起こさないuuidへ変換する。 */
const larkMessageUuid = (value: string): string =>
  createHash('sha256').update(value.trim(), 'utf8').digest('hex').slice(0, 50);

/**
 * Lark IM APIでテキスト通知を送る。uuidは同一応募の同時・再送通知を1時間重複排除する。
 */
export async function sendLarkTextMessage(
  chatId: string,
  text: string,
  uuid: string,
  profile: LarkProfile = 'ridejob',
): Promise<LarkMessageSendResult> {
  const cfg = readConfig(profile);
  if (!cfg) return { ok: false, status: 0, message: 'Lark API credentials are not configured' };
  const endpoint = `${cfg.domain}/open-apis/im/v1/messages?receive_id_type=chat_id`;
  const call = async (token: string) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
        uuid: larkMessageUuid(uuid),
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      data?: { message_id?: string };
    };
    return { res, data };
  };

  try {
    let token = await fetchTenantAccessToken(cfg, profile);
    let result = await call(token);
    if (result.data.code === 99991661 || result.data.code === 99991663 || result.data.code === 99991664) {
      tokenCacheByProfile.delete(profile);
      token = await fetchTenantAccessToken(cfg, profile);
      result = await call(token);
    }
    if (!result.res.ok || result.data.code !== 0) {
      return {
        ok: false,
        status: result.res.status,
        code: result.data.code,
        message: result.data.msg,
      };
    }
    return {
      ok: true,
      status: result.res.status,
      code: 0,
      messageId: result.data.data?.message_id,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error),
      ambiguous: true,
    };
  }
}
