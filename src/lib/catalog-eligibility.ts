import type { Job } from './microcms';

export type CatalogCategory = 'taxi' | 'hire' | 'dispatch' | 'mechanic' | 'other';

function classifyText(value: string): CatalogCategory {
  if (/ハイヤー/.test(value)) return 'hire';
  if (/運行管理|配車(係|オペレーター|担当)/.test(value)) return 'dispatch';
  if (/自動車整備士|バイク整備士|整備士|メカニック|板金|フロントスタッフ|サービス(エンジニア|スタッフ)/.test(value)) {
    return 'mechanic';
  }
  if (/タクシー\s*(ドライバー|乗務員|運転手)|乗務員/.test(value)) return 'taxi';
  return 'other';
}

function classifyTitle(value: string): CatalogCategory {
  const title = String(value || '').trim();
  if (!title) return 'other';
  if (/営業マネージャー|営業スタッフ|法人営業|人材営業|拠点長候補/.test(title)) return 'other';
  return classifyText(title);
}

/** jobmadleyのカタログ生成と同じ規則で、公開求人がカタログ対象か再検証する。 */
export function classifyCatalogJob(job: Pick<Job, 'title' | 'jobName' | 'jobCategory'>): CatalogCategory {
  const sourceCategory = String(job.jobCategory?.name ?? '').trim();
  const category = classifyText(sourceCategory);
  if (category !== 'other') return category;
  if (sourceCategory && sourceCategory !== '営業') return 'other';
  return classifyTitle(job.jobName ?? job.title ?? '');
}

export const isMetaCatalogJob = (job: Pick<Job, 'title' | 'jobName' | 'jobCategory'>): boolean =>
  classifyCatalogJob(job) !== 'other';
