import { describe, expect, test } from 'vitest';
import { assessCatalogTouch } from './catalog-attribution';

const NOW = Date.parse('2026-09-17T00:00:00.000Z');

describe('catalog attribution validation', () => {
  test('same URL job_id is same_job', () => {
    expect(assessCatalogTouch({
      catalogJobId: 'job-1',
      appliedJobId: 'job-1',
      catalogClickedAt: '2026-09-16T23:00:00.000Z',
      catalogSource: 'fb',
      catalogMedium: 'ad',
      catalogEvidence: 'utm',
    }, NOW).status).toBe('same_job');
  });

  test('different job_id is changed_job', () => {
    expect(assessCatalogTouch({
      catalogJobId: 'job-1',
      appliedJobId: 'job-2',
      catalogClickedAt: '2026-09-16T23:00:00.000Z',
      catalogEvidence: 'fbclid',
      fbclid: 'fb-click-1',
    }, NOW).status).toBe('changed_job');
  });

  test('missing applied job id is reported separately', () => {
    expect(assessCatalogTouch({
      catalogJobId: 'job-1',
      catalogClickedAt: '2026-09-16T23:00:00.000Z',
      catalogEvidence: 'fbclid',
      fbclid: 'fb-click-1',
    }, NOW).status).toBe('applied_job_missing');
  });

  test('legacy Meta catalog links use utm_content and the original touch time', () => {
    expect(assessCatalogTouch({
      appliedJobId: 'job-legacy',
      utmSource: 'meta',
      utmMedium: 'catalog',
      utmContent: 'job-legacy',
      utmLastTouchAt: '2026-09-16T23:00:00.000Z',
    }, NOW)).toMatchObject({
      status: 'same_job',
      jobId: 'job-legacy',
      clickedAtMillis: Date.parse('2026-09-16T23:00:00.000Z'),
    });
  });

  test('does not classify a regular Meta ad from the word catalog in its ad name', () => {
    expect(assessCatalogTouch({
      appliedJobId: 'job-1',
      utmSource: 'meta',
      utmMedium: 'ad',
      utmContent: 'catalog-creative-A',
      utmLastTouchAt: '2026-09-16T23:00:00.000Z',
    }, NOW)).toEqual({});
  });

  test('rejects future time and non-Meta evidence', () => {
    expect(assessCatalogTouch({
      catalogJobId: 'job-1',
      appliedJobId: 'job-1',
      catalogClickedAt: '2026-09-18T00:00:00.000Z',
      catalogEvidence: 'fbclid',
      fbclid: 'fb-click-1',
    }, NOW).status).toBe('invalid');
    expect(assessCatalogTouch({
      catalogJobId: 'job-1',
      appliedJobId: 'job-1',
      catalogClickedAt: '2026-09-16T00:00:00.000Z',
      catalogSource: 'google',
      catalogMedium: 'cpc',
      catalogEvidence: 'utm',
    }, NOW).status).toBe('invalid');
  });

  test('fbclid証拠の自己申告だけでは有効にしない', () => {
    expect(assessCatalogTouch({
      catalogJobId: 'job-1',
      appliedJobId: 'job-1',
      catalogClickedAt: '2026-09-16T23:00:00.000Z',
      catalogEvidence: 'fbclid',
    }, NOW).status).toBe('invalid');
  });
});
