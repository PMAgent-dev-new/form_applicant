// UD専用。既存求人の同意や計測設定は変更しない。
export const UD_AD_NOTICE_VERSION = 'ud-ads-v1-2026-11-09';
export const UD_AD_NOTICE_URL = 'https://ridejob.jp/entry/ud-manufacturing/privacy';

export const isUdPath = (pathname: string) => /^\/(?:entry\/)?ud-manufacturing(?:\/|$)/.test(pathname);

export const udAdConsentPayload = (accepted: boolean) => ({
  accepted, noticeVersion: UD_AD_NOTICE_VERSION, noticeUrl: UD_AD_NOTICE_URL,
});

export function readUdAdConsent(value: unknown, receivedAt = new Date().toISOString()) {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const accepted = data.accepted === true && data.noticeVersion === UD_AD_NOTICE_VERSION && data.noticeUrl === UD_AD_NOTICE_URL;
  return { accepted, received_at: receivedAt, notice_version: UD_AD_NOTICE_VERSION,
    notice_url: UD_AD_NOTICE_URL, method: 'optional_checkbox' as const, scope: 'ud_meta_google_measurement' as const };
}

export function getMeasurementPermissions(isUd: boolean, value: unknown) {
  return { meta: !isUd || readUdAdConsent(value).accepted, openai: !isUd };
}

export type UdAdConsentRecord = ReturnType<typeof readUdAdConsent>;
export const udAdConsentMemo = (record: UdAdConsentRecord) =>
  `広告計測の任意同意: ${record.accepted ? '同意あり' : '同意なし'}\n説明版: ${record.notice_version}\n説明URL: ${record.notice_url}\n確認受信日時: ${record.received_at}`;

// 同意がサーバーで受理された応募だけ、Googleクリック情報を完了ページへ渡す。
// フォームの入力内容・自由なURLパラメーターはコピーしない。
export function udCompletionPath(accepted: boolean, search: string, gclid?: string) {
  const path = '/ud-manufacturing/applicants/new';
  if (!accepted) return path;
  const source = new URLSearchParams(search), safe = new URLSearchParams();
  for (const key of ['gclid', 'gbraid', 'wbraid']) {
    const value = source.get(key) || (key === 'gclid' ? gclid : undefined);
    if (value && /^[A-Za-z0-9._~-]{1,512}$/.test(value)) safe.set(key, value);
  }
  return safe.size ? `${path}?${safe.toString()}` : path;
}

export function readUdMeasurementReceipt(raw: string | null, now = Date.now()) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)
      || typeof value.at !== 'number' || now - value.at < 0 || now - value.at > 15 * 60 * 1000
      || value.adConsentAccepted !== true || value.noticeVersion !== UD_AD_NOTICE_VERSION) return null;
    return { id: value.id as string };
  } catch { return null; }
}
