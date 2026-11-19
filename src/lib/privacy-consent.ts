// 表示中のポリシーに対する同意。求人企業への個別提供・広告計測への同意とは区別する。
export const PRIVACY_POLICY_URL = 'https://ridejob.jp/privacy';
export const PRIVACY_POLICY_VERSION = 'v4-2026-11-05';
export const PRIVACY_CONSENT_ERROR = 'プライバシーポリシーへの同意を確認してください。';

export const privacyConsentPayload = () => ({
  accepted: true,
  policyVersion: PRIVACY_POLICY_VERSION,
  policyUrl: PRIVACY_POLICY_URL,
});

export function readPrivacyConsent(value: unknown, receivedAt = new Date().toISOString()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const consent = value as Record<string, unknown>;
  if (consent.accepted !== true || consent.policyVersion !== PRIVACY_POLICY_VERSION ||
      consent.policyUrl !== PRIVACY_POLICY_URL) return null;
  return {
    accepted: true as const,
    received_at: receivedAt,
    policy_version: PRIVACY_POLICY_VERSION,
    policy_url: PRIVACY_POLICY_URL,
    method: 'checkbox' as const,
    scope: 'privacy_policy' as const,
  };
}

export type PrivacyConsentRecord = NonNullable<ReturnType<typeof readPrivacyConsent>>;
export const privacyConsentMemo = (consent: PrivacyConsentRecord) =>
  `プライバシーポリシー同意（チェック）：${consent.received_at}／${consent.policy_version}／${consent.policy_url}`;
