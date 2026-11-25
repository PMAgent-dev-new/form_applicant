import { describe, it, expect } from 'vitest';
import { larkFieldText, larkNotificationSent, driverSubmissionMemo, larkNotificationUpdate, DRIVER_LEGACY_MEMO_WRITE } from './larkSubmissionState';
describe('dedicated notification state with legacy compatibility', () => {
  it('accepts the saved flag without changing human notes', () => {
    const fields = { submission_id: 'id-1', 'Lark通知送信済み': true, '対応履歴メモ': '営業が追記したメモ' };
    expect(larkNotificationSent(fields, 'id-1', true)).toBe(true);
    expect(fields['対応履歴メモ']).toBe('営業が追記したメモ');
  });
  it('reads the matching legacy marker including rich text only on the legacy profile', () => {
    const fields = { '対応履歴メモ': [{ text: '営業メモ\n[lark_notified:id-1]' }] };
    expect(larkNotificationSent(fields, 'id-1', true)).toBe(true);
    expect(larkNotificationSent(fields, 'id-2', true)).toBe(false);
    expect(larkNotificationSent(fields, 'id-1', false)).toBe(false);
    expect(larkFieldText(fields['対応履歴メモ'])).toBe('営業メモ\n[lark_notified:id-1]');
  });
  it('does not infer notification success from an ID or a truthy string', () => {
    expect(larkNotificationSent({ submission_id: 'id-1', 'Lark通知送信済み': 'true' }, 'id-1', true)).toBe(false);
  });
  it('keeps old readers deduplicating a retry until the compatibility phase ends', () => {
    const memo = driverSubmissionMemo('id-1');
    const record = {submission_id: 'id-1', '対応履歴メモ': memo, ...larkNotificationUpdate(memo, 'id-1', true)};
    expect(larkNotificationSent(record, 'id-1', true)).toBe(true);
    const legacyFindsSubmission = String(record['対応履歴メモ']).includes('[submission_id:id-1]');
    const legacySkipsSideEffects = String(record['対応履歴メモ']).includes('[lark_notified:id-1]');
    expect(legacyFindsSubmission).toBe(DRIVER_LEGACY_MEMO_WRITE);
    expect(legacySkipsSideEffects).toBe(DRIVER_LEGACY_MEMO_WRITE);
    if (!DRIVER_LEGACY_MEMO_WRITE) expect(larkNotificationUpdate('営業追記', 'id-1', true)).toEqual({'Lark通知送信済み':true});
    expect(larkNotificationUpdate('整備士メモ','id-1',false)).toEqual({'Lark通知送信済み':true});
  });

});
