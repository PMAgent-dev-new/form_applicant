import { describe, expect, it } from 'vitest';
import { MARKETING_NOTICE, marketingConsentPayload, readMarketingConsent, marketingConsentFields } from './marketing-consent';
const context = { receivedAt: '2026-11-13T03:00:00.000Z', pageUrl: 'https://ridejob.jp/entry/taxi?phone=secret#part', email: 'test@example.invalid', phone: '09000000000' };
describe('任意のメールSMS配信同意', () => {
  it.each([undefined, null, true, 'true', { accepted: true }, { ...marketingConsentPayload(true), accepted: 'true' }, { ...marketingConsentPayload(true), noticeVersion: 'old' }, marketingConsentPayload(false)])('明示した有効なチェック以外は取得日・方法を付けない: %j', value => {
    const consent = readMarketingConsent(value, context);
    expect(consent.accepted).toBe(false);
    expect(consent.channels).toEqual([]);
    expect(marketingConsentFields(consent)).toEqual({ メール配信同意取得日: undefined, メール配信同意取得方法: undefined });
  });
  it('受信時刻・表示文・取得元と連絡先のチャネルを保存し、入力日時を信用しない', () => {
    const consent = readMarketingConsent({ ...marketingConsentPayload(true), received_at: '2000-01-01' }, context);
    expect(consent).toMatchObject({ accepted: true, received_at: context.receivedAt, notice_text: MARKETING_NOTICE, page_url: 'https://ridejob.jp/entry/taxi', channels: ['email', 'sms'] });
    expect(marketingConsentFields(consent)).toEqual({ メール配信同意取得日: Date.parse(context.receivedAt), メール配信同意取得方法: '応募フォーム' });
  });
  it('電話のみの応募にメールへの許諾を作らない', () => {
    expect(readMarketingConsent(marketingConsentPayload(true), { ...context, email: '' }).channels).toEqual(['sms']);
  });
});
