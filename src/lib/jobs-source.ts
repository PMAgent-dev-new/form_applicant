// 求人・マスタの読み先を環境変数 JOBS_READ_SOURCE で切り替える。
//   microcms（既定）: 求人CMS（microcms.ts）
//   jobdb          : job-db（Supabase）の公開ビュー（jobdb.ts）
// どちらも同じ引数・同じ戻り値（CMS の応答の形）。戻すときは microcms にして再デプロイする。
// job-db が失敗しても CMS には自動で逃がさない（CMS を止める前提の切り替えのため。jobdb.ts の取得の失敗は
// 今の CMS の失敗と同じ扱いになる: 都道府県は予備の表・市区町村は空・ほかは呼ぶ側の 5xx）。

import * as cms from './microcms';
import * as jobdb from './jobdb';

export type { Job, JobsResponse, MediaImage, MunicipalityEntry, PrefectureEntry } from './microcms';

export type JobsReadSource = 'microcms' | 'jobdb';

let warnedUnknown = false;

export function jobsReadSource(): JobsReadSource {
  const raw = process.env.JOBS_READ_SOURCE?.trim().toLowerCase();
  if (!raw || raw === 'microcms') return 'microcms';
  if (raw === 'jobdb') return 'jobdb';
  if (!warnedUnknown) {
    warnedUnknown = true;
    console.error('JOBS_READ_SOURCE is not microcms or jobdb. Reading from microCMS.');
  }
  return 'microcms';
}

const readsJobdb = () => jobsReadSource() === 'jobdb';

export const fetchJobById: typeof cms.fetchJobById = (jobId) =>
  readsJobdb() ? jobdb.fetchJobById(jobId) : cms.fetchJobById(jobId);

export const fetchPrefectures: typeof cms.fetchPrefectures = () =>
  readsJobdb() ? jobdb.fetchPrefectures() : cms.fetchPrefectures();

export const fetchMunicipalities: typeof cms.fetchMunicipalities = (prefectureId) =>
  readsJobdb() ? jobdb.fetchMunicipalities(prefectureId) : cms.fetchMunicipalities(prefectureId);

export const fetchPrefectureById: typeof cms.fetchPrefectureById = (prefectureId) =>
  readsJobdb() ? jobdb.fetchPrefectureById(prefectureId) : cms.fetchPrefectureById(prefectureId);

export const fetchMunicipalityById: typeof cms.fetchMunicipalityById = (municipalityId) =>
  readsJobdb() ? jobdb.fetchMunicipalityById(municipalityId) : cms.fetchMunicipalityById(municipalityId);

export const getPrefectureByRegion: typeof cms.getPrefectureByRegion = (regionName) =>
  readsJobdb() ? jobdb.getPrefectureByRegion(regionName) : cms.getPrefectureByRegion(regionName);

export const getJobsByPrefectureId: typeof cms.getJobsByPrefectureId = (prefectureId, jobCategoryIds) =>
  readsJobdb() ? jobdb.getJobsByPrefectureId(prefectureId, jobCategoryIds) : cms.getJobsByPrefectureId(prefectureId, jobCategoryIds);

export const getRandomJobsByPrefectureId: typeof cms.getRandomJobsByPrefectureId = (prefectureId, count) =>
  readsJobdb() ? jobdb.getRandomJobsByPrefectureId(prefectureId, count) : cms.getRandomJobsByPrefectureId(prefectureId, count);

export const getRandomJobsByPrefectureIdsAndCategory: typeof cms.getRandomJobsByPrefectureIdsAndCategory = (
  prefectureIds,
  categoryId,
  count,
) =>
  readsJobdb()
    ? jobdb.getRandomJobsByPrefectureIdsAndCategory(prefectureIds, categoryId, count)
    : cms.getRandomJobsByPrefectureIdsAndCategory(prefectureIds, categoryId, count);

export const getLatestJobsByCategoryId: typeof cms.getLatestJobsByCategoryId = (categoryId, count) =>
  readsJobdb() ? jobdb.getLatestJobsByCategoryId(categoryId, count) : cms.getLatestJobsByCategoryId(categoryId, count);

export const getLatestJobsByCategoryIds: typeof cms.getLatestJobsByCategoryIds = (categoryIds, count) =>
  readsJobdb() ? jobdb.getLatestJobsByCategoryIds(categoryIds, count) : cms.getLatestJobsByCategoryIds(categoryIds, count);
