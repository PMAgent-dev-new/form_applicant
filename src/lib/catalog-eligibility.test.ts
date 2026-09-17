import { describe, expect, test } from 'vitest';

import { classifyCatalogJob, isMetaCatalogJob } from './catalog-eligibility';

describe('Meta catalog eligibility', () => {
  test('accepts catalog occupations from the source category', () => {
    expect(classifyCatalogJob({ jobCategory: { id: '1', name: '自動車整備士', category: 'mechanic' } })).toBe('mechanic');
    expect(isMetaCatalogJob({ jobCategory: { id: '2', name: 'タクシードライバー', category: 'taxi' } })).toBe(true);
  });

  test('rejects non-catalog jobs and mechanic words used only as a sales target', () => {
    expect(isMetaCatalogJob({ jobCategory: { id: '3', name: '営業', category: 'sales' }, title: '整備士人材の法人営業' })).toBe(false);
    expect(isMetaCatalogJob({ jobCategory: { id: '4', name: '事務', category: 'office' }, title: '一般事務' })).toBe(false);
  });
});
