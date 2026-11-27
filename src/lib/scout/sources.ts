import { dbAll } from "./db";
import { ScoutError } from "./config";
import { normalizeEmail } from "./policy";
import * as jobdb from "../jobdb";
import { jobsReadSource } from "../jobs-source";
import type { Candidate, ConsentEvidence, ScoutJob } from "./types";

const bases = {
  driver: {
    suffix: "RIDEJOB",
    app: "NLyWbgTsfaLpIlsQBcijfcMWprd",
    table: "tblO0pPqFyHqpVcj",
  },
  mechanic: {
    suffix: "MECHANIC",
    app: "As9mbdBVwau6KNsqYLqjUPJspCf",
    table: "tblXcvtQJqoD2PIV",
  },
} as const;
type Base = keyof typeof bases;
type RecordRow = { record_id: string; fields: Record<string, unknown> };
type Field = { field_name: string; type: number; is_primary?: boolean };
const tokenCache = new Map<string, { token: string; until: number }>();

export function fieldText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    const isTextSegments = v.every(
      (part) => part && typeof part === "object" && "text" in part,
    );
    return v
      .map(fieldText)
      .filter(Boolean)
      .join(isTextSegments ? "" : " / ");
  }
  if (typeof v === "object" && "text" in v) return fieldText(v.text);
  if (typeof v === "object" && "value" in v) return fieldText(v.value);
  return "";
}
async function lark(base: Base, path: string, init: RequestInit = {}) {
  const b = bases[base];
  const appId = process.env[`APP_ID_${b.suffix}`];
  const appSecret = process.env[`APP_SECRET_${b.suffix}`];
  if (!appId || !appSecret || process.env[`APP_TOKEN_${b.suffix}`] !== b.app)
    throw new ScoutError("対象のLark DBへの接続設定が必要です");
  // URLは固定。設定ミスで認証情報を別ドメインへ送らない。
  const root = "https://open.larksuite.com/open-apis";
  let auth = tokenCache.get(appId);
  if (!auth || auth.until < Date.now()) {
    const r = await fetch(`${root}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const j = await r.json();
    if (!r.ok || j.code !== 0 || !j.tenant_access_token)
      throw new ScoutError("Lark認証を確認できません");
    auth = {
      token: j.tenant_access_token,
      until: Date.now() + Math.max(0, j.expire - 300) * 1000,
    };
    tokenCache.set(appId, auth);
  }
  const r = await fetch(`${root}/bitable/v1/apps/${b.app}/tables/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok || j.code !== 0 || !j.data) {
    tokenCache.delete(appId);
    throw new ScoutError("Larkの最新状態を取得できません");
  }
  return j.data;
}
async function listFields(base: Base, table: string): Promise<Field[]> {
  const result: Field[] = [];
  let page = "";
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({
      page_size: "100",
      ...(page ? { page_token: page } : {}),
    });
    const data = await lark(base, `${table}/fields?${q}`);
    result.push(...data.items);
    if (!data.has_more) return result;
    if (!data.page_token || data.page_token === page) break;
    page = data.page_token;
  }
  throw new ScoutError("Larkの項目定義を全件取得できません");
}
async function listRecords(
  base: Base,
  table: string,
  fieldNames: string[],
): Promise<RecordRow[]> {
  const rows: RecordRow[] = [];
  let page = "";
  for (let i = 0; i < 100; i++) {
    const q = new URLSearchParams({
      page_size: "500",
      ...(page ? { page_token: page } : {}),
    });
    const data = await lark(base, `${table}/records/search?${q}`, {
      method: "POST",
      body: JSON.stringify({ field_names: fieldNames }),
    });
    if (!Array.isArray(data.items))
      throw new ScoutError("Larkの取得結果を確認できません");
    rows.push(...data.items);
    if (!data.has_more) {
      if (new Set(rows.map((r) => r.record_id)).size !== rows.length)
        throw new ScoutError(
          "候補者の取得中に内容が変わりました。再度確認してください",
        );
      return rows;
    }
    if (!data.page_token || data.page_token === page) break;
    page = data.page_token;
  }
  throw new ScoutError("候補者を全件取得できません");
}
export async function loadCandidates(): Promise<Candidate[]> {
  const masterFields = await listFields("driver", "tblqrcaY1egdi2K1");
  const primary = masterFields.find((f) => f.is_primary);
  if (!primary) throw new ScoutError("応募職種マスタを確認できません");
  const master = new Map(
    (await listRecords("driver", "tblqrcaY1egdi2K1", [primary.field_name])).map(
      (r) => [r.record_id, fieldText(r.fields[primary.field_name])],
    ),
  );
  const required = [
    "求職者名",
    "メールアドレス",
    "電話番号",
    "メール配信停止フラグ",
    "メール配信同意取得日",
    "メール配信同意取得方法",
  ];
  const optional = [
    "Status",
    "ステータス",
    "都道府県",
    "居住地/都道府県",
    "保有資格",
    "資格",
    "登録職種",
    "マスタ-応募職種",
    "応募日",
  ];
  return (
    await Promise.all(
      (Object.keys(bases) as Base[]).map(async (base) => {
        const b = bases[base];
        const schema = await listFields(base, b.table);
        if (
          required.some((name) => !schema.some((f) => f.field_name === name)) ||
          schema.find((f) => f.field_name === "メール配信停止フラグ")?.type !==
            7
        )
          throw new ScoutError(
            "Larkの同意・停止項目が変更されています。管理者に確認してください",
          );
        const fields = [
          ...required,
          ...optional.filter((name) =>
            schema.some((f) => f.field_name === name),
          ),
        ];
        const rows = await listRecords(base, b.table, fields);
        return rows.map((r) => {
          const f = r.fields;
          const name = fieldText(f["求職者名"]);
          const linked = f["マスタ-応募職種"] as
            { link_record_ids?: string[] } | undefined;
          const role =
            base === "driver"
              ? (linked?.link_record_ids ?? [])
                  .map((id) => master.get(id) || "未確認")
                  .join(" / ")
              : fieldText(f["登録職種"]);
          const consentDate =
            typeof f["メール配信同意取得日"] === "number"
              ? (f["メール配信同意取得日"] as number)
              : null;
          const stop = f["メール配信停止フラグ"];
          const applied = f["応募日"];
          return {
            id: `${base}:${r.record_id}`,
            name,
            email: normalizeEmail(fieldText(f["メールアドレス"])),
            phone: fieldText(f["電話番号"]),
            role:
              role || (base === "mechanic" ? "整備士（詳細未確認）" : "未確認"),
            region: fieldText(f["都道府県"] ?? f["居住地/都道府県"]),
            qualifications: fieldText(f["保有資格"] ?? f["資格"]),
            status: fieldText(f.Status ?? f["ステータス"]),
            appliedAt:
              typeof applied === "number" && Number.isFinite(applied)
                ? new Date(applied).toISOString()
                : null,
            consentDate,
            consentMethod: fieldText(f["メール配信同意取得方法"]),
            emailStopped: stop === true,
            stopKnown: stop == null || typeof stop === "boolean",
            isTest: /テスト|test/i.test(name),
          } satisfies Candidate;
        });
      }),
    )
  ).flat();
}

