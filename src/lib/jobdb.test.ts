import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchJobById,
  fetchMunicipalities,
  fetchPrefectures,
  getJobsByPrefectureId,
  getLatestJobsByCategoryId,
  getLatestJobsByCategoryIds,
  getRandomJobsByPrefectureIdsAndCategory,
  hasJobdbConfig,
  jobdbConfig,
  toCmsJob,
} from './jobdb';

// 試験用の偽の鍵（署名は無い）。role だけを見る
const fakeJwt = (role: string) =>
  `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;

type Call = { url: URL; init: RequestInit };
let calls: Call[];
let responder: (url: URL) => Response;

beforeEach(() => {
  vi.stubEnv('JOBDB_SUPABASE_URL', 'https://example-ref.supabase.co');
  vi.stubEnv('JOBDB_SUPABASE_ANON_KEY', fakeJwt('anon'));
  calls = [];
  responder = () => Response.json([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, init });
      return responder(url);
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('jobdbConfig', () => {
  it('anon の JWT と sb_publishable_ を受け付ける', () => {
    expect(jobdbConfig().restUrl).toBe('https://example-ref.supabase.co/rest/v1');
    vi.stubEnv('JOBDB_SUPABASE_ANON_KEY', 'sb_publishable_abc');
    expect(hasJobdbConfig()).toBe(true);
  });

  it('service_role・sb_secret_・形の違う鍵は使わない', () => {
    for (const key of [fakeJwt('service_role'), 'sb_secret_abc', 'not-a-key']) {
      vi.stubEnv('JOBDB_SUPABASE_ANON_KEY', key);
      expect(() => jobdbConfig()).toThrow(/public \(anon\) key/);
    }
  });

  it('URL が無い・https でない・余計な部分があるときは止める', () => {
    vi.stubEnv('JOBDB_SUPABASE_URL', '');
    expect(hasJobdbConfig()).toBe(false);
    for (const url of ['http://example-ref.supabase.co', 'https://u:p@example-ref.supabase.co', 'https://example-ref.supabase.co?x=1']) {
      vi.stubEnv('JOBDB_SUPABASE_URL', url);
      expect(() => jobdbConfig()).toThrow(/invalid/);
    }
  });
});

describe('toCmsJob', () => {
  it('CMS の形にする（文字の空は消す・参照の空は null・参照の中の参照は {id}・hideCompanyName は true のときだけ）', () => {
    const job = toCmsJob({
      id: 'a1',
      title: null,
      jobName: '求人',
      salaryMin: null,
      prefecture: { id: '13', region: '東京都', area: '関東', slug: null },
      municipality: { id: '655', name: '千代田区', prefecture: { id: '13', region: '東京都', area: '関東', slug: 'tokyo' } },
      jobCategory: null,
      tags: [{ id: '6', name: '日勤OK' }],
      images: [],
      hideCompanyName: null,
    });
    expect(job).toEqual({
      id: 'a1',
      jobName: '求人',
      prefecture: { id: '13', region: '東京都', area: '関東' },
      municipality: { id: '655', name: '千代田区', prefecture: { id: '13' } },
      jobCategory: null,
      tags: [{ id: '6', name: '日勤OK' }],
      images: [],
    });
    expect(toCmsJob({ id: 'a2', hideCompanyName: true })).toEqual({ id: 'a2', hideCompanyName: true });
    expect(toCmsJob({ id: 'a3', hideCompanyName: false })).toEqual({ id: 'a3' });
  });
});

describe('一覧の取り方', () => {
  it('getJobsByPrefectureId: 既定の10件・既定の並び・件数は Content-Range。職種は CMS と同じく効かない', async () => {
    responder = () =>
      new Response(JSON.stringify([{ id: 'j1', title: null }]), {
        headers: { 'content-range': '0-0/296', 'content-type': 'application/json' },
      });
    const res = await getJobsByPrefectureId('13', ['3', '10']);
    expect(res).toEqual({ contents: [{ id: 'j1' }], totalCount: 296, offset: 0, limit: 10 });
    const { url, init } = calls[0];
    expect(url.pathname).toBe('/rest/v1/site_jobs');
    expect(url.searchParams.get('prefectureId')).toBe('eq.13');
    expect(url.searchParams.get('order')).toBe('createdAt.desc,cmsRank.asc.nullslast,id.asc');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.has('jobCategoryId')).toBe(false);
    expect((init.headers as Record<string, string>).Prefer).toBe('count=exact');
    expect(init.next).toEqual({ revalidate: 60 });
  });

  it('件数が読めないときは失敗にする（0件と取り違えない）', async () => {
    responder = () => Response.json([]);
    await expect(getJobsByPrefectureId('13')).rejects.toThrow(/missing count/);
  });

  it('全件は1,000行ずつ分けて取る', async () => {
    responder = (url) => {
      const offset = Number(url.searchParams.get('offset'));
      const n = offset === 0 ? 1000 : 5;
      return new Response(
        JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: String(offset + i), name: 'x', prefecture: null }))),
        { headers: { 'content-range': `${offset}-${offset + n - 1}/1005` } },
      );
    };
    const rows = await fetchMunicipalities('13');
    expect(rows).toHaveLength(1005);
    expect(calls.map((c) => [c.url.searchParams.get('offset'), c.url.searchParams.get('limit')])).toEqual([
      ['0', '1000'],
      ['1000', '1000'],
    ]);
    expect(calls[0].url.searchParams.get('prefectureId')).toBe('eq.13');
    expect(calls[0].url.searchParams.get('order')).toBe('cmsRank.asc.nullslast,id.asc');
    expect(rows[0]).toEqual({ id: '0', name: 'x', prefecture: null });
  });

  it('サーバーの1回の上限が1,000行より小さくても、件数まで取り切る', async () => {
    responder = (url) => {
      const offset = Number(url.searchParams.get('offset'));
      const n = Math.min(500, 1200 - offset);
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: String(offset + i) }))), {
        headers: { 'content-range': `${offset}-${offset + n - 1}/1200` },
      });
    };
    expect(await fetchMunicipalities()).toHaveLength(1200);
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '500', '1000']);
  });

  it('-publishedAt は publishedAt の降順のあとに既定の並び', async () => {
    await getLatestJobsByCategoryId('6', 3);
    expect(calls[0].url.searchParams.get('order')).toBe('publishedAt.desc.nullslast,createdAt.desc,cmsRank.asc.nullslast,id.asc');
    expect(calls[0].url.searchParams.get('jobCategoryId')).toBe('eq.6');
    expect(calls[0].url.searchParams.get('limit')).toBe('3');
  });

  it('getLatestJobsByCategoryIds は CMS と同じく空（取りに行かない）', async () => {
    expect(await getLatestJobsByCategoryIds(['6', '5'], 3)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('都道府県×職種のランダム: ID だけを全件取り、選んだ分の中身を取る', async () => {
    responder = (url) =>
      url.searchParams.get('select') === 'id'
        ? new Response(JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]), {
            headers: { 'content-range': '0-3/4' },
          })
        : Response.json((url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').map((id) => ({ id })));
    const jobs = await getRandomJobsByPrefectureIdsAndCategory(['13', '14', '13'], '5', 3);
    expect(jobs).toHaveLength(3);
    expect(calls[0].url.searchParams.get('prefectureId')).toBe('in.(13,14)');
    expect(calls[0].url.searchParams.get('jobCategoryId')).toBe('eq.5');
    expect(new Set(jobs.map((j) => j.id)).size).toBe(3);
    await expect(getRandomJobsByPrefectureIdsAndCategory(['13)'], '5', 3)).rejects.toThrow(/invalid id/);
  });
});

describe('1件と失敗のとき', () => {
  it('fetchJobById: 毎回取りに行き、無ければ null', async () => {
    expect(await fetchJobById('nope')).toBeNull();
    expect(calls[0].url.searchParams.get('id')).toBe('eq.nope');
    expect(calls[0].init.cache).toBe('no-store');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('HTTP の失敗は投げる（応募の照合は 503 にできる）', async () => {
    responder = () => new Response('x', { status: 503, statusText: 'Service Unavailable' });
    await expect(fetchJobById('a')).rejects.toThrow(/job-db API error: 503/);
  });

  it('都道府県は予備の表・市区町村は空（CMS と同じ）', async () => {
    responder = () => new Response('x', { status: 500 });
    expect(await fetchPrefectures()).toHaveLength(47);
    expect(await fetchMunicipalities('13')).toEqual([]);
  });

  it('接続設定が無ければ取りに行かない', async () => {
    vi.stubEnv('JOBDB_SUPABASE_ANON_KEY', '');
    await expect(fetchJobById('a')).rejects.toThrow(/not set/);
    await expect(getLatestJobsByCategoryIds(['6'], 3)).rejects.toThrow(/not set/);
    expect(calls).toHaveLength(0);
  });
});
