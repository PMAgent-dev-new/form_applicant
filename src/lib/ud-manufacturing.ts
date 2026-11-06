import type { FormData, FormErrors } from '@/app/components/application-form/types';
import { validateCard2, validateFinalStep, validateNameFields } from '@/app/components/application-form/utils/validators';

export const UD_FORM_ORIGIN = 'ud_manufacturing' as const;
export const UD_JOB_LABEL = 'UDトラックス上尾工場・未経験可の製造／組立（正社員）';
export const UD_RECEIPT_KEY = 'ridejob_ud_submission_receipt';
const experiencedJobIds = new Set(['sfoe98-z9', 'lt_7sto9xj4p', 'dgzs6xw6b', 'ztl0-zg0r']);

// 新導線だけを停止できる公開ゲート。未設定・経験者求人・連絡文面未確認では開かない。
export function getUdLaunchConfig(env: Record<string, string | undefined> = process.env) {
  const jobId = env.UD_MANUFACTURING_JOB_ID?.trim() || '';
  const smsMode = env.UD_MANUFACTURING_SMS_MODE;
  if (env.UD_MANUFACTURING_ENABLED !== 'true'
    || env.UD_MANUFACTURING_CONTACT_READY !== 'true'
    || !/^[a-zA-Z0-9_-]{3,100}$/.test(jobId)
    || experiencedJobIds.has(jobId)
    || smsMode !== 'verified-manufacturing'
    || env.META_SMS_ENABLED !== 'true' || env.META_SMS_DRY_RUN === 'true'
    || !env.EEASY_SMS_SEND_URL || !env.SMS_SEND_SECRET) return null;
  return { jobId, smsMode: 'verified-manufacturing' as const };
}

// 求人の35歳以下は画面に明示するが、年齢による自動の合否判定はしない。
export function validateUdBirthDate(value: string, now = new Date()) {
  const errors: FormErrors = {};
  const digits = value.replace(/-/g, '');
  const year = Number(digits.slice(0, 4)), month = Number(digits.slice(4, 6)), day = Number(digits.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (!/^\d{8}$/.test(digits) || year < 1900 || date.getFullYear() !== year
    || date.getMonth() !== month - 1 || date.getDate() !== day || date > now) {
    errors.birthDate = '有効な生年月日を入力してください。';
  }
  return { isValid: !errors.birthDate, errors };
}

export function validateUdSubmission(form: Partial<FormData>) {
  const data = form as FormData;
  if (![data.fullName, data.fullNameKana, data.birthDate, data.phoneNumber, data.email,
    data.postalCode, data.prefectureId, data.municipalityId].every(x => typeof x === 'string')) return false;
  return ['asap', 'within_3_months', 'within_6_months', 'within_1_year'].includes(data.jobTiming)
    && validateUdBirthDate(data.birthDate).isValid
    && validateCard2(data).isValid && validateNameFields(data).isValid
    && validateFinalStep(data, true).isValid;
}
