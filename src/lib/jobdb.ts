// job-db（Supabase）の求人・マスタを、公開用のビュー（site_*）から PostgREST で読む。
//
// microcms.ts の関数と同じ引数・同じ戻り値（CMS の応答の形）にする。呼ぶ側は jobs-source.ts を通して使う。
// - 鍵は anon（公開キー）だけを使う。RLS と列単位の権限で、公開中の求人・サイトが使う列しか読めない。
//   service_role などの秘密の鍵は受け付けない（assertPublicKey）。
// - CMS の形に合わせる: 文字・数の空は項目ごと無い／参照の空は null／tags・images の空は []。
//   一覧・1件の取得とも depth=1 なので、参照の中の参照（市区町村の都道府県）は { id } だけにする。
// - 並び: CMS の既定（system:default）は createdAt の降順・同じ時刻は登録順。job-db では
//   cmsRank（同期が書く CMS の既定の並びの順位）で同じ順にする。
// - PostgREST は1回に1,000行までなので、全件はページを分けて取る。

import type { Job, JobsResponse, MunicipalityEntry, PrefectureEntry } from './microcms';
import { FALLBACK_PREFECTURES } from './prefecture-fallback';

const PAGE_SIZE = 1000;
// CMS の一覧の既定の件数（limit を付けないときの値）
const CMS_DEFAULT_LIMIT = 10;

const ORDER_DEFAULT = 'createdAt.desc,cmsRank.asc.nullslast,id.asc';
const ORDER_PUBLISHED_DESC = `publishedAt.desc.nullslast,${ORDER_DEFAULT}`;
const ORDER_MASTER = 'cmsRank.asc.nullslast,id.asc';

// site_jobs のうち CMS の項目だけ（絞り込み用の prefectureId・prefEff・tagIds・cmsRank・kwText などは取らない）
const JOB_SELECT = [
  'id', 'title', 'jobName', 'companyName', 'prefecture', 'municipality', 'addressPrefMuni', 'imageUrl', 'images',
  'tags', 'jobCategory', 'salaryMin', 'salaryMax', 'wageType', 'employmentType', 'expiresAt', 'companyUrl',
  'companyLogo', 'hideCompanyName', 'createdAt', 'updatedAt', 'publishedAt', 'revisedAt', 'catchCopy', 'addressZip',
  'addressLine', 'addressBuilding', 'workStyle', 'socialInsurance', 'salaryNote', 'descriptionAppeal',
  'descriptionWork', 'descriptionPerson', 'descriptionBenefits', 'workHours', 'holidays', 'descriptionOther',
  'access', 'applyEmail',
].join(',');
const PREFECTURE_SELECT = 'id,region,area,slug';
const MUNICIPALITY_SELECT = 'id,name,prefecture';

// 参照の項目（求人の都道府県・市区町村・職種、市区町村の都道府県）。空のときは CMS と同じく null のまま残す
const REFERENCE_KEYS = new Set(['prefecture', 'municipality', 'jobCategory']);

type Row = Record<string, unknown>;

export class JobdbHttpError extends Error {
  constructor(public status: number, statusText: string) {
    super(`job-db API error: ${status} ${statusText}`);
    this.name = 'JobdbHttpError';
  }
}

export class JobdbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobdbConfigError';
  }
}

/** 公開キーか（anon の JWT か sb_publishable_）。service_role・sb_secret_ は使わない。 */
function isPublicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  if (key.startsWith('sb_secret_')) return false;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return json?.role === 'anon';
  } catch {
    return false;
  }
}

