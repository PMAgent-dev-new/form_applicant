import type { JobPosition, DesiredLocation, Age, JobListing } from './types';

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

export const LOCATION_LABELS: Record<DesiredLocation, string> = {
  tokyo: '東京',
  fukuoka: '福岡',
};

export const JOB_LISTINGS: JobListing[] = [
  {
    id: 'account_manager_tokyo',
    title: '営業サポート事務/月給32万～/未経験OK/安定',
    company: 'CP One Japan 合同会社',
    location: '東京都港区',
    salary: '月給 320,000円〜',
    salaryDetail: [
      '基本給：月給320,000円',
      '昇給：勤務実績に基づき支給',
      '通勤手当：実費支給（上限30,000円／月）',
    ],
    highlights: [
      '未経験でも外資系企業オフィス事務デビューできる',
      '月給32万円スタートの安定収入',
      '自らの成果に応じた評価・報酬が得られる環境',
      'スタートアップならではのスピード感ある成長フェーズに参画可能',
      '飲食店・デリバリーサービスを日常的に利用している方は経験を活かせます',
      '成長企業で新しいサービスを一緒に広げていけるポジション',
      '直近2〜3ヶ月のアプリダウンロード数No.1で利用者増加中',
    ],
    jobType: 'アカウントマネージャー',
    workStyle: '変形労働時間制',
    url: 'https://ridejob.jp/job/uyl1oq5g4_7',
    updatedAt: '2025/11/18',
  },
  {
    id: 'field_sales_tokyo',
    title: '法人営業/初月64万/未経験OK/20代・30代中心',
    company: 'CP One Japan 合同会社',
    location: '東京都港区',
    salary: '月給 320,000円 ~ 640,000円',
    salaryDetail: [
      '基本給：月給320,000円（固定残業代含む）',
      '初月限定特別インセンティブ：320,000円支給（条件あり）',
      '月初のみ基本給＋インセンティブで64万',
      'インセンティブ：パフォーマンスに応じて別途支給',
    ],
    highlights: [
      '基本給32万円＋インセンティブ制度あり',
      '初月限定！特別インセンティブ32万円支給',
      '初月は基本給と合わせ月収64万円も可能',
      '努力と成果が収入に直結！20代・30代で年収600万円以上も目指せます',
      '営業未経験でも、成果をしっかり評価！モチベーション高く働ける環境',
      '業界成長率トップクラス！市場拡大中のため未経験でもチャンス大',
      '活気あるチームで、お互いにサポートし合う雰囲気が自慢',
      '直近2〜3ヶ月のアプリダウンロード数国内No.1で、提案のしやすさ抜群',
    ],
    jobType: 'フィールドセールス',
    workStyle: '変形労働時間制',
    url: 'https://ridejob.jp/job/llrcvhvh3cy4',
    updatedAt: '2025/11/18',
  },
  {
    id: 'field_sales_osaka',
    title: '法人営業/初月最大72万/未経験OK/直行直帰OK/韓国発フードデリバリー/20代・30代中心',
    company: 'CP One Japan 合同会社',
    location: '福岡県福岡市中央区',
    salary: '月給 320,000円 ~ 720,000円',
    salaryDetail: [
      '基本給：月給320,000円（固定残業代含む）',
      '初月限定特別インセンティブ：400,000円支給（条件あり）',
      '月初のみ基本給＋インセンティブで72万',
      '2ヶ月目、3ヶ月目も特別インセンティブ30万円支給（条件あり）',
      'インセンティブ：パフォーマンスに応じて別途支給',
    ],
    highlights: [
      '基本給32万円＋インセンティブ制度あり（条件あり）',
      '初月限定インセンティブ40万円支給（条件あり）',
      '2ヶ月目、3ヶ月目も特別インセンティブ30万円支給（条件あり）',
      '3ヶ月の平均月給65万円の実績あり',
      '初年度から年収500〜700万円の実績あり',
      '業界成長率トップクラスで市場拡大中',
    ],
    jobType: 'フィールドセールス',
    workStyle: '変形労働時間制',
    url: 'https://ridejob.jp/job/zw1rlek19',
    updatedAt: '2026/1/7',
  },
  {
    id: 'account_manager_osaka',
    title: '営業事務/月給32万～/未経験OK/履歴書不要/オンライン面接1回',
    company: 'CP One Japan 合同会社',
    location: '福岡県福岡市中央区',
    salary: '月給 320,000円 ~ 350,000円',
    salaryDetail: [
      '基本給：月給320,000円',
      '昇給：勤務実績に基づき支給',
      '通勤手当：実費支給（上限30,000円／月）',
    ],
    highlights: [
      '未経験でも外資系企業オフィス事務デビューできる',
      '月給32万円スタートの安定収入',
      '自らの成果に応じた評価・報酬が得られる環境',
      'スタートアップならではのスピード感ある成長フェーズに参画可能',
      '飲食店・デリバリーサービスを日常的に利用している方は経験を活かせます',
      '成長企業で新しいサービスを一緒に広げていけるポジション',
      '直近2〜3ヶ月のアプリダウンロード数No.1で利用者増加中',
    ],
    jobType: 'アカウントマネージャー',
    workStyle: '変形労働時間制',
    url: 'https://ridejob.jp/job/8r69fn37qesu',
    updatedAt: '2026/1/8',
  },
];

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
