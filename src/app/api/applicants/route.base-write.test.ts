import { describe, expect, it } from 'vitest';
import { resolveDirectBaseWrite, type BaseWriteContext } from './route';

function mechanicContext(): BaseWriteContext {
  return {
    isMechanic: true,
    isMechanicNewgrad: false,
    isCoupang: false,
    mediaName: 'RIDE JOB Mechanic',
    utm: {},
    adId: '',
    adCreativeId: '',
    adImageUrl: '',
    form: {
      fullName: '整備 太郎',
      fullNameKana: 'セイビ タロウ',
      phoneNumber: '09012345678',
      email: 'mechanic@example.com',
      birthDate: '1990-01-01',
      postalCode: '1000001',
      prefectureName: '東京都',
      municipalityName: '千代田区',
      townName: '千代田',
      jobTiming: 'within_6_months',
      mechanicQualification: 'level2',
    },
    jobTimingLabel: '6か月以内',
    jobIntentLabel: '決まれば早く転職したい',
    desiredIncomeLabel: '600万円',
    mechanicQualificationsLabel: '自動車整備士2級',
    qualificationFieldLabel: '保有資格',
    pageUrl: 'https://example.com/mechanic',
    submittedAtMs: 1_700_000_000_000,
  } as BaseWriteContext;
}

describe('resolveDirectBaseWrite', () => {
  it('Mechanic応募の転職時期と資格を専用欄へ保存する', () => {
    const target = resolveDirectBaseWrite(mechanicContext());

    expect(target?.fields.転職時期).toBe('6か月以内');
    expect(target?.fields.資格).toBe('自動車整備士2級');
    expect(target?.fields.対応履歴メモ).toBe(
      '希望年収: 600万円 / 転職意向: 決まれば早く転職したい'
    );
  });
});
