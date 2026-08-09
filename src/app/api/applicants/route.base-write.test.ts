import { describe, expect, it } from 'vitest';
import { resolveDirectBaseWrite, type BaseWriteContext } from './route';

function mechanicContext(): BaseWriteContext {
  return {
    isMechanic: true,
    isMechanicNewgrad: false,
    isCoupang: false,
    isTruck: false,
    truckLicensesLabel: '',
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
    expect(target?.fields.対応履歴メモ).toBeUndefined();
  });

  it('Mechanic応募の希望年収を「履歴書（添付なし）」欄へ保存する', () => {
    const target = resolveDirectBaseWrite(mechanicContext());

    expect(target?.fields['履歴書（添付なし）']).toBe('希望年収: 600万円');
  });

  it('希望年収が未回答なら「履歴書（添付なし）」欄には書き込まない', () => {
    const target = resolveDirectBaseWrite({ ...mechanicContext(), desiredIncomeLabel: '未選択' });

    expect(target?.fields['履歴書（添付なし）']).toBeUndefined();
  });

  it('新卒フォームは希望年収を保存しない', () => {
    const target = resolveDirectBaseWrite({
      ...mechanicContext(),
      isMechanicNewgrad: true,
      desiredIncomeLabel: '',
    });

    expect(target?.fields['履歴書（添付なし）']).toBeUndefined();
  });
});

function truckContext(): BaseWriteContext {
  return {
    isMechanic: false,
    isMechanicNewgrad: false,
    isCoupang: false,
    isTruck: true,
    truckLicensesLabel: '中型免許（8t限定含む）、大型免許',
    mediaName: 'Meta広告',
    utm: {},
    adId: '',
    adCreativeId: '',
    adImageUrl: '',
    form: {
      fullName: '運送 太郎',
      fullNameKana: 'うんそう たろう',
      phoneNumber: '09012345678',
      email: 'truck@example.com',
      birthDate: '1990-01-01',
      postalCode: '5550001',
      prefectureName: '大阪府',
      municipalityName: '大阪市西淀川区',
      townName: '',
      jobTiming: 'asap',
      truckLicenses: ['medium', 'large'],
    },
    jobTimingLabel: '決まれば早く転職したい',
    jobIntentLabel: '',
    desiredIncomeLabel: '',
    mechanicQualificationsLabel: '未選択',
    qualificationFieldLabel: '保有資格',
    pageUrl: 'https://example.com/truck',
    submittedAtMs: 1_700_000_000_000,
  } as BaseWriteContext;
}

describe('resolveDirectBaseWrite (truck)', () => {
  it('トラック応募は求職者DB🚕へ、職種と保有免許を対応履歴メモに保存する', () => {
    const target = resolveDirectBaseWrite(truckContext());

    expect(target?.profile).toBe('ridejob');
    expect(target?.fields.対応履歴メモ).toBe(
      '登録職種: トラックドライバー / 転職時期: 決まれば早く転職したい / 保有免許: 中型免許（8t限定含む）、大型免許'
    );
  });

  it('保有免許が未選択ならメモには職種と転職時期のみ残す', () => {
    const target = resolveDirectBaseWrite({ ...truckContext(), truckLicensesLabel: '未選択' });

    expect(target?.fields.対応履歴メモ).toBe('登録職種: トラックドライバー / 転職時期: 決まれば早く転職したい');
  });

  it('タクシー(default)応募のメモは従来どおり転職時期のみ', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      isTruck: false,
      truckLicensesLabel: '',
    });

    expect(target?.profile).toBe('ridejob');
    expect(target?.fields.対応履歴メモ).toBe('転職時期: 決まれば早く転職したい');
  });
});