export async function loadEvidence(): Promise<ConsentEvidence[]> {
  type Row = {
    source: string;
    submission_id: string;
    email: string | null;
    phone: string | null;
    recorded: string;
    consent: unknown;
    is_test: boolean;
  };
  const rows = await dbAll<Row>(
    "rpc/scout_consent_evidence",
    new URLSearchParams({ order: "source.asc,submission_id.asc" }),
  );
  return rows.map((r) => ({
    source: r.source,
    submissionId: r.submission_id,
    email: r.email ?? "",
    phone: r.phone ?? "",
    recordedAt: r.recorded,
    consent: r.consent,
    isTest: r.is_test,
  }));
}

export async function syncStop(email: string, all: Candidate[]): Promise<void> {
  for (const c of all.filter(
    (c) => normalizeEmail(c.email) === normalizeEmail(email) && !c.emailStopped,
  )) {
    const [base, id] = c.id.split(":") as [Base, string];
    await lark(base, `${bases[base].table}/records/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ fields: { メール配信停止フラグ: true } }),
    });
    const readback = await lark(
      base,
      `${bases[base].table}/records/${encodeURIComponent(id)}`,
    );
    if (readback.record?.fields?.["メール配信停止フラグ"] !== true)
      throw new ScoutError("配信停止のLark反映を確認できません");
  }
}

// 公開中の求人1件（CMS の depth=1 の形）。読み先は JOBS_READ_SOURCE（jobs-source.ts）に従う。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPublishedJob(id: string): Promise<any> {
  if (jobsReadSource() === "jobdb") {
    if (!jobdb.hasJobdbConfig()) throw new ScoutError("求人への接続設定が必要です");
    let job;
    try {
      job = await jobdb.fetchJobById(id);
    } catch (error) {
      // CMS の取得で !r.ok と同じ扱い（通信の失敗はそのまま投げる）
      if (error instanceof jobdb.JobdbHttpError)
        throw new ScoutError("公開中の求人を確認できません", 409);
      throw error;
    }
    if (!job) throw new ScoutError("公開中の求人を確認できません", 409);
    return job;
  }
  const domain = process.env.MICROCMS_SERVICE_DOMAIN;
  const key = process.env.MICROCMS_API_KEY;
  if (!domain || !/^[a-zA-Z0-9-]+$/.test(domain) || !key)
    throw new ScoutError("求人への接続設定が必要です");
  const r = await fetch(
    `https://${domain}.microcms.io/api/v1/jobs/${id}?depth=1`,
    {
      headers: { "X-MICROCMS-API-KEY": key },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!r.ok) throw new ScoutError("公開中の求人を確認できません", 409);
  return r.json();
}

export async function loadJob(id: string): Promise<ScoutJob> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new ScoutError("求人IDを確認してください", 400);
  const job = await fetchPublishedJob(id);
  if (job.id !== id || !job.publishedAt || !job.updatedAt)
    throw new ScoutError("公開求人の内容を確認できません", 409);
  // 公開中だけでは紹介許可を代替しない。担当者確認と併用する。
  return {
    id,
    title: fieldText(job.title || job.jobName || job.catchCopy),
    company: job.hideCompanyName ? "非公開" : fieldText(job.companyName),
    region: fieldText(job.addressPrefMuni || job.prefecture?.region),
    url: `https://ridejob.jp/job/${encodeURIComponent(id)}`,
    updatedAt: job.updatedAt,
    category: fieldText(job.jobCategory?.name),
    work: fieldText(job.descriptionWork),
    requirements: fieldText(job.descriptionPerson),
  };
}
