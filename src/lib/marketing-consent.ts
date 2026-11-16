// 求人案内への同意は、応募受付・プライバシー・広告計測とは別に記録する。
export const LEGACY_MARKETING_NOTICE_VERSION = 'job-updates-v1-2026-11-13';
export const LEGACY_MARKETING_NOTICE = '【任意】株式会社PM Agent（RIDE JOB）から求人情報などのメール・SMSを受け取る（配信停止可）';
export const MARKETING_NOTICE_VERSION = 'job-updates-buttons-v2-2026-11-16';
export const MARKETING_NOTICE = 'RIDE JOB（株式会社PM Agent）から求人情報をメール・SMSでお届けします（定期配信あり・停止可）。';
export const OTHER_JOBS_NOTICE = 'RIDE JOB（株式会社PM Agent）から他の求人情報もメール・SMSで受け取れます（定期配信あり・停止可）。';
export const MARKETING_ACTIONS = {
  register: { accepted: true, intent: 'registration', label: '同意して受け取る', notice: MARKETING_NOTICE },
  apply_with_updates: { accepted: true, intent: 'apply', label: '求人情報も受け取って応募', notice: OTHER_JOBS_NOTICE },
  apply_only: { accepted: false, intent: 'apply', label: 'この求人だけに応募', notice: OTHER_JOBS_NOTICE },
  consult_with_updates: { accepted: true, intent: 'consult', label: '求人情報も受け取って相談', notice: OTHER_JOBS_NOTICE },
  consult_only: { accepted: false, intent: 'consult', label: '相談のみ申し込む', notice: OTHER_JOBS_NOTICE },
} as const;
export type MarketingAction = keyof typeof MARKETING_ACTIONS;
export type MarketingIntent = typeof MARKETING_ACTIONS[MarketingAction]['intent'];
export function readMarketingAction(value: unknown, intent?: MarketingIntent): MarketingAction | null {
  if (typeof value !== 'string' || !Object.hasOwn(MARKETING_ACTIONS, value)) return null;
  const action = value as MarketingAction;
  return !intent || MARKETING_ACTIONS[action].intent === intent ? action : null;
}
export const marketingConsentPayload = (action: MarketingAction) => ({
  accepted: MARKETING_ACTIONS[action].accepted, noticeVersion: MARKETING_NOTICE_VERSION, action,
});

export function readMarketingConsent(value: unknown, context: {
  receivedAt: string; pageUrl?: string; email?: string; phone?: string;
}) {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  const action = readMarketingAction(input?.action);
  const current = input?.noticeVersion === MARKETING_NOTICE_VERSION && action !== null
    && input.accepted === MARKETING_ACTIONS[action].accepted;
  // 公開前から開かれている旧フォームは、当時の文言・checkbox方式のまま保存する。
  const legacy = input?.noticeVersion === LEGACY_MARKETING_NOTICE_VERSION && typeof input.accepted === 'boolean';
  const valid = current || legacy;
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
    method: current ? 'button' as const : legacy ? 'checkbox' as const : null,
    scope: 'job_updates' as const,
    notice_version: current ? MARKETING_NOTICE_VERSION : legacy ? LEGACY_MARKETING_NOTICE_VERSION : null,
    notice_text: current ? MARKETING_ACTIONS[action!].notice : legacy ? LEGACY_MARKETING_NOTICE : null,
    action: current ? action : null,
    button_text: current ? MARKETING_ACTIONS[action!].label : null,
    page_url: pageUrl,
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
