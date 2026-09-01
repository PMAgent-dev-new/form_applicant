/**
 * Lark Base のマスタテーブルへ張るリンクの「レコード名」を決める。
 *
 * 対象は2つ。
 *   応募経由(マスタ連動) … 応募経由マスタ（ridejob: tbl6w045SNt0hJKD / mechanic: tblzMUVSWmTzmGfA）
 *   マスタ-応募職種       … 応募職種マスタ（ridejob: tblqrcaY1egdi2K1）
 *
 * どちらも従来は応募時に書いておらず、営業が後から手入力していた（issue #68）。
 * 判定材料は応募時点の utm と formOrigin だけで足りることを実データで確認したので、ここで名前を決めて
 * `larkBase.ts` の `{ linkedRecordName }` でレコードIDへ解決する。
 *
 * ⚠️ 迷ったら書かない。誤った経由・職種が入ると、営業が気づかないまま集計まで汚れる。
 * 判定できない入力は undefined を返し、フィールドを空欄のまま残す（後から人が入れられる）。
 *
 * ⚠️ ここで返すのは Lark 側マスタの「表示名」。マスタの名称は2026-08-13に両Baseで統一済みなので、
 *    改名するときは Base 側と同時に直すこと。
 */

/** 判定に使う utm。route.ts の UTMParams と同形だが、必要な3つだけに絞っている。 */
export type MasterNameUtm = {
  utm_source?: string;
  utm_medium?: string;
  utm_creative?: string;
};

/** 広告として扱う medium。媒体・入稿時期によって表記が揺れるため許容表記を並べる。 */
const AD_MEDIUMS = new Set(['ad', 'cpc', 'ads', 'paid', 'search']);

/**
 * utm_source → 応募経由マスタの接頭辞。
 * Meta は入稿URLで `fb` / `ig` / `meta` を打ち分けており、**配置別に分けたまま維持する**
 * （fb と ig で面談率が2倍以上違うため統合してはいけない）。
 */
const AD_SOURCE_PREFIXES: Record<string, string> = {
  meta: 'meta',
  fb: 'fb',
  facebook: 'fb',
  ig: 'ig',
  instagram: 'ig',
  th: 'th',
  threads: 'th',
  tiktok: 'tiktok',
  google: 'google',
};

/** utm_source → マスタ名が固定で決まるもの（広告/オーガニックの区別が無い媒体）。 */
const FIXED_SOURCE_NAMES: Record<string, string> = {
  stanby: 'スタンバイ',
  'jp.stanby.com': 'スタンバイ',
};

const text = (value?: string): string => (value ?? '').trim().toLowerCase();

/**
 * 応募経由マスタのレコード名を決める。
 *
 * - utm_source なし … 自社サイト・直接流入なので `RIDEJOB HP`
 * - 広告媒体 × 広告medium … `fb(ad)` 等
 * - 広告媒体 × organic … `fb(organic)` 等
 * - スタンバイ … `スタンバイ`
 * - それ以外（未知のsource、求人ボックス等からのreferral）… undefined（空欄のまま）
 */
export function resolveApplicationSourceMasterName(utm: MasterNameUtm): string | undefined {
  const source = text(utm.utm_source);
  if (!source) return 'RIDEJOB HP';

  const fixed = FIXED_SOURCE_NAMES[source];
  if (fixed) return fixed;

  const prefix = AD_SOURCE_PREFIXES[source];
  if (!prefix) return undefined;

  const medium = text(utm.utm_medium);
  if (AD_MEDIUMS.has(medium)) return `${prefix}(ad)`;
  if (medium === 'organic') return `${prefix}(organic)`;
  return undefined;
}

/** 応募職種マスタのレコード名（ridejob Base の LP のみ。整備士Baseは Select の「登録職種」を使う）。 */
const JOB_CATEGORY_TAXI = 'タクシードライバー';
const JOB_CATEGORY_HIRE = 'ハイヤー/役員専属運転手';
const JOB_CATEGORY_TRUCK = 'トラックドライバー';
const JOB_CATEGORY_BUS = 'バスドライバー';

/**
 * タクシーLPは1本で「タクシー」と「ハイヤー転向」の両方を受けており、どちらの求人として扱うかは
 * クリエイティブで決まる。実績も CR-2607-02/04（ハイヤー転向）経由は125件中121件がハイヤー、
 * それ以外のTAXIクリエイティブは全件タクシーだった（2026-09-01実測）。
 */
const HIRE_CREATIVE_KEYWORD = 'ハイヤー';

/**
 * 応募職種マスタのレコード名を決める。
 *
 * `isTaxi` は **formOrigin が明示的に 'default' のときだけ true にすること**。
 * default は formOrigin 未指定時のフォールバックを兼ねており、想定外の導線からの応募に
 * タクシー職種が付いてしまうため。
 */
export function resolveJobCategoryMasterName(params: {
  isTaxi: boolean;
  isTruck: boolean;
  isBus: boolean;
  utmCreative?: string;
}): string | undefined {
  if (params.isTruck) return JOB_CATEGORY_TRUCK;
  if (params.isBus) return JOB_CATEGORY_BUS;
  if (!params.isTaxi) return undefined;
  return (params.utmCreative ?? '').includes(HIRE_CREATIVE_KEYWORD)
    ? JOB_CATEGORY_HIRE
    : JOB_CATEGORY_TAXI;
}
