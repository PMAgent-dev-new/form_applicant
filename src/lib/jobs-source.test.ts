import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMunicipalities, jobsReadSource } from './jobs-source';
import { loadJob } from './scout/sources';

const fakeAnon = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.y`;
let hosts: string[];

beforeEach(() => {
  vi.stubEnv('JOBDB_SUPABASE_URL', 'https://example-ref.supabase.co');
  vi.stubEnv('JOBDB_SUPABASE_ANON_KEY', fakeAnon);
  hosts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      hosts.push(new URL(input).hostname);
      return Response.json([]);
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JOBS_READ_SOURCE', () => {
  it('既定と microcms は CMS、jobdb は job-db、ほかの値は CMS のまま', () => {
    vi.stubEnv('JOBS_READ_SOURCE', '');
    expect(jobsReadSource()).toBe('microcms');
    vi.stubEnv('JOBS_READ_SOURCE', 'microcms');
    expect(jobsReadSource()).toBe('microcms');
    vi.stubEnv('JOBS_READ_SOURCE', ' JobDB ');
    expect(jobsReadSource()).toBe('jobdb');
    vi.stubEnv('JOBS_READ_SOURCE', 'job-db');
    expect(jobsReadSource()).toBe('microcms');
  });

  it('jobdb のときは job-db だけを読む（CMS には行かない）', async () => {
    vi.stubEnv('JOBS_READ_SOURCE', 'jobdb');
    await fetchMunicipalities('13');
    expect(hosts).toEqual(['example-ref.supabase.co']);
  });
});

describe('スカウトの求人1件（jobdb）', () => {
  it('公開中で無ければ 409・接続設定が無ければ設定の案内', async () => {
    vi.stubEnv('JOBS_READ_SOURCE', 'jobdb');
    await expect(loadJob('abc')).rejects.toMatchObject({ code: '公開中の求人を確認できません', status: 409 });
    vi.stubEnv('JOBDB_SUPABASE_ANON_KEY', '');
    await expect(loadJob('abc')).rejects.toMatchObject({ code: '求人への接続設定が必要です' });
    expect(hosts).toEqual(['example-ref.supabase.co']);
  });

  it('CMS と同じ項目で組み立てる', async () => {
    vi.stubEnv('JOBS_READ_SOURCE', 'jobdb');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([
          {
            id: 'abc',
            title: null,
            jobName: 'タクシー乗務員',
            companyName: '公開企業',
            hideCompanyName: null,
            addressPrefMuni: '東京都千代田区',
            prefecture: { id: '13', region: '東京都', area: '関東', slug: 'tokyo' },
            jobCategory: { id: '6', name: 'タクシードライバー', category: ['ドライバー職'], slug: 'taxi-driver' },
            descriptionWork: '乗務',
            descriptionPerson: '二種免許',
            publishedAt: '2026-11-26T01:00:17.079Z',
            updatedAt: '2026-11-26T01:00:17.079Z',
          },
        ]),
      ),
    );
    expect(await loadJob('abc')).toEqual({
      id: 'abc',
      title: 'タクシー乗務員',
      company: '公開企業',
      region: '東京都千代田区',
      url: 'https://ridejob.jp/job/abc',
      updatedAt: '2026-11-26T01:00:17.079Z',
      category: 'タクシードライバー',
      work: '乗務',
      requirements: '二種免許',
    });
  });
});
