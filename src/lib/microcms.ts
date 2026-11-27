// microCMS API client
import { FALLBACK_PREFECTURES } from './prefecture-fallback';

const SERVICE_DOMAIN = process.env.MICROCMS_SERVICE_DOMAIN;
const API_KEY = process.env.MICROCMS_API_KEY;
const BASE_URL = SERVICE_DOMAIN ? `https://${SERVICE_DOMAIN}.microcms.io/api/v1` : '';
const hasMicrocmsEnv = Boolean(SERVICE_DOMAIN && API_KEY);

// 読み先が job-db のとき（JOBS_READ_SOURCE=jobdb）は CMS を読まないので、設定が無くても警告しない
if (!hasMicrocmsEnv && process.env.JOBS_READ_SOURCE?.trim().toLowerCase() !== 'jobdb') {
  console.warn('microCMS environment variables are not set. Falling back to static data where available.');
}

export interface MicroCMSListResponse<T> {
  contents: T[];
  totalCount: number;
  offset: number;
  limit: number;
}

export interface PrefectureEntry {
  id: string;
  region: string;
  area: string;
}

export interface MunicipalityEntry {
  id: string;
  name: string;
  prefecture: {
    id: string;
    region: string;
  };
}

const DEFAULT_LIMIT = 100;

async function fetchFromMicroCMS<T>(endpoint: string, searchParams?: URLSearchParams): Promise<MicroCMSListResponse<T>> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }

  const url = new URL(`${BASE_URL}/${endpoint}`);
  if (searchParams) {
    url.search = searchParams.toString();
  }

  const response = await fetch(url.toString(), {
    headers: {
      'X-MICROCMS-API-KEY': API_KEY!,
    },
    // Next.js fetch caching options。必要に応じて再検討
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`microCMS API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/** 公開済みコンテンツをIDで1件取得する。存在しない場合はnull。 */
export async function fetchJobById(jobId: string): Promise<Job | null> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const url = new URL(`${BASE_URL}/jobs/${encodeURIComponent(jobId)}`);
  url.searchParams.set('depth', '1');
  const response = await fetch(url.toString(), {
    headers: { 'X-MICROCMS-API-KEY': API_KEY! },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`microCMS API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<Job>;
}

async function fetchAllFromMicroCMS<T>(endpoint: string, baseParams?: URLSearchParams): Promise<T[]> {
  const results: T[] = [];
  const baseParamsString = baseParams ? baseParams.toString() : undefined;
  let offset = 0;

  while (true) {
    const params = new URLSearchParams(baseParamsString);
    params.set('limit', DEFAULT_LIMIT.toString());
    params.set('offset', offset.toString());

    const data = await fetchFromMicroCMS<T>(endpoint, params);
    if (data.contents.length === 0) {
      break;
    }

    results.push(...data.contents);
    offset += data.contents.length;

    if (offset >= data.totalCount) {
      break;
    }
  }

  return results;
}

export async function fetchPrefectures(): Promise<PrefectureEntry[]> {
  try {
    return await fetchAllFromMicroCMS<PrefectureEntry>('prefectures');
  } catch (error) {
    console.warn('Failed to fetch prefectures from microCMS. Using fallback data.', error);
    return FALLBACK_PREFECTURES;
  }
}

export async function fetchMunicipalities(prefectureId?: string): Promise<MunicipalityEntry[]> {
  try {
    const params = prefectureId ? new URLSearchParams({ filters: `prefecture[equals]${prefectureId}` }) : undefined;
    return await fetchAllFromMicroCMS<MunicipalityEntry>('municipalities', params);
  } catch (error) {
    console.warn('Failed to fetch municipalities from microCMS. Returning empty list.', error);
    return [];
  }
}

export async function fetchPrefectureById(prefectureId: string): Promise<PrefectureEntry | null> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const params = new URLSearchParams({ filters: `id[equals]${prefectureId}`, limit: '1' });
  const data = await fetchFromMicroCMS<PrefectureEntry>('prefectures', params);
  return data.contents[0] ?? null;
}

export async function fetchMunicipalityById(municipalityId: string): Promise<MunicipalityEntry | null> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const params = new URLSearchParams({ filters: `id[equals]${municipalityId}`, limit: '1' });
  const data = await fetchFromMicroCMS<MunicipalityEntry>('municipalities', params);
  return data.contents[0] ?? null;
}

export interface MediaImage {
  url: string;
  height: number;
  width: number;
}

