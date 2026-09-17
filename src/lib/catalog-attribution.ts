export type CatalogAttributionStatus =
  | 'same_job'
  | 'changed_job'
  | 'missing'
  | 'applied_job_missing'
  | 'stale'
  | 'invalid';

export type CatalogTouchInput = {
  catalogJobId?: string;
  catalogClickedAt?: string;
  catalogSource?: string;
  catalogMedium?: string;
  catalogEvidence?: 'utm' | 'fbclid';
  fbclid?: string;
  appliedJobId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmContent?: string;
  utmLastTouchAt?: string;
};

export type CatalogTouchAssessment = {
  status?: CatalogAttributionStatus;
  jobId?: string;
  clickedAtMillis?: number;
};

const META_SOURCES = new Set(['meta', 'facebook', 'fb', 'instagram', 'ig', 'msg', 'an', 'th']);
const META_PAID_MEDIUMS = new Set(['catalog', 'ad', 'cpc', 'paid_social', 'paid-social']);
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FBCLID = /^[A-Za-z0-9._-]{1,512}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTRIBUTION_WINDOW_MS = 7 * DAY_MS;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const norm = (value: string | undefined): string => value?.trim().toLowerCase() || '';

export const looksLikeMetaCatalogTraffic = (input: CatalogTouchInput): boolean => {
  const source = norm(input.utmSource);
  const medium = norm(input.utmMedium);
  // 広告名(utm_content)にcatalogという語が含まれるだけでは、通常広告と区別できない。
  return META_SOURCES.has(source) && medium === 'catalog';
};

/** 直接フォームのカタログ接触を検証し、同一URLのjob_idとの一致を判定する。 */
export const assessCatalogTouch = (
  input: CatalogTouchInput,
  now = Date.now(),
): CatalogTouchAssessment => {
  const legacyCatalogJobId = looksLikeMetaCatalogTraffic(input)
    ? input.appliedJobId?.trim()
    : undefined;
  const jobId = input.catalogJobId?.trim() || legacyCatalogJobId;
  if (!jobId) return looksLikeMetaCatalogTraffic(input) ? { status: 'missing' } : {};
  if (!JOB_ID.test(jobId)) return { status: 'invalid' };
  const source = norm(input.catalogSource);
  const medium = norm(input.catalogMedium);
  const evidence = input.catalogEvidence;
  const validEvidence = Boolean(legacyCatalogJobId)
    || (evidence === 'fbclid' && FBCLID.test(input.fbclid?.trim() || ''))
    || (META_SOURCES.has(source) && META_PAID_MEDIUMS.has(medium));
  if (!validEvidence) return { status: 'invalid', jobId };
  const clickedAtMillis = Date.parse(input.catalogClickedAt || input.utmLastTouchAt || '');
  if (!Number.isFinite(clickedAtMillis)) return { status: 'invalid', jobId };
  const age = now - clickedAtMillis;
  if (age < -CLOCK_SKEW_MS) return { status: 'invalid', jobId, clickedAtMillis };
  if (age >= ATTRIBUTION_WINDOW_MS) return { status: 'stale', jobId, clickedAtMillis };
  const applied = input.appliedJobId?.trim();
  return {
    status: !applied ? 'applied_job_missing' : applied === jobId ? 'same_job' : 'changed_job',
    jobId,
    clickedAtMillis,
  };
};
