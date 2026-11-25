/** Lark text fields may be plain text or rich-text segments. */
export function larkFieldText(value: unknown): string {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value.map(part =>
    part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '',
  ).join('') : '';
}

/** Legacy notification markers are read-only during/after the field migration. */
export function larkNotificationSent(fields: Record<string, unknown>, submissionId: string, legacyMemo: boolean): boolean {
  return fields['Lark通知送信済み'] === true || (legacyMemo
    && larkFieldText(fields['対応履歴メモ']).includes(`[lark_notified:${submissionId}]`));
}

// Phase 1: keep old readers working. Disable only after all production readers
// support dedicated fields and all old in-flight requests have drained.
export const DRIVER_LEGACY_MEMO_WRITE = true;
export function driverSubmissionMemo(submissionId: string): string {
  return DRIVER_LEGACY_MEMO_WRITE && submissionId ? `[submission_id:${submissionId}]` : '';
}
export function larkNotificationUpdate(memo: unknown, submissionId: string, driver: boolean): Record<string, string | boolean> {
  const fields: Record<string, string | boolean> = { 'Lark通知送信済み': true };
  if (driver && DRIVER_LEGACY_MEMO_WRITE) {
    const text = larkFieldText(memo);
    const marker = `[lark_notified:${submissionId}]`;
    fields['対応履歴メモ'] = text.includes(marker) ? text : [text, marker].filter(Boolean).join('\n');
  }
  return fields;
}