export interface Job {
  id: string;
  title?: string;
  prefecture?: {
    id: string;
    region: string;
    area: string;
  };
  municipality?: {
    id: string;
    name: string;
    prefecture: {
      id: string;
      region: string;
      area: string;
    };
  };
  jobCategory?: {
    id: string;
    name: string;
    category: string;
  };
  companyName?: string;
  jobName?: string;
  catchCopy?: string;
  addressZip?: string;
  addressPrefMuni?: string;
  addressLine?: string;
  addressBuilding?: string;
  employmentType?: string;
  wageType?: string;
  salaryMin?: number;
  salaryMax?: number;
  images?: MediaImage[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  revisedAt: string;
}

export type JobsResponse = MicroCMSListResponse<Job>;

function buildJobCategoryFilter(categoryIds?: string[]): string | undefined {
  if (!categoryIds || categoryIds.length === 0) {
    return undefined;
  }
  const ids = categoryIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    return undefined;
  }
  return `jobCategory[in]${ids.join(',')}`;
}

function buildFilters(filters: Array<string | undefined>): string | undefined {
  const parts = filters.filter((value): value is string => Boolean(value && value.trim().length > 0));
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join('[and]');
}

export async function getPrefectureByRegion(regionName: string): Promise<PrefectureEntry | null> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const params = new URLSearchParams({ filters: `region[equals]${regionName}` });
  const data = await fetchFromMicroCMS<PrefectureEntry>('prefectures', params);
  return data.contents[0] ?? null;
}

export async function getJobsByPrefectureId(prefectureId: string, jobCategoryIds?: string[]): Promise<JobsResponse> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const filters = buildFilters([`prefecture[equals]${prefectureId}`, buildJobCategoryFilter(jobCategoryIds)]);
  const params = filters ? new URLSearchParams({ filters }) : undefined;
  return fetchFromMicroCMS<Job>('jobs', params);
}

export async function getJobCountByPrefecture(prefectureName: string, jobCategoryIds?: string[]): Promise<number> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const prefecture = await getPrefectureByRegion(prefectureName);
  if (!prefecture) {
    return 0;
  }
  const response = await getJobsByPrefectureId(prefecture.id, jobCategoryIds);
  return response.totalCount;
}

export async function getJobsByMunicipalityId(municipalityId: string, jobCategoryIds?: string[]): Promise<JobsResponse> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const filters = buildFilters([`municipality[equals]${municipalityId}`, buildJobCategoryFilter(jobCategoryIds)]);
  const params = filters ? new URLSearchParams({ filters }) : undefined;
  return fetchFromMicroCMS<Job>('jobs', params);
}

export async function getJobCountByMunicipality(municipalityId: string): Promise<number> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const response = await getJobsByMunicipalityId(municipalityId);
  return response.totalCount;
}

export async function getRandomJobsByPrefectureId(prefectureId: string, count: number = 3): Promise<Job[]> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const response = await getJobsByPrefectureId(prefectureId);
  if (response.contents.length === 0) {
    return [];
  }
  
  // シャッフルしてランダムに取得
  const shuffled = [...response.contents].sort(() => Math.random() - 0.5);
  
  // 指定件数または利用可能な求人数の少ない方を返す
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export async function getRandomJobsByPrefectureIdsAndCategory(
  prefectureIds: string[],
  categoryId: string,
  count: number = 3
): Promise<Job[]> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const ids = prefectureIds.map((id) => id.trim()).filter(Boolean);
  const trimmedCategoryId = categoryId.trim();
  if (ids.length === 0 || !trimmedCategoryId) {
    return [];
  }

  // microCMS の reference field では [in] が使えないため、都道府県ごとに
  // AND フィルタで取得してマージする
  const results = await Promise.all(
    ids.map(async (prefectureId) => {
      const filters = buildFilters([
        `prefecture[equals]${prefectureId}`,
        `jobCategory[equals]${trimmedCategoryId}`,
      ]);
      if (!filters) return [] as Job[];
      const params = new URLSearchParams({ filters });
      return fetchAllFromMicroCMS<Job>('jobs', params);
    })
  );

  const merged = results.flat();
  if (merged.length === 0) {
    return [];
  }

  // id で重複除去
  const unique = Array.from(new Map(merged.map((job) => [job.id, job])).values());
  const shuffled = unique.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export async function getLatestJobsByCategoryId(categoryId: string, count: number = 3): Promise<Job[]> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const params = new URLSearchParams({
    filters: `jobCategory[equals]${categoryId}`,
    orders: '-publishedAt',
    limit: count.toString(),
  });
  const response = await fetchFromMicroCMS<Job>('jobs', params);
  return response.contents;
}

export async function getLatestJobsByCategoryIds(categoryIds: string[], count: number = 3): Promise<Job[]> {
  if (!hasMicrocmsEnv) {
    throw new Error('microCMS environment variables are not set');
  }
  const filter = buildJobCategoryFilter(categoryIds);
  if (!filter) {
    return [];
  }
  const params = new URLSearchParams({
    filters: filter,
    orders: '-publishedAt',
    limit: count.toString(),
  });
  const response = await fetchFromMicroCMS<Job>('jobs', params);
  return response.contents;
}
