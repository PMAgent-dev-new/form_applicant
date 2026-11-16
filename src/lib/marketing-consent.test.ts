import { describe, expect, it } from 'vitest';
import { LEGACY_MARKETING_NOTICE_VERSION, LEGACY_MARKETING_NOTICE, MARKETING_ACTIONS, MARKETING_NOTICE_VERSION, MARKETING_NOTICE, readMarketingAction, marketingConsentPayload, readMarketingConsent, marketingConsentFields } from './marketing-consent';
const context = { receivedAt: '2026-11-13T03:00:00.000Z', pageUrl: 'https://ridejob.jp/entry/taxi?phone=secret#part', email: 'test@example.invalid', phone: '09000000000' };
describe('求人案内の明示的な配信同意', () => {
  it.each([undefined, null, true, 'true', { accepted: true }, { ...marketingConsentPayload('register'), accepted: 'true' }, { ...marketingConsentPayload('register'), noticeVersion: 'old' }, marketingConsentPayload('apply_only')])('明示した有効な選択以外は取得日・方法を付けない: %j', value => {
    const consent = readMarketingConsent(value, context);
    expect(consent.accepted).toBe(false);
    expect(consent.channels).toEqual([]);
    expect(marketingConsentFields(consent)).toEqual({ メール配信同意取得日: undefined, メール配信同意取得方法: undefined });
  });
  it('受信時刻・表示文・取得元と連絡先のチャネルを保存し、入力日時を信用しない', () => {
    const consent = readMarketingConsent({ ...marketingConsentPayload('register'), received_at: '2000-01-01' }, context);
    expect(consent).toMatchObject({ accepted: true, received_at: context.receivedAt, notice_text: MARKETING_NOTICE, page_url: 'https://ridejob.jp/entry/taxi', channels: ['email', 'sms'] });
    expect(marketingConsentFields(consent)).toEqual({ メール配信同意取得日: Date.parse(context.receivedAt), メール配信同意取得方法: '応募フォーム' });
  });
  it('電話のみの応募にメールへの許諾を作らない', () => {
    expect(readMarketingConsent(marketingConsentPayload('register'), { ...context, email: '' }).channels).toEqual(['sms']);
  });
});

describe('ボタンでの同意と旧チェック方式の互換', () => {
  it.each(Object.keys(MARKETING_ACTIONS) as (keyof typeof MARKETING_ACTIONS)[])('%s の操作・表示文をサーバーで確定する', action => {
    const record = readMarketingConsent({ ...marketingConsentPayload(action), notice_text: '改ざん', button_text: '改ざん' }, context);
    expect(record).toMatchObject({ accepted: MARKETING_ACTIONS[action].accepted, method: 'button', action, button_text: MARKETING_ACTIONS[action].label, notice_text: MARKETING_ACTIONS[action].notice });
  });
  it.each([
    { accepted: true, noticeVersion: MARKETING_NOTICE_VERSION },
    { accepted: true, noticeVersion: MARKETING_NOTICE_VERSION, action: 'apply_only' },
    { accepted: true, noticeVersion: MARKETING_NOTICE_VERSION, action: 'constructor' },
    { accepted: true, noticeVersion: MARKETING_NOTICE_VERSION, action: 'unknown' },
  ])('選択の欠落や矛盾から同意を作らない: %j', value => {
    expect(readMarketingConsent(value, context)).toMatchObject({ accepted: false, status: 'invalid', method: null, action: null, channels: [] });
  });
  it.each([true, false])('公開前から開いている旧フォームを新文面へ読み替えない: %s', accepted => {
    expect(readMarketingConsent({ accepted, noticeVersion: LEGACY_MARKETING_NOTICE_VERSION }, context)).toMatchObject({ accepted, method: 'checkbox', notice_text: LEGACY_MARKETING_NOTICE, notice_version: LEGACY_MARKETING_NOTICE_VERSION, action: null, button_text: null });
  });
  it('フォームの目的と異なるボタン・送信元不明の操作を受け付けない', () => {
    expect(readMarketingAction('register', 'apply')).toBeNull();
    expect(readMarketingAction('apply_with_updates', 'registration')).toBeNull();
    expect(readMarketingAction(null, 'apply')).toBeNull();
    expect(readMarketingAction('apply_only', 'apply')).toBe('apply_only');
  });
});
