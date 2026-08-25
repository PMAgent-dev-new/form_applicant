/**
 * 応募フォームの流入アトリビューション（クライアント専用）。
 *
 * ## なぜ必要か
 *
 * このフォームは長らく `window.location.search` の utm_* しか見ていなかった。
 * 広告はUTM付きで着地するので拾えるが、**UTMを持たない流入は全部「直接アクセス」に落ちる**。
 * 実際に 2026-08-25、自社YouTube 17本の概要欄リンクを ridejob.jp/entry へ張り替えた際に
 * この欠落が表面化した（総再生21,514回ぶんの導線が、応募しても流入元不明になる）。
 *
 * jobmadley 側（ridejob.jp 本体）には既に同じ仕組みがあり、
 * `shared/components/entry-cta-link.tsx` には
 * 「恒久対策は form_applicant 側に query → Cookie → referrer のフォールバックを入れること」
 * と明記されている。これがその恒久対策にあたる。
 *
 * ## Cookie は jobmadley と共有している（重要）
 *
 * `/entry` は Cloudflare Worker 経由で **ridejob.jp と同一オリジン**に配信されるため、
 * jobmadley が書く `rj_attr` Cookie がそのままここでも読める。
 * よって **スキーマと Cookie 名を jobmadley と完全に一致させること**。
 * 片方だけ形を変えると、もう片方が読めない／壊れた値を書く。
 *   参照元: jobmadley `src/features/application/lib/attribution.ts`
 *
 * これにより「Googleで検索 → ridejob.jp を回遊 → /entry で応募」の経路も
 * organic として繋がる（従来はここも直接アクセスに落ちていた）。
 *
 * ⚠️ Cookie の path は必ず `/`。`/entry` にすると jobmadley と共有できなくなる。
 *
 * ## 有料の帰属は絶対に変えない
 *
 * URLのUTMが最優先で、referrer 由来の値が広告の帰属を上書きすることはない。
 * 「既存の touch が無いときだけ referrer から補う」という一点だけを守る。
 * ここを崩すと広告のCPAが動いてしまう。
 */

export type AttributionTouch = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  /** 取得時刻（ISO 8601, UTC） */
  at: string;
};

export type Attribution = {
  firstTouch?: AttributionTouch;
  lastTouch?: AttributionTouch;
  fbclid?: string;
  gclid?: string;
  /** 初回接触時のランディングパス（origin なし） */
  landing?: string;
  /** 初回接触時の document.referrer */
  referrer?: string;
};

const COOKIE_NAME = 'rj_attr';
const MAX_AGE_SEC = 90 * 24 * 60 * 60; // 90日（生値を長めに保持。帰属窓は集計側で決める）
const LEGACY_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** クロスドメイン運用時のみ指定（例: .ridejob.jp）。jobmadley と同じ変数名を使う。 */
const COOKIE_DOMAIN = process.env.NEXT_PUBLIC_ATTR_COOKIE_DOMAIN;

/**
 * フォームが送信する utm キー。
 * ⚠️ useApplicationFormState.ts の utmParams と一致させること。
 */
export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_creative',
  'utm_content',
  'utm_id',
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmParams = Record<UtmKey, string>;

const EMPTY_UTM: UtmParams = {
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_term: '',
  utm_creative: '',
  utm_content: '',
  utm_id: '',
};

/** 参照元ホスト名 → 検索エンジンの source 名。該当なしは undefined。 */
const SEARCH_ENGINE_HOSTS: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)google\./, 'google'],
  [/(^|\.)(search\.)?yahoo\./, 'yahoo'],
  [/(^|\.)bing\./, 'bing'],
  [/(^|\.)duckduckgo\./, 'duckduckgo'],
  [/(^|\.)ecosia\./, 'ecosia'],
  [/(^|\.)baidu\./, 'baidu'],
  [/(^|\.)naver\./, 'naver'],
];

