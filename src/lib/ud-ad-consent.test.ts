import { describe, expect, it } from 'vitest';
import { getMeasurementPermissions, isUdPath, readUdAdConsent, UD_AD_NOTICE_URL, UD_AD_NOTICE_VERSION } from './ud-ad-consent';

const accepted = { accepted: true, noticeVersion: UD_AD_NOTICE_VERSION, noticeUrl: UD_AD_NOTICE_URL };
describe('UDの広告計測を応募受付と分離する', () => {
  it('同意なし・不正・旧版は送信を許可しない', () => {
    for (const value of [undefined, null, {}, [], true, { ...accepted, accepted: 'true' }, { ...accepted, accepted: false }, { ...accepted, noticeVersion: 'old' }, { ...accepted, noticeUrl: 'https://example.invalid/' }]) {
      expect(readUdAdConsent(value).accepted).toBe(false);
      expect(getMeasurementPermissions(true, value)).toEqual({ meta: false, openai: false });
    }
  });
  it('明示的なUD同意でもOpenAIは送らない', () => {
    expect(getMeasurementPermissions(true, accepted)).toEqual({ meta: true, openai: false });
    expect(readUdAdConsent(accepted, '2026-11-08T00:00:00Z').received_at).toBe('2026-11-08T00:00:00Z');
  });
  it('既存求人の計測は維持する', () => {
    expect(getMeasurementPermissions(false, undefined)).toEqual({ meta: true, openai: true });
  });
  it('新旧ドメインのUD全画面だけを識別する', () => {
    for (const p of ['/ud-manufacturing', '/entry/ud-manufacturing', '/ud-manufacturing/applicants/new', '/entry/ud-manufacturing/privacy']) expect(isUdPath(p)).toBe(true);
    for (const p of ['/mechanic', '/entry/truck', '/ud-manufacturing-other', '/applicants/new']) expect(isUdPath(p)).toBe(false);
  });
});
