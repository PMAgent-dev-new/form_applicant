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
 * 落ちる。Webhook には冪等性が無いので、1時間の電話番号重複窓をすり抜けた再送は
 * そのまま重複レコードになる
 * （2026-09-24 に /entry/mechanic で実測。資格を必須にしている経験者フォームの応募は、
 * この型不一致で常に Webhook 経由になっていた。資格を送らない新卒フォームは直書きできていた）。
 *
 * ⚠️ 既知の限界: Base「資格」列の既存選択肢名は未実測（整備士 Base の認証が手元にない）。
 * ここで渡すラベルが Base 側に無ければ、Lark は選択肢を新規作成する。本来はトラック側
 * （mapTruckLicenses.ts）と同じく Base の選択肢名への対応表を持ち、対応の無い値は
 * 送らないべき。実測できるまでは表示ラベルをそのまま送る。
 */
export function mapMechanicQualificationToBaseOptions(label: string | undefined): string[] | undefined {
  const value = (label ?? '').trim();
  if (!value || value === '未選択') return undefined;
  return [value];
}

export function getMechanicQualificationFieldLabel(formOrigin?: FormOrigin): string {
  return formOrigin === 'mechanic_newgrad' ? '通学コース' : '保有資格';
}
