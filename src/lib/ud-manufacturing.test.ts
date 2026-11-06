import { describe, expect, it } from 'vitest';
import { getUdLaunchConfig, validateUdBirthDate, validateUdSubmission } from './ud-manufacturing';
import { buildApplicationConfirmationText } from './email/templates/application-confirmation';

const config = { UD_MANUFACTURING_ENABLED: 'true', UD_MANUFACTURING_CONTACT_READY: 'true', UD_MANUFACTURING_JOB_ID: 'ud-job-test', UD_MANUFACTURING_SMS_MODE: 'verified-manufacturing', META_SMS_ENABLED: 'true', EEASY_SMS_SEND_URL: 'https://sms.example.invalid/api/sms/send', SMS_SEND_SECRET: 'test-secret' };
const valid = { jobTiming: 'asap' as const, fullName: '動作 確認', fullNameKana: 'どうさ かくにん', birthDate: '20000101', postalCode: '3620046', prefectureId: '', municipalityId: '', phoneNumber: '07031415926', email: 'test@example.invalid' };

describe('UD公開ゲートと入力検証', () => {
  it('未設定では公開しない', () => expect(getUdLaunchConfig({})).toBeNull());
  it('連絡文面・求人・SMS方針のどれかが未確認なら閉じる', () => {
    for (const key of Object.keys(config)) expect(getUdLaunchConfig({ ...config, [key]: '' })).toBeNull();
  });
  it.each(['sfoe98-z9', 'lt_7sto9xj4p', 'dgzs6xw6b', 'ztl0-zg0r'])('経験必須求人%sを流用しない', jobId => {
    expect(getUdLaunchConfig({ ...config, UD_MANUFACTURING_JOB_ID: jobId })).toBeNull();
  });
  it('確認済みの構成だけを返す', () => expect(getUdLaunchConfig(config)).toEqual({ jobId: 'ud-job-test', smsMode: 'verified-manufacturing' }));
  it.each(['disabled-approved', 'verified-mechanic'])('旧SMS方針%sでは公開しない', mode => expect(getUdLaunchConfig({ ...config, UD_MANUFACTURING_SMS_MODE: mode })).toBeNull());
  it('SMS dry-runでは公開しない', () => expect(getUdLaunchConfig({ ...config, META_SMS_DRY_RUN: 'true' })).toBeNull());
  it.each(['20260230', '21000101', '123', 'abcd0101', '18990101'])('不正日付%sを拒否', birth => expect(validateUdBirthDate(birth).isValid).toBe(false));
  it('35歳超を自動不合格にしない', () => expect(validateUdBirthDate('19800101').isValid).toBe(true));
  it('APIにも全5ステップの検証を適用', () => {
    expect(validateUdSubmission(valid)).toBe(true);
    for (const key of ['jobTiming', 'birthDate', 'fullName', 'fullNameKana', 'postalCode', 'phoneNumber', 'email']) {
      expect(validateUdSubmission({ ...valid, [key]: '' })).toBe(false);
    }
    expect(validateUdSubmission({ ...valid, email: undefined })).toBe(false);
  });
  it('返信で整備士・運転手や未確認条件を訴求しない', () => {
    const text = buildApplicationConfirmationText({ applicantName: '動作確認', email: 'test@example.invalid', formOrigin: 'ud_manufacturing' });
    expect(text).toContain('製造・組立');
    expect(text).toContain('人材紹介');
    expect(text).not.toMatch(/整備士|ドライバー|年収|月収|履歴書不要/);
  });
});
