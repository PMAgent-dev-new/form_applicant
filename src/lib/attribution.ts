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
 * ## 広告の帰属について（正確に書く）
 *
 * **着地1件の解釈は変わらない。** URLにUTMがあればそれを丸ごと使い、Cookie や referrer が
 * 混ざることはない。クリックIDだけの有料クリックも自然検索に化けないようガードしてある。
 *
 * **ただし応募1件の帰属は変わりうる。** 「広告をクリック（応募せず）→ 後日ブックマークや
 * 検索で直接来て応募」が、従来の「直接アクセス」から「広告」に変わる。Cookie に残った
 * lastTouch を使うようになるため。ridejob.jp/entry では jobmadley の EntryCtaLink 経由で
 * 既にこの挙動が本番稼働しているが、**ridejob.pmagent.jp は今回が初**（main は
 * document.cookie を一切触っていない）。
 *
 * 結果として、反映日を境に **Lark上の広告経由の応募数が増え、直接アクセスが減る**方向に
 * 段差が出る。CPAは見かけ上改善する。施策の効果と読み違えないこと。
 *
 * 帰属窓は Cookie の 90日で、`touch.at` に取得時刻を持っているが**送信ボディには載せていない**。
 * つまり集計側で「89日前のクリック」と「今日のクリック」を区別できない。窓を狭めるべきかは
 * ビジネス判断なので、必要になったらここか集計側で切る。
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
  /**
   * ChatGPT広告のクリック識別子。OpenAI が着地URLへ自動付与する（例 `?oppref=gAAAAA...`）。
   * 現時点で送信先は無いが、後から Pixel / Conversions API を入れても
   * **保存していなかった期間は遡って紐づけられない**ため、先に保存だけしておく。
   */
  oppref?: string;
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

