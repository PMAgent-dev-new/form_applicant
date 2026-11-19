export type MechanicRole = 'instructor';

// 広告のUTMや推測から職種を変えず、講師向けフォームとして明示された入力だけを採用する。
export function resolveMechanicRole(formOrigin: unknown, role: unknown): MechanicRole | undefined {
  return formOrigin === 'mechanic' && role === 'instructor' ? 'instructor' : undefined;
}

export const INSTRUCTOR_FORM_TITLE = '整備士教員の応募・転職相談';