/**
 * UTM が無い着地で、document.referrer から touch を推定する。
 * - 検索エンジン → { source: "google" 等, medium: "organic" }
 * - 自サイト内遷移 / referrer 無し → undefined（direct のまま。既存挙動を変えない）
 * - その他の外部サイト → { source: ホスト名, medium: "referral" }
 *
 * ⚠️ jobmadley の同名関数と挙動を一致させること（同じ Cookie に書くため）。
 * ホスト名を "youtube" のような短縮名へ正規化したくなるが、ここではやらない。
 * 表示名への変換は API 側（getMediaName）の仕事で、そちらなら Cookie の値を汚さない。
 */
export const touchFromReferrer = (
  referrer: string,
  currentHost: string,
): Partial<AttributionTouch> | undefined => {
  if (!referrer) return undefined;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!host) return undefined;

  // 自ドメイン（サブドメイン含む）からの遷移は流入ではない。
  // これが無いと、フォーム内のページ遷移（/taxi → /taxi/applicants/new）が
  // 毎回 referral として記録され、本当の流入元を押し流す。
  //
  // currentHost は `location.host` でポートを含みうるのに対し、比較相手の `host` は
  // hostname（ポート無し）。揃えないと localhost:3000 で自ドメイン判定が外れる。
  // 本番（ridejob.jp）はポートを持たないため、この正規化で挙動は変わらない。
  const self = currentHost.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
  if (self && (host === self || host.endsWith(`.${self}`))) return undefined;

  for (const [pattern, name] of SEARCH_ENGINE_HOSTS) {
    if (pattern.test(host)) return { source: name, medium: 'organic' };
  }
  return { source: host.replace(/^www\./, ''), medium: 'referral' };
};

const isMeaningful = (t: Partial<AttributionTouch>): boolean =>
  Boolean(t.source || t.medium || t.campaign || t.content || t.term);

const parseCookies = (): Record<string, string> => {
  if (typeof document === 'undefined') return {};
  return document.cookie.split('; ').reduce(
    (acc, cookie) => {
      const idx = cookie.indexOf('=');
      if (idx === -1) return acc;
      const key = cookie.slice(0, idx);
      const value = cookie.slice(idx + 1);
      if (key) acc[key] = decodeURIComponent(value);
      return acc;
    },
    {} as Record<string, string>,
  );
};

