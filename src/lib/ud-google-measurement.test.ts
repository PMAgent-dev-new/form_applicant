import { describe, expect, it } from 'vitest';
import { udGoogleCommands, UD_GOOGLE_SEND_TO } from './ud-google-measurement';
import { readUdMeasurementReceipt, udCompletionPath, UD_AD_NOTICE_VERSION } from './ud-ad-consent';

const now = 1800000000000;
const receipt = { id: 'event-test', at: now, adConsentAccepted: true, noticeVersion: UD_AD_NOTICE_VERSION };

describe('UD専用Google計測', () => {
  it('未同意・欠落・不正・旧版・期限切れの完了訪問はタグすら読み込まない', () => {
    for (const raw of [null, '', 'bad', 'null', '{}', JSON.stringify({ ...receipt, adConsentAccepted: false }), JSON.stringify({ ...receipt, noticeVersion: 'old' }), JSON.stringify({ ...receipt, at: now - 900001 }), JSON.stringify({ ...receipt, at: now + 1 })]) {
      expect(readUdMeasurementReceipt(raw, now)).toBeNull();
      expect(udGoogleCommands(raw, now)).toEqual([]);
    }
  });
  it('同意済みの新規受付だけを既存CVへ1回、氏名等なしで送る', () => {
    const commands = udGoogleCommands(JSON.stringify(receipt), now);
    expect(commands[0]).toEqual(['consent', 'default', { ad_storage: 'granted', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }]);
    expect(commands.filter(c => c[0] === 'event')).toEqual([['event', 'conversion', { send_to: UD_GOOGLE_SEND_TO, transaction_id: receipt.id }]]);
    expect(JSON.stringify(commands)).not.toMatch(/email|phone|fullName|birthDate/);
  });
  it('同意後の完了ページへ渡すのは安全なクリックIDだけ', () => {
    expect(udCompletionPath(false, '?gclid=abc')).toBe('/ud-manufacturing/applicants/new');
    expect(udCompletionPath(true, '?gclid=abc&email=person%40example.com&gbraid=test-123')).toBe('/ud-manufacturing/applicants/new?gclid=abc&gbraid=test-123');
    expect(udCompletionPath(true, '?gclid=%3Cscript%3E&wbraid=x')).toBe('/ud-manufacturing/applicants/new?wbraid=x');
    expect(udCompletionPath(true, '', 'stored-click')).toBe('/ud-manufacturing/applicants/new?gclid=stored-click');
  });
});
