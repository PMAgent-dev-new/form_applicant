import type { FormOrigin, MechanicQualification } from '../types';

const qualificationLabels: Record<MechanicQualification, string> = {
  none: '資格なし',
  level3: '自動車整備士3級',
  level2: '自動車整備士2級',
  level1: '自動車整備士1級',
  inspector: '自動車検査員',
};

export function mapMechanicQualifications(qualification: MechanicQualification | ''): string {
  if (!qualification) {
    return '未選択';
  }
  return qualificationLabels[qualification] ?? '未選択';
}

/**
 * Base「資格」列は**複数選択**。文字列を渡すと `code=1254063 MultiSelectFieldConvFail` で
 * Bitable 直書きがレコードごと失敗し、冪等キー(submission_id)を持たない Base Webhook 経路へ
 * 落ちる。Webhook には冪等性が無いので、再送が起きると重複レコードが増える
 * （2026-09-24 に /entry/mechanic で実測。整備士の応募は常に Webhook 経由になっていた）。
 */
export function mapMechanicQualificationToBaseOptions(label: string | undefined): string[] | undefined {
  const value = (label ?? '').trim();
  if (!value || value === '未選択') return undefined;
  return [value];
}

export function getMechanicQualificationFieldLabel(formOrigin?: FormOrigin): string {
  return formOrigin === 'mechanic_newgrad' ? '通学コース' : '保有資格';
}