/** 全キーが空の utm。解決に失敗したときのフォールバックにも使う。 */
export const EMPTY_UTM_PARAMS: UtmParams = {
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
 * ネイティブアプリからの遷移は `android-app://<パッケージ名>` で来る。
 *
 * ⚠️ ここを特別扱いしないと、パッケージ名がそのままホスト名として扱われ、
 * `com.google.android.youtube` が検索エンジン判定の `/(^|\.)google\./` に
 * **マッチしてしまう**（実測で確認）。つまり Android の YouTube アプリからの流入が
 * 「Google自然検索」として記録される。このモジュールが計測しようとしている当の流入が、
 * 自然検索KPIを汚染する側に回るという最悪の形になる。
 *
 * YouTube は PC ブラウザ経由と同じ `youtube.com` に寄せる。値が割れると集計で行が分かれる。
 */
const APP_PACKAGE_SOURCES: Record<string, { source: string; medium: string }> = {
  'com.google.android.youtube': { source: 'youtube.com', medium: 'referral' },
  'com.google.android.googlequicksearchbox': { source: 'google', medium: 'organic' },
  'com.google.android.gm': { source: 'gmail', medium: 'referral' },
};

/**
 * UTM が無い着地で、document.referrer から touch を推定する。
 * - ネイティブアプリ（android-app:// 等）→ パッケージ名から判定（上の表）
 * - 検索エンジン → { source: "google" 等, medium: "organic" }
 * - 自サイト内遷移 / referrer 無し → undefined（direct のまま。既存挙動を変えない）
 * - その他の外部サイト → { source: ホスト名, medium: "referral" }
 *
 * ⚠️ ホスト名を "youtube" のような短縮名へ正規化しない。
 * 表示名への変換は API 側（getMediaName）の仕事で、そちらなら Cookie の値を汚さない。
 */
export const touchFromReferrer = (
  referrer: string,
  currentHost: string,
): Partial<AttributionTouch> | undefined => {
  if (!referrer) return undefined;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (!host) return undefined;

  // http(s) 以外はホスト名がドメインではないので、検索エンジンの正規表現に通さない。
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const known = APP_PACKAGE_SOURCES[host];
    return known ? { ...known } : { source: host, medium: 'referral' };
  }

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
      if (!key) return acc;
      // ⚠️ decode は1本ずつ try で囲む。`%` を生で含む Cookie が1つでもあると
      // decodeURIComponent が URIError を投げ、**このドメインの全 Cookie の読み取りが失敗する**。
      // ridejob.jp には GTM 経由の計測タグが多数あり、Cookie を書く主体はこのアプリだけではない。
      // 他人が書いた1本のせいで応募フォームが使えなくなる、という壊れ方をさせない。
      try {
        acc[key] = decodeURIComponent(value);
      } catch {
        acc[key] = value;
      }
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
  const oppref = params.get('oppref')?.trim() || undefined;

  const current = readAttribution();

  // oppref をここに含めないと、UTMが欠けた広告クリック（付け忘れ・中間リダイレクトでの脱落）が
  // referrer 推定に落ちて chatgpt.com → 「ChatGPT（自然流入）」として記録される。
  // 広告費が自然流入KPIに混入するので、クリックIDがある限り referrer 推定へは行かせない。
  if (!isMeaningful(touchParams) && !fbclid && !gclid && !oppref) {
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
    oppref: oppref ?? current.oppref,
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
 * 大原則: **3つの出所を混ぜない。** どれか1つを丸ごと採用する。
 * 混ぜると「先週の自然検索の source」と「今日のリンクの medium」が同じレコードに並ぶ、
 * 実在しない組み合わせができる。数字を見た人はそれを本物の流入として読む。
 */
export function resolveUtmParams(
  search: string,
  attribution: Attribution,
  referrer: string,
  currentHost: string,
): UtmParams {
  const params = new URLSearchParams(search);
  const fromQuery = { ...EMPTY_UTM_PARAMS };
  for (const k of UTM_KEYS) fromQuery[k] = params.get(k)?.trim() || '';

  // 1. query に utm_source があれば、その着地を丸ごと正とする。
  //    ここが広告の帰属を守る要。Cookie で穴埋めもしない。
  if (fromQuery.utm_source) return fromQuery;

  // 2. クリックIDだけが付いた有料クリック。
  //    Google広告の「自動タグ設定」は既定で **gclid だけを付けて utm_* を付けない**。
  //    その着地の referrer は検索結果ページ（google.com）なので、下の referrer 推定に
  //    落とすと **有料クリックが utm_medium=organic として記録される**。
  //    自然検索の応募数はSEO成果の判断に使う数字なので、そこに有料が混ざるのは最悪。
  //    旧挙動（＝直接アクセス）のまま返して、少なくとも嘘はつかない。
  //    ※ captureAttribution 側は既に clickid を「意味のある着地」として扱っており、
  //      ここに同じガードが無いのは片手落ちだった。
  //    ChatGPT広告の oppref も同じ扱い。こちらは referrer が chatgpt.com になるため、
  //    referrer 推定に落ちると「ChatGPT（自然流入）」＝AIOの成果として数えられてしまう。
  //    広告費が自然流入KPIに混入する方向なので、gclid/fbclid と同列に止める。
  if (params.get('gclid')?.trim() || params.get('fbclid')?.trim() || params.get('oppref')?.trim()) {
    return fromQuery;
  }

  // 3. Cookie に保存された touch（サイト内を回遊してから応募した経路。
  //    ridejob.jp と同一オリジンなので jobmadley が書いた値もここに入る）。
  const touch = attribution.lastTouch ?? attribution.firstTouch;
  if (touch?.source) {
    return {
      ...EMPTY_UTM_PARAMS,
      utm_source: touch.source,
      utm_medium: touch.medium || '',
      utm_campaign: touch.campaign || '',
      utm_term: touch.term || '',
      utm_content: touch.content || '',
    };
  }

  // 4. Cookie が無い場合の保険（Cookie がブロックされている環境・初回着地で保存前に送信）。
  const derived = touchFromReferrer(referrer, currentHost);
  if (derived?.source) {
    return { ...EMPTY_UTM_PARAMS, utm_source: derived.source, utm_medium: derived.medium || '' };
  }

  // 5. どれも無い＝従来どおり直接アクセス。query の断片があればそのまま返す（旧挙動と同一）。
  return fromQuery;
}
