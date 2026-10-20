import type { FormData, FormOrigin } from '../types';

const DEFAULT_LABEL_MAP: Record<Exclude<FormData['jobTiming'], ''>, string> = {
  asap: '決まれば早く転職したい',
  no_plan: 'すぐに転職する気はない',
  browse_only: '求人だけ見たい',
  within_3_months: '3か月以内',
  within_6_months: '6か月以内',
  within_1_year: '1年以内',
};

const MECHANIC_LABEL_MAP: Record<Exclude<FormData['jobTiming'], ''>, string> = {
  asap: 'なるべく早く',
  no_plan: 'すぐに転職する気はない',
  browse_only: '求人だけ見たい',
  within_3_months: '3か月以内',
  within_6_months: '6か月以内',
  within_1_year: '1年以内',
};

export function mapJobTimingLabel(jobTiming: FormData['jobTiming'], formOrigin?: FormOrigin) {
  if (!jobTiming) return '';
  const labelMap = formOrigin === 'mechanic' || formOrigin === 'mechanic_newgrad' ? MECHANIC_LABEL_MAP : DEFAULT_LABEL_MAP;
  return labelMap[jobTiming] ?? '';
}
