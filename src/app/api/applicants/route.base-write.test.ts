import { describe, expect, it } from 'vitest';
import { appendLarkNotificationMarker, resolveDirectBaseWrite, type BaseWriteContext } from './route';

function mechanicContext(): BaseWriteContext {
  return {
    isMechanic: true,
    isMechanicNewgrad: false,
    isCoupang: false,
    isTruck: false,
    isBus: false,
    isTaxi: false,
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
  it('担当者が追記したメモを保持して通知済み印を追加する', () => {
    expect(appendLarkNotificationMarker('[submission_id:submission-1]\n電話済み', 'submission-1'))
      .toBe('[submission_id:submission-1]\n電話済み\n[lark_notified:submission-1]');
  });

  it('カタログで見た求人と実際の応募求人を専用欄へ保存する', () => {
    const target = resolveDirectBaseWrite({
      ...mechanicContext(),
      submissionId: 'submission-1',
      appliedJobId: 'job-1',
      catalogJobId: 'job-1',
      catalogJobName: '自動車整備士（正社員）',
      catalogClickedAtMillis: 1_700_000_000_000,
      catalogAttributionStatus: 'same_job',
    });

    expect(target?.fields).toMatchObject({
      submission_id: 'submission-1',
      応募求人ID: 'job-1',
      広告クリック求人ID: 'job-1',
      広告クリック求人名: '自動車整備士（正社員）',
      カタログクリック日時: 1_700_000_000_000,
      カタログ求人一致判定: 'same_job',
    });
  });

  it('Mechanic応募の転職時期と資格を専用欄へ保存する', () => {
    const target = resolveDirectBaseWrite(mechanicContext());

    expect(target?.fields.転職時期).toBe('6か月以内');
    // Base の「資格」は MultiSelect。文字列で渡すと code=1254063 MultiSelectFieldConvFail で
    // 直書きがレコードごと落ち、冪等キーの無い Webhook 経路へ落ちて重複の温床になる
    // （2026-09-24 に /entry/mechanic で実測）。配列であることをここで固定する。
    expect(target?.fields.資格).toEqual(['自動車整備士2級']);
    expect(target?.fields.対応履歴メモ).toBeUndefined();
  });

  it('資格が未選択なら「資格」欄へ書き込まない（空の選択肢を作らない）', () => {
    const ctx = mechanicContext();
    ctx.mechanicQualificationsLabel = '未選択';
    expect(resolveDirectBaseWrite(ctx)?.fields.資格).toBeUndefined();
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
    isBus: false,
    isTaxi: false,
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
  it('RIDE JOB Baseでは既存メモ列に求人帰属とsubmission_idを保存する', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      submissionId: 'submission-ridejob-1',
      appliedJobId: 'job-2',
      catalogJobId: 'job-1',
      catalogJobName: 'タクシードライバー',
      catalogClickedAtMillis: Date.parse('2026-09-17T00:00:00.000Z'),
      catalogAttributionStatus: 'changed_job',
    });

    expect(target?.fields.submission_id).toBeUndefined();
    expect(target?.fields.対応履歴メモ).toContain('[submission_id:submission-ridejob-1]');
    expect(target?.fields.対応履歴メモ).toContain('広告クリック求人ID: job-1');
    expect(target?.fields.対応履歴メモ).toContain('広告クリック求人名: タクシードライバー');
    expect(target?.fields.対応履歴メモ).toContain('応募求人ID: job-2');
  });

  // 求職者DB🚕 に「登録職種」列は存在せず、職種は関連フィールド「マスタ-応募職種」で持つ。
  it('トラック応募は職種と保有免許を専用欄へ、転職時期を対応履歴メモへ保存する', () => {
    const target = resolveDirectBaseWrite(truckContext());

    expect(target?.profile).toBe('ridejob');
    expect(target?.fields['マスタ-応募職種']).toEqual({ linkedRecordName: 'トラックドライバー' });
    expect(target?.fields.保有資格).toEqual(['中型免許', '大型免許']);
    expect(target?.fields.対応履歴メモ).toBe('転職時期: 決まれば早く転職したい');
  });

  // Base の「保有資格」は MultiSelect のため、未登録の値を送ると選択肢が新規作成されてしまう。
  it('保有免許はBaseの既存選択肢名へ変換して書き込む', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      form: { ...truckContext().form, truckLicenses: ['semi_medium', 'regular_at'] },
    });

    expect(target?.fields.保有資格).toEqual(['準中型免許', '普通免許（AT限定）']);
  });

  it('「免許なし」だけの回答は保有資格欄へ書き込まない', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      truckLicensesLabel: '免許なし',
      form: { ...truckContext().form, truckLicenses: ['none'] },
    });

    expect(target?.fields['マスタ-応募職種']).toEqual({ linkedRecordName: 'トラックドライバー' });
    expect(target?.fields.保有資格).toBeUndefined();
    expect(target?.fields.対応履歴メモ).toBe('転職時期: 決まれば早く転職したい');
  });

  it('バス応募はバスドライバーへ紐付け、保有資格は書き込まない', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      isTruck: false,
      isBus: true,
      truckLicensesLabel: '',
      form: { ...truckContext().form, truckLicenses: [] },
    });

    expect(target?.profile).toBe('ridejob');
    expect(target?.fields['マスタ-応募職種']).toEqual({ linkedRecordName: 'バスドライバー' });
    expect(target?.fields.保有資格).toBeUndefined();
  });

  // formOrigin を明示してこない応募はタクシーLPとは限らないので、職種を紐付けない（isTaxi=false）。
  it('formOrigin未指定(isTaxi=false)の応募は職種を紐付けない', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      isTruck: false,
      truckLicensesLabel: '',
    });

    expect(target?.profile).toBe('ridejob');
    expect(target?.fields['マスタ-応募職種']).toBeUndefined();
    expect(target?.fields.保有資格).toBeUndefined();
    expect(target?.fields.対応履歴メモ).toBe('転職時期: 決まれば早く転職したい');
  });

  it('タクシーLPの応募はタクシードライバーへ紐付ける', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      isTruck: false,
      isTaxi: true,
      truckLicensesLabel: '',
      utm: { utm_creative: 'CR-2607-18_TAXI_人間関係ストレス訴求' },
    });

    expect(target?.fields['マスタ-応募職種']).toEqual({ linkedRecordName: 'タクシードライバー' });
  });

  // タクシーLPは1本でハイヤー転向の訴求も受けている。どちらの求人として扱うかはクリエイティブで決まる。
  it('ハイヤー訴求クリエイティブ経由はハイヤー/役員専属運転手へ紐付ける', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      isTruck: false,
      isTaxi: true,
      truckLicensesLabel: '',
      utm: { utm_creative: 'CR-2607-02_TAXI_ハイヤー転向' },
    });

    expect(target?.fields['マスタ-応募職種']).toEqual({ linkedRecordName: 'ハイヤー/役員専属運転手' });
  });
});

