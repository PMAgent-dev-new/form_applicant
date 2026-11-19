import { describe, expect, it } from 'vitest';
import { privacyConsentPayload, readPrivacyConsent, privacyConsentMemo } from './privacy-consent';

describe('プライバシーポリシー同意の検証', () => {
  it.each([undefined, null, false, true, [], 'true', {}, { accepted: 'true' },
    { ...privacyConsentPayload(), accepted: false },
    { ...privacyConsentPayload(), policyVersion: 'old' },
    { ...privacyConsentPayload(), policyUrl: 'https://example.invalid' }])('未同意・不正値・旧版を拒否: %j', value => {
    expect(readPrivacyConsent(value)).toBeNull();
  });
  it('クライアントの自己申告日時を採用せず、受信日時・版・URL・チェック方式だけを記録する', () => {
    const receivedAt = '2026-11-07T03:00:00.000Z';
    const consent = readPrivacyConsent({ ...privacyConsentPayload(), received_at: '2000-01-01', adConsent: true }, receivedAt);
    expect(consent).toEqual({ accepted: true, received_at: receivedAt, policy_version: 'v4-2026-11-05',
      policy_url: 'https://ridejob.jp/privacy', method: 'checkbox', scope: 'privacy_policy' });
    expect(privacyConsentMemo(consent!)).toContain(receivedAt);
    expect(consent).not.toHaveProperty('adConsent');
  });
});
