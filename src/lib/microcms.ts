// microCMS API client
const SERVICE_DOMAIN = process.env.MICROCMS_SERVICE_DOMAIN;
const API_KEY = process.env.MICROCMS_API_KEY;
const BASE_URL = SERVICE_DOMAIN ? `https://${SERVICE_DOMAIN}.microcms.io/api/v1` : '';
const hasMicrocmsEnv = Boolean(SERVICE_DOMAIN && API_KEY);

if (!hasMicrocmsEnv) {
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

const FALLBACK_PREFECTURES: PrefectureEntry[] = [
  { id: '01', region: '北海道', area: '' },
  { id: '02', region: '青森県', area: '' },
  { id: '03', region: '岩手県', area: '' },
  { id: '04', region: '宮城県', area: '' },
  { id: '05', region: '秋田県', area: '' },
  { id: '06', region: '山形県', area: '' },
  { id: '07', region: '福島県', area: '' },
  { id: '08', region: '茨城県', area: '' },
  { id: '09', region: '栃木県', area: '' },
  { id: '10', region: '群馬県', area: '' },
  { id: '11', region: '埼玉県', area: '' },
  { id: '12', region: '千葉県', area: '' },
  { id: '13', region: '東京都', area: '' },
  { id: '14', region: '神奈川県', area: '' },
  { id: '15', region: '新潟県', area: '' },
  { id: '16', region: '富山県', area: '' },
  { id: '17', region: '石川県', area: '' },
  { id: '18', region: '福井県', area: '' },
  { id: '19', region: '山梨県', area: '' },
  { id: '20', region: '長野県', area: '' },
  { id: '21', region: '岐阜県', area: '' },
  { id: '22', region: '静岡県', area: '' },
  { id: '23', region: '愛知県', area: '' },
  { id: '24', region: '三重県', area: '' },
  { id: '25', region: '滋賀県', area: '' },
  { id: '26', region: '京都府', area: '' },
  { id: '27', region: '大阪府', area: '' },
  { id: '28', region: '兵庫県', area: '' },
  { id: '29', region: '奈良県', area: '' },
  { id: '30', region: '和歌山県', area: '' },
  { id: '31', region: '鳥取県', area: '' },
  { id: '32', region: '島根県', area: '' },
  { id: '33', region: '岡山県', area: '' },
  { id: '34', region: '広島県', area: '' },
  { id: '35', region: '山口県', area: '' },
  { id: '36', region: '徳島県', area: '' },
  { id: '37', region: '香川県', area: '' },
  { id: '38', region: '愛媛県', area: '' },
  { id: '39', region: '高知県', area: '' },
  { id: '40', region: '福岡県', area: '' },
  { id: '41', region: '佐賀県', area: '' },
  { id: '42', region: '長崎県', area: '' },
  { id: '43', region: '熊本県', area: '' },
  { id: '44', region: '大分県', area: '' },
  { id: '45', region: '宮崎県', area: '' },
  { id: '46', region: '鹿児島県', area: '' },
  { id: '47', region: '沖縄県', area: '' },
];
