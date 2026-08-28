/**
 * 応募の「媒体名」表示ロジック。
 *
 * Lark Base の媒体名列とチャット通知の両方がここを通る。**片方だけ別の作り方をすると、
 * 同じ応募が Base では「YouTube」・通知では「youtube(referral)」と別名で出る**（実際にそうなっていた）。
 * 表示名を作るのはこのモジュールだけ、という約束にしてある。
 * （例外: `api/coupang/applicants` の通知は旧形式のまま未統合。Meta固定運用のため実害は無いが、
 *   同じ表記に寄せるかは別対応とする。）
 *
 * ⚠️ ここでの正規化は表示専用。Cookie(rj_attr) に書く値は短縮名にしないこと。
 * `/entry` は ridejob.jp と同一オリジンで jobmadley と Cookie を共有しており、
 * 生値を書き換えると向こう側と値がズレる。
 *   参照: src/lib/attribution.ts / jobmadley src/features/application/lib/attribution.ts
 */

/**
 * referrer から推定した流入元は「ホスト名」で入ってくる（youtube.com 等）。
 * 表示名の語彙は utm_source ベース（youtube 等）で作られているので、ここで寄せる。
 *
 * 表に出ないホストは default 節でそのまま出す（嘘をつくよりホスト名の方がよい）。
 */
const REFERRER_HOST_ALIASES: Record<string, string> = {
  'youtube.com': 'youtube',
  'm.youtube.com': 'youtube',
  'youtu.be': 'youtube',
  // ChatGPT からの流入。広告クリックは utm_source=openai で来るが、
  // 回答内で引用されたリンク（自然流入）は referrer が chatgpt.com で来る。
  // 同じ「ChatGPT」に寄せたうえで、広告か否かは medium で分ける。
  'chatgpt.com': 'openai',
  'chat.openai.com': 'openai',
};

/**
 * 表示用に source を正規化する。
 *
 * ⚠️ 型は string だが、実体はリクエストボディ由来なので非string が来うる。
 * 落として500にするより、文字列化して素の値を見せる方が調査しやすい。
 */
export function displaySource(utmSource?: string): string | undefined {
  const raw = asText(utmSource);
  if (!raw) return raw;
  return REFERRER_HOST_ALIASES[raw.toLowerCase()] ?? raw;
}

/** string 以外が来ても落とさずに文字列化する。null/undefined/空文字は undefined。 */
function asText(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  return typeof value === 'string' ? value : String(value);
}

/**
 * 広告として扱う medium。媒体ごとに命名が違うので許容表記を並べる。
 *
 * ⚠️ この揺れ吸収は openai にだけ効かせる。meta/google/tiktok を厳密一致から変えると
 * 既存の応募の見え方が変わるため、ここでは触らない（入稿規約は parameter.md 参照）。
 */
const AD_MEDIUMS = new Set(['ad', 'cpc', 'ads', 'paid']);

function isAdMedium(utmMedium?: unknown): boolean {
  // 入稿URLのコピペで前後に空白が入る事故があるため trim する。
  return AD_MEDIUMS.has((asText(utmMedium) ?? '').trim().toLowerCase());
}

/**
 * utm_source / utm_medium から媒体名を作る。
 * 未知の組み合わせは `source(medium)` の形でそのまま出す（取りこぼしを黙って潰さない）。
 */
export function getMediaName(utmParams: { utm_source?: string; utm_medium?: string }): string {
  return resolve(utmParams).name;
}

/**
 * チャット通知用の表記。媒体名は Base 列と揃えたうえで、medium を括弧で残す。
 *
 * 名前付きの媒体（Meta広告 等）は medium を名前に畳み込んでしまうため、
 * `meta+cpc` と `meta+ad` が通知上で区別できなくなる。UTMの付け間違いは
 * 通知で最初に気づく類のものなので、生の medium を併記して残す。
 */
export function describeMedia(utmParams: { utm_source?: string; utm_medium?: string }): string {
  const { name, matched } = resolve(utmParams);
  const medium = (asText(utmParams.utm_medium) ?? '').trim();
  if (!matched || !medium) return name;
  return `${name}（${medium}）`;
}

/** matched=false は「表に無い流入元」。default 節の `source(medium)` 形式で返している。 */
function resolve(utmParams: { utm_source?: string; utm_medium?: string }): { name: string; matched: boolean } {
  const { utm_medium } = utmParams;
  const utm_source = displaySource(utmParams.utm_source);

  if (!utm_source) {
    return { name: '直接アクセス', matched: false };
  }

  switch (utm_source.toLowerCase()) {
    case 'google':
      if (utm_medium === 'search') {
        return { name: 'Googleリスティング', matched: true };
      }
      return { name: 'Google', matched: true };

    case 'tiktok':
      if (utm_medium === 'ad') {
        return { name: 'TikTok広告', matched: true };
      } else if (utm_medium === 'organic') {
        return { name: 'TikTokオーガニック', matched: true };
      }
      return { name: 'TikTok', matched: true };

    case 'meta':
      if (utm_medium === 'ad') {
        return { name: 'Meta広告', matched: true };
      }
      return { name: 'Meta', matched: true };

    case 'openai':
      // 広告（ChatGPT Ads）と、回答内引用からの自然流入を分ける。
      // 前者は面談単価で評価する有料チャネル、後者はSEO/AIOの成果。混ぜると両方読めなくなる。
      if (isAdMedium(utm_medium)) {
        return { name: 'ChatGPT広告', matched: true };
      }
      return { name: 'ChatGPT', matched: true };

    case 'youtube':
      if (utm_medium === 'organic') {
        return { name: 'YouTubeオーガニック', matched: true };
      }
      return { name: 'YouTube', matched: true };

    case 'threads':
      if (utm_medium === 'organic') {
        return { name: 'スレッドオーガニック', matched: true };
      }
      return { name: 'スレッド', matched: true };

    default:
      return { name: `${utm_source}${utm_medium ? `(${utm_medium})` : ''}`, matched: false };
  }
}
