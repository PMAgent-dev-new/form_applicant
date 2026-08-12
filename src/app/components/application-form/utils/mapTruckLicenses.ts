import type { TruckLicense } from '../types';

// 選択肢は競合(クロスワーク/プレックスジョブ)の免許区分を当社カードUI向けに8択へ圧縮したもの。
// 2017年3月の準中型新設(それ以前の普通免許は5t/8t限定へ移行)を「〜限定含む」で吸収する。
const truckLicenseLabels: Record<TruckLicense, string> = {
  regular_at: '普通免許（AT限定）',
  regular_mt: '普通免許（MT）',
  semi_medium: '準中型免許（5t限定含む）',
  medium: '中型免許（8t限定含む）',
  large: '大型免許',
  towing: 'けん引免許',
  forklift: 'フォークリフト',
  none: '免許なし',
};

export function mapTruckLicenseLabel(license: TruckLicense): string {
  return truckLicenseLabels[license] ?? '';
}

export function mapTruckLicenses(licenses: TruckLicense[] | undefined): string {
  if (!licenses || licenses.length === 0) {
    return '未選択';
  }
  const labels = licenses
    .map((license) => truckLicenseLabels[license])
    .filter(Boolean);
  return labels.length > 0 ? labels.join('、') : '未選択';
}

// Lark Base 求職者DB🚕「保有資格」(MultiSelect) 側の既存選択肢名。
// フォームのラベル（「準中型免許（5t限定含む）」等）とは表記が違うため明示的に対応付ける。
// 対応表に無い値を送ると Base 側に選択肢が新規作成されてしまうので、null は書き込まない。
const truckLicenseBaseOptions: Record<TruckLicense, string | null> = {
  regular_at: '普通免許（AT限定）',
  regular_mt: '普通免許（MT）',
  semi_medium: '準中型免許',
  medium: '中型免許',
  large: '大型免許',
  towing: 'けん引免許',
  forklift: 'フォークリフト',
  none: null, // 「免許なし」に相当する選択肢は Base に無いため保存しない
};

// 「保有資格」欄へ書き込む選択肢の配列。該当が無ければ undefined（＝送信しない）。
export function mapTruckLicensesToBaseOptions(
  licenses: TruckLicense[] | undefined
): string[] | undefined {
  const options = (licenses ?? [])
    .map((license) => truckLicenseBaseOptions[license])
    .filter((option): option is string => Boolean(option));
  return options.length > 0 ? options : undefined;
}

export const TRUCK_LICENSE_OPTIONS: Array<{ value: TruckLicense; label: string }> = (
  Object.keys(truckLicenseLabels) as TruckLicense[]
).map((value) => ({ value, label: truckLicenseLabels[value] }));