/** job-db の接続設定（JOBDB_SUPABASE_URL・JOBDB_SUPABASE_ANON_KEY）。足りない・形が違うときは JobdbConfigError。 */
export function jobdbConfig(): { restUrl: string; key: string } {
  const rawUrl = process.env.JOBDB_SUPABASE_URL?.trim();
  const key = process.env.JOBDB_SUPABASE_ANON_KEY?.trim();
  if (!rawUrl || !key) {
    throw new JobdbConfigError('job-db environment variables are not set');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new JobdbConfigError('JOBDB_SUPABASE_URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new JobdbConfigError('JOBDB_SUPABASE_URL is invalid');
  }
  if (!isPublicKey(key)) {
    throw new JobdbConfigError('JOBDB_SUPABASE_ANON_KEY must be the public (anon) key');
  }
  return { restUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}/rest/v1`, key };
}

export function hasJobdbConfig(): boolean {
  try {
    jobdbConfig();
    return true;
  } catch {
    return false;
  }
}

type FetchMode = { cache: 'no-store'; timeoutMs: number } | { revalidate: number };
// 一覧・マスタは CMS と同じく 60秒の再検証。1件（応募の照合・スカウト）は CMS と同じく毎回・5秒で打ち切る。
const LIST_FETCH: FetchMode = { revalidate: 60 };
const ONE_FETCH: FetchMode = { cache: 'no-store', timeoutMs: 5000 };
// スカウトの事前確認の一覧（CMS の取得と同じ10秒）
const PREFLIGHT_FETCH: FetchMode = { cache: 'no-store', timeoutMs: 10000 };

async function request(
  view: string,
  params: URLSearchParams,
  options: { count?: boolean; mode?: FetchMode } = {},
): Promise<{ rows: Row[]; totalCount?: number }> {
  const { restUrl, key } = jobdbConfig();
  const mode = options.mode ?? LIST_FETCH;
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  if (options.count) headers.Prefer = 'count=exact';
  const init: RequestInit & { next?: { revalidate: number } } =
    'revalidate' in mode
      ? { headers, next: { revalidate: mode.revalidate } }
      : { headers, cache: 'no-store', signal: AbortSignal.timeout(mode.timeoutMs) };
  const response = await fetch(`${restUrl}/${view}?${params.toString()}`, init);
  if (!response.ok) {
    throw new JobdbHttpError(response.status, response.statusText);
  }
  const rows = (await response.json()) as Row[];
  if (!Array.isArray(rows)) {
    throw new JobdbHttpError(response.status, 'unexpected body');
  }
  let totalCount: number | undefined;
  if (options.count) {
    // Content-Range: 0-9/296 ・ */0
    const total = response.headers.get('content-range')?.split('/')[1];
    totalCount = total !== undefined && /^\d+$/.test(total) ? Number(total) : undefined;
    if (totalCount === undefined) {
      throw new JobdbHttpError(response.status, 'missing count');
    }
  }
  return { rows, totalCount };
}

/**
 * 全件をページに分けて取る（並びは一意になるよう id を最後に含めること）。件数（Content-Range）まで取り切るので、
 * サーバーの1回の上限が1,000行より小さくても途中で切れない。
 */
async function requestAll(view: string, params: URLSearchParams): Promise<Row[]> {
  const results: Row[] = [];
  for (let offset = 0; ; ) {
    const page = new URLSearchParams(params);
    page.set('limit', String(PAGE_SIZE));
    page.set('offset', String(offset));
    const { rows, totalCount } = await request(view, page, { count: true });
    results.push(...rows);
    offset += rows.length;
    if (rows.length === 0 || offset >= totalCount!) break;
  }
  return results;
}

/** PostgREST の in.() に入れる値。ID は英数字・ハイフン・下線だけを通す（呼ぶ側の検査と同じ）。 */
function inList(ids: string[]): string {
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('invalid id');
  }
  return `in.(${ids.join(',')})`;
}

const isPlainObject = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 1件を CMS の形に。depthLeft はこの下で中身まで出す参照の段数（depth=1 の1件なら 1）。
 * 文字・数の空（null）は項目ごと消す。参照の空は null のまま。展開しきった先の参照は { id } だけ。
 */
function shapeObject(value: Row, depthLeft: number): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(value)) {
    if (REFERENCE_KEYS.has(k)) {
      out[k] = isPlainObject(v) ? shapeReference(v, depthLeft) : null;
      continue;
    }
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function shapeReference(value: Row, depthLeft: number): Row {
  return depthLeft <= 0 ? { id: value.id } : shapeObject(value, depthLeft - 1);
}

/** site_jobs の1行を CMS（depth=1）の1件の形に。 */
export function toCmsJob(row: Row): Job {
  const out = shapeObject(row, 1);
  // title・imageUrl・expiresAt・companyUrl・companyLogo・hideCompanyName は CMS に無い項目で、同期が空に戻す
  // （2026-11-27 公開中の全件で6項目とも空を実測）。空でなければ出す。hideCompanyName は true のときだけ。
  if (out.hideCompanyName !== true) delete out.hideCompanyName;
  if (Array.isArray(out.tags)) {
    out.tags = out.tags.map((t) => (isPlainObject(t) ? shapeReference(t, 1) : t));
  }
  return out as unknown as Job;
}

/** マスタの1件を CMS の一覧（既定の depth=1）の形に。市区町村の都道府県は中身まで出る。 */
function toCmsMaster<T>(row: Row): T {
  return shapeObject(row, 1) as T;
}

// CMS の jobCategory[in]（2026-11-27 実測）: 職種は参照の項目なので [in] が効かない。
// - 単独（getLatestJobsByCategoryIds）: 空の一覧（totalCount なし）が返る
// - prefecture[equals] と [and] でつなぐ（getJobsByPrefectureId）: [in] が無視され、県だけで絞った結果が返る
// 切り替えで結果を変えないため、どちらも同じにする（直すかは別に決める）。

const shuffle = <T,>(items: T[]): T[] => [...items].sort(() => Math.random() - 0.5);

/** 公開中の求人を ID で1件。無い（公開中でない）ときは null。 */
export async function fetchJobById(jobId: string): Promise<Job | null> {
  const params = new URLSearchParams({ select: JOB_SELECT, id: `eq.${jobId}`, limit: '1' });
  const { rows } = await request('site_jobs', params, { mode: ONE_FETCH });
  return rows[0] ? toCmsJob(rows[0]) : null;
}

export async function fetchPrefectures(): Promise<PrefectureEntry[]> {
  try {
    const rows = await requestAll('site_prefectures', new URLSearchParams({ select: PREFECTURE_SELECT, order: ORDER_MASTER }));
    return rows.map((row) => toCmsMaster<PrefectureEntry>(row));
  } catch (error) {
    console.warn('Failed to fetch prefectures from job-db. Using fallback data.', error);
    return FALLBACK_PREFECTURES;
  }
}

export async function fetchMunicipalities(prefectureId?: string): Promise<MunicipalityEntry[]> {
  try {
    const params = new URLSearchParams({ select: MUNICIPALITY_SELECT, order: ORDER_MASTER });
    if (prefectureId) params.set('prefectureId', `eq.${prefectureId}`);
    const rows = await requestAll('site_municipalities', params);
    return rows.map((row) => toCmsMaster<MunicipalityEntry>(row));
  } catch (error) {
    console.warn('Failed to fetch municipalities from job-db. Returning empty list.', error);
    return [];
  }
}

export async function fetchPrefectureById(prefectureId: string): Promise<PrefectureEntry | null> {
  const params = new URLSearchParams({ select: PREFECTURE_SELECT, id: `eq.${prefectureId}`, order: ORDER_MASTER, limit: '1' });
  const { rows } = await request('site_prefectures', params);
  return rows[0] ? toCmsMaster<PrefectureEntry>(rows[0]) : null;
}

export async function fetchMunicipalityById(municipalityId: string): Promise<MunicipalityEntry | null> {
  const params = new URLSearchParams({ select: MUNICIPALITY_SELECT, id: `eq.${municipalityId}`, order: ORDER_MASTER, limit: '1' });
  const { rows } = await request('site_municipalities', params);
  return rows[0] ? toCmsMaster<MunicipalityEntry>(rows[0]) : null;
}

export async function getPrefectureByRegion(regionName: string): Promise<PrefectureEntry | null> {
  const params = new URLSearchParams({ select: PREFECTURE_SELECT, region: `eq.${regionName}`, order: ORDER_MASTER, limit: '1' });
  const { rows } = await request('site_prefectures', params);
  return rows[0] ? toCmsMaster<PrefectureEntry>(rows[0]) : null;
}

/**
 * CMS の getJobsByPrefectureId と同じ: limit を付けない（既定の10件・既定の並び）。県は参照の項目だけで見る
 * （住所の先頭の県名で補わない）。jobCategoryIds は CMS と同じく効かない（上の注記）。
 */
export async function getJobsByPrefectureId(prefectureId: string, jobCategoryIds?: string[]): Promise<JobsResponse> {
  void jobCategoryIds;
  const params = new URLSearchParams({
    select: JOB_SELECT,
    prefectureId: `eq.${prefectureId}`,
    order: ORDER_DEFAULT,
    limit: String(CMS_DEFAULT_LIMIT),
    offset: '0',
  });
  const { rows, totalCount } = await request('site_jobs', params, { count: true });
  return { contents: rows.map(toCmsJob), totalCount: totalCount!, offset: 0, limit: CMS_DEFAULT_LIMIT };
}

export async function getRandomJobsByPrefectureId(prefectureId: string, count: number = 3): Promise<Job[]> {
  const response = await getJobsByPrefectureId(prefectureId);
  if (response.contents.length === 0) return [];
  return shuffle(response.contents).slice(0, Math.min(count, response.contents.length));
}

/**
 * CMS では都道府県ごとに全件を取り、混ぜてから count 件を選ぶ。ここでは対象の ID だけを全件取り、
 * 選んだ count 件の中身を取る（選ばれる集合は同じ・転送を小さく）。
 */
export async function getRandomJobsByPrefectureIdsAndCategory(
  prefectureIds: string[],
  categoryId: string,
  count: number = 3,
): Promise<Job[]> {
  const ids = Array.from(new Set(prefectureIds.map((id) => id.trim()).filter(Boolean)));
  const trimmedCategoryId = categoryId.trim();
  if (ids.length === 0 || !trimmedCategoryId) return [];

  const idRows = await requestAll(
    'site_jobs',
    new URLSearchParams({
      select: 'id',
      prefectureId: inList(ids),
      jobCategoryId: `eq.${trimmedCategoryId}`,
      order: ORDER_DEFAULT,
    }),
  );
  if (idRows.length === 0) return [];
  const chosen = shuffle(idRows.map((row) => String(row.id))).slice(0, Math.min(count, idRows.length));
  const { rows } = await request(
    'site_jobs',
    new URLSearchParams({ select: JOB_SELECT, id: inList(chosen), order: ORDER_DEFAULT }),
  );
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  // 選んでから取るまでの間に非公開になったものは落とす
  return chosen.flatMap((id) => (byId.has(id) ? [toCmsJob(byId.get(id)!)] : []));
}

export async function getLatestJobsByCategoryId(categoryId: string, count: number = 3): Promise<Job[]> {
  const params = new URLSearchParams({
    select: JOB_SELECT,
    jobCategoryId: `eq.${categoryId}`,
    order: ORDER_PUBLISHED_DESC,
    limit: String(count),
  });
  const { rows } = await request('site_jobs', params);
  return rows.map(toCmsJob);
}

/** CMS は jobCategory[in] だけで絞るため、職種がいくつあっても空の一覧になる（上の注記）。同じく [] を返す。 */
export async function getLatestJobsByCategoryIds(categoryIds: string[], count: number = 3): Promise<Job[]> {
  void categoryIds;
  void count;
  jobdbConfig(); // CMS と同じく、接続設定が無ければ例外
  return [];
}

/** 公開日の新しい順に count 件の { id, publishedAt }（スカウトの事前確認用。CMS の fields=id,publishedAt&orders=-publishedAt）。 */
export async function listLatestPublishedJobIds(count: number): Promise<Array<{ id: string; publishedAt: string }>> {
  const params = new URLSearchParams({ select: 'id,publishedAt', order: ORDER_PUBLISHED_DESC, limit: String(count) });
  const { rows } = await request('site_jobs', params, { mode: PREFLIGHT_FETCH });
  return rows.map((row) => toCmsJob(row) as unknown as { id: string; publishedAt: string });
}
