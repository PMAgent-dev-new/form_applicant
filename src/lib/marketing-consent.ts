// 求人案内の配信同意。応募受付・プライバシー・広告計測への同意とは分離する。
export const MARKETING_NOTICE_VERSION = 'job-updates-v1-2026-11-13';
export const MARKETING_NOTICE = '【任意】株式会社PM Agent（RIDE JOB）から求人情報などのメール・SMSを受け取る（配信停止可）';
export const marketingConsentPayload = (accepted: boolean) => ({ accepted, noticeVersion: MARKETING_NOTICE_VERSION });

export function readMarketingConsent(value: unknown, context: {
  receivedAt: string; pageUrl?: string; email?: string; phone?: string;
}) {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  const valid = input?.noticeVersion === MARKETING_NOTICE_VERSION && typeof input?.accepted === 'boolean';
  const accepted = valid && input?.accepted === true;
  let pageUrl = '';
  try {
    const url = new URL(context.pageUrl || '');
    if (url.protocol === 'https:' || url.protocol === 'http:') pageUrl = `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch { /* URLなしでも応募を受け付け、証跡では未確認として残す。 */ }
  return {
    accepted,
    status: valid ? (accepted ? 'accepted' : 'declined') : value == null ? 'not_present' : 'invalid',
    received_at: context.receivedAt,
    method: valid ? 'checkbox' as const : null,
    scope: 'job_updates' as const,
    notice_version: valid ? MARKETING_NOTICE_VERSION : null,
    notice_text: valid ? MARKETING_NOTICE : null,
    page_url: pageUrl,
    // 連絡先は同じ応募レコードと紐づける。入力されていない宛先への許諾を作らない。
    channels: accepted ? [context.email?.trim() ? 'email' : '', context.phone?.trim() ? 'sms' : ''].filter(Boolean) : [],
  };
}
export type MarketingConsentRecord = ReturnType<typeof readMarketingConsent>;
export const marketingConsentMemo = (consent: MarketingConsentRecord) =>
  `求人案内配信同意: ${JSON.stringify(consent)}`;
export const marketingConsentFields = (consent?: MarketingConsentRecord) => ({
  メール配信同意取得日: consent?.accepted ? Date.parse(consent.received_at) : undefined,
  メール配信同意取得方法: consent?.accepted ? '応募フォーム' : undefined,
});