describe('resolveDirectBaseWrite (応募経由マスタ)', () => {
  it('広告流入は応募経由マスタへ配置別に紐付ける', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      utm: { utm_source: 'ig', utm_medium: 'cpc' },
    });

    expect(target?.fields['応募経由(マスタ連動)']).toEqual({ linkedRecordName: 'ig(ad)' });
  });

  it('utmが無い応募は RIDEJOB HP へ紐付ける', () => {
    const target = resolveDirectBaseWrite(truckContext());

    expect(target?.fields['応募経由(マスタ連動)']).toEqual({ linkedRecordName: 'RIDEJOB HP' });
  });

  // 誤った経由が入ると集計まで汚れるので、判定できない流入元は空欄のまま残す。
  it('判定できない流入元は空欄のまま残す', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      utm: { utm_source: 'e2e-test', utm_medium: 'test' },
    });

    expect(target?.fields['応募経由(マスタ連動)']).toBeUndefined();
  });

  // coupang は直書き対象外。null を返して Base Webhook 経路に落とす従来動作を保つ。
  it('クーパン応募は直書きせず従来どおりWebhookへ回す', () => {
    const target = resolveDirectBaseWrite({
      ...truckContext(),
      isTruck: false,
      isCoupang: true,
      utm: { utm_source: 'fb', utm_medium: 'ad' },
    });

    expect(target).toBeNull();
  });

  it('整備士応募も応募経由マスタへ紐付ける', () => {
    const target = resolveDirectBaseWrite({
      ...mechanicContext(),
      utm: { utm_source: 'fb', utm_medium: 'ad' },
    });

    expect(target?.profile).toBe('mechanic');
    expect(target?.fields['応募経由(マスタ連動)']).toEqual({ linkedRecordName: 'fb(ad)' });
  });
});
