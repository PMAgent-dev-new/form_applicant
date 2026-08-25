import type { JobPosition, DesiredLocation, Age } from './types';

/**
 * Meta の Lead に載せる識別子。ブラウザ Pixel と サーバー CAPI の両方で同じ値を送る。
 * Events Manager のカスタムコンバージョン「RIDEJOB_クーパン応募」は
 * `content_name` がこの値と等しいことだけをルールにしているため、
 * **値を変えるとクーパンのCVが計上されなくなる**。変更するときはEvents Manager側も同時に直すこと。
 */
export const COUPANG_META_CONTENT_NAME = 'coupang_rocketnow';

export const JOB_POSITION_LABELS: Record<JobPosition, string> = {
  field_sales: 'フィールドセールス',
  account_manager: 'アカウントマネージャー',
};

/**
 * 旧実装のスラッグ→表示名マップ。**現行フォームはこの経路を通らない。**
 * 選択肢はGASシート由来で、日本語ラベルをそのまま value として送信しており、
 * API側も最終フォールバックで日本語値を通す。ここを増やしても挙動は変わらないので、
 * 過去データの解決用フォールバックとしてのみ残している。
 */
export const LOCATION_LABELS: Record<DesiredLocation, string> = {
  tokyo: '東京',
  fukuoka: '福岡',
};

export const AGE_OPTIONS: { value: Age; label: string }[] = Array.from(
  { length: 23 },
  (_, index) => {
    const age = 18 + index;
    return {
      value: String(age) as Age,
      label: `${age}歳`,
    };
  }
);