const writeCookie = (name: string, value: string, maxAgeSec: number): void => {
  if (typeof document === 'undefined') return;
  const domainAttr = COOKIE_DOMAIN ? `; domain=${COOKIE_DOMAIN}` : '';
  // path は必ず "/"。basePath=/entry に合わせると jobmadley と共有できなくなる。
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; SameSite=Lax${domainAttr}`;
};

/** 現在保存されているアトリビューションを読む（rj_attr 優先・legacy Cookie フォールバック）。 */
export function readAttribution(): Attribution {
  const cookies = parseCookies();
  const raw = cookies[COOKIE_NAME];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Attribution;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // 壊れていれば legacy にフォールバック
    }
  }
  const legacySource = cookies.utm_source;
  const legacyMedium = cookies.utm_medium;
  if (legacySource || legacyMedium) {
    const touch: AttributionTouch = { source: legacySource, medium: legacyMedium, at: '' };
    return { firstTouch: touch, lastTouch: touch };
  }
  return {};
}

/** URL から touch 相当のパラメータを抜き出す（値が無ければ undefined）。 */
const readTouchParams = (params: URLSearchParams): Partial<AttributionTouch> => {
  const pick = (key: string) => params.get(key)?.trim() || undefined;
  return {
    source: pick('utm_source'),
    medium: pick('utm_medium'),
    campaign: pick('utm_campaign'),
    content: pick('utm_content'),
    term: pick('utm_term'),
  };
};

/**
 * URL のパラメータを取り込んでアトリビューションを更新・保存する。
 * 意味のある UTM/クリックIDが無い着地では、referrer から推定して
 * **既存の touch が無いときだけ**記録する（有料の帰属を動かさないため）。
 *
 * @param search   location.search（"?..." 形式）
 * @param path     location.pathname（初回ランディング記録用）
 * @param referrer document.referrer
 * @param nowIso   現在時刻の ISO 文字列
 * @param currentHost 自ホスト判定用（省略時は window.location.host）
 */
export function captureAttribution(
  search: string,
  path: string,
  referrer: string,
  nowIso: string,
  currentHost?: string,
): Attribution {
  const params = new URLSearchParams(search);
  const touchParams = readTouchParams(params);
  const fbclid = params.get('fbclid')?.trim() || undefined;
  const gclid = params.get('gclid')?.trim() || undefined;

  const current = readAttribution();

  if (!isMeaningful(touchParams) && !fbclid && !gclid) {
    if (current.lastTouch || current.firstTouch) return current;

    const host = currentHost ?? (typeof window !== 'undefined' ? window.location.host : '');
    const derived = touchFromReferrer(referrer, host);
    if (!derived) return current;

    const referrerTouch: AttributionTouch = { ...derived, at: nowIso };
    const next: Attribution = {
      ...current,
      firstTouch: referrerTouch,
      lastTouch: referrerTouch,
      landing: current.landing ?? path,
      referrer: current.referrer ?? (referrer || undefined),
    };
    writeCookie(COOKIE_NAME, JSON.stringify(next), MAX_AGE_SEC);
    if (referrerTouch.source) writeCookie('utm_source', referrerTouch.source, LEGACY_MAX_AGE_SEC);
    if (referrerTouch.medium) writeCookie('utm_medium', referrerTouch.medium, LEGACY_MAX_AGE_SEC);
    return next;
  }

  const touch: AttributionTouch = { ...touchParams, at: nowIso };
  const next: Attribution = {
    firstTouch: current.firstTouch ?? (isMeaningful(touchParams) ? touch : current.firstTouch),
    lastTouch: isMeaningful(touchParams) ? touch : current.lastTouch,
    fbclid: fbclid ?? current.fbclid,
    gclid: gclid ?? current.gclid,
    landing: current.landing ?? path,
    referrer: current.referrer ?? (referrer || undefined),
  };

  writeCookie(COOKIE_NAME, JSON.stringify(next), MAX_AGE_SEC);
  if (touch.source) writeCookie('utm_source', touch.source, LEGACY_MAX_AGE_SEC);
  if (touch.medium) writeCookie('utm_medium', touch.medium, LEGACY_MAX_AGE_SEC);

  return next;
}

/**
 * 送信時に載せる utm を決める。優先順は **query → Cookie → referrer**。
 *
 * - query に utm_source があれば、その1件の着地を丸ごと正とする（広告の帰属を壊さない）
 * - 無ければ Cookie の lastTouch（回遊してから応募した経路・jobmadley が書いた値も含む）
 * - Cookie も無ければ referrer から推定（Cookie がブロックされている環境の保険）
 *
 * ⚠️ query に utm_source がある場合、Cookie で「部分的に穴埋め」してはいけない。
 * 広告のUTMと過去の自然検索のUTMが混ざった、実在しない組み合わせのレコードができる。
 * utm_id / utm_creative は広告固有なので Cookie 側には存在せず、query からのみ入る。
 */
export function resolveUtmParams(
  search: string,
  attribution: Attribution,
  referrer: string,
  currentHost: string,
): UtmParams {
  const params = new URLSearchParams(search);
  const fromQuery = { ...EMPTY_UTM };
  for (const k of UTM_KEYS) fromQuery[k] = params.get(k)?.trim() || '';

  if (fromQuery.utm_source) return fromQuery;

  const touch = attribution.lastTouch ?? attribution.firstTouch;
  if (touch?.source) {
    return {
      ...fromQuery,
      utm_source: touch.source,
      utm_medium: fromQuery.utm_medium || touch.medium || '',
      utm_campaign: fromQuery.utm_campaign || touch.campaign || '',
      utm_term: fromQuery.utm_term || touch.term || '',
      utm_content: fromQuery.utm_content || touch.content || '',
    };
  }

  const derived = touchFromReferrer(referrer, currentHost);
  if (derived?.source) {
    return {
      ...fromQuery,
      utm_source: derived.source,
      utm_medium: fromQuery.utm_medium || derived.medium || '',
    };
  }

  return fromQuery;
}
