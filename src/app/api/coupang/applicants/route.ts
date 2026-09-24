import { NextRequest, NextResponse } from 'next/server';
import type { CoupangFormData } from '@/app/components/coupang-form/types';
import {
  COUPANG_META_CONTENT_NAME,
  JOB_POSITION_LABELS,
  LOCATION_LABELS,
} from '@/app/components/coupang-form/constants';
import { resolveAdImageUrl, isLikelyAdId } from '@/lib/meta/resolveAdImage';
import { sendMetaCapiLead } from '@/lib/meta/capi';
import { sendOpenAiConversion } from '@/lib/openai/capi';
import { sendApplicationConfirmationEmail } from '@/lib/email/send-application-confirmation';
import { sendApplicationSms } from '@/lib/sms/send-application-sms';
import { BASE_PATH } from '@/lib/basePath';
import { getMediaName } from '@/lib/media-name';
import { resolveApplicationSourceMasterName } from '@/lib/lark-masters';
import { isMetaAdsAttribution, isOpenAiAdsAttribution } from '@/lib/attribution';
import { describeError } from '@/lib/describe-error';
import { markSubmissionVaultNotified, saveToSubmissionVault } from '@/lib/submissionVault';
import {
  isLarkBaseConfigured,
  upsertBaseRecordByTextField,
  updateBaseRecord,
  type LarkFieldValue,
} from '@/lib/larkBase';

/**
 * referer が取れないときに CAPI へ渡す既定の event_source_url。
 * 同じコードが2ゾーンで動くため、固定値にすると旧ドメインからの応募が
 * 新ドメイン由来として記録される。BASE_PATH でゾーンを判別して振り分ける。
 */
const COUPANG_EVENT_SOURCE_URL = BASE_PATH
  ? 'https://ridejob.jp/entry/coupang'
  : 'https://ridejob.pmagent.jp/coupang';

/**
 * Lark（IM通知・Base Webhook）への送信タイムアウト。
 * 既存の `src/app/api/entry-bp/route.ts` に合わせて 5 秒。
 */
const LARK_FETCH_TIMEOUT_MS = 5000;
const LIFTJOB_TABLE_ID = process.env.LARK_BASE_TABLE_ID_LIFTJOB || 'tblVBAB0nVCgWVWJ';

type LarkWebhookResult = {
  code?: number | string;
  msg?: string;
  StatusCode?: number | string;
  StatusMessage?: string;
};

function hasNonZeroCode(value: number | string | undefined): boolean {
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string' && value.trim()) return Number(value) !== 0;
  return false;
}

function isZeroCode(value: number | string | undefined): boolean {
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string' && value.trim()) return Number(value) === 0;
  return false;
}

/** Lark Bot / AnyCross は HTTP 200 でも body 側に失敗コードを返すため両方見る。 */
function isLarkRejected(result: LarkWebhookResult): boolean {
  return hasNonZeroCode(result.code) || hasNonZeroCode(result.StatusCode);
}

/** 空本文・非JSON・成功コード欠落を、誤って成功扱いしない。 */
function isLarkAccepted(result: LarkWebhookResult): boolean {
  const hasExplicitSuccess = isZeroCode(result.code) || isZeroCode(result.StatusCode);
  return hasExplicitSuccess && !isLarkRejected(result);
}

function isAllowedLarkWebhookUrl(value: string, kind: 'notification' | 'base'): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return false;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (kind === 'notification') {
      return (
        url.hostname === 'open.larksuite.com' &&
        segments.length === 5 &&
        segments.slice(0, 4).join('/') === 'open-apis/bot/v2/hook' &&
        Boolean(segments[4])
      );
    }

    const isAnyCross =
      url.hostname === 'open.larksuite.com' &&
      ((segments.length === 3 && segments.slice(0, 2).join('/') === 'anycross/trigger') ||
        (segments.length === 4 &&
          segments.slice(0, 3).join('/') === 'anycross/trigger/callback'));
    const isBaseAutomation =
      /^[a-z0-9-]+\.jp\.larksuite\.com$/.test(url.hostname) &&
      segments.length === 5 &&
      segments.slice(0, 4).join('/') === 'base/automation/webhook/event';
    return (isAnyCross || isBaseAutomation) && Boolean(segments.at(-1));
  } catch {
    return false;
  }
}

export type UTMParams = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_creative?: string;
  utm_content?: string; // Meta広告(v3): CR台帳のCR-ID固定値（例 CR-2608-30）。広告名ではない
  utm_id?: string; // Meta広告(v3): {{ad.id}}（広告ID）
};

type CoupangSubmission = CoupangFormData & {
  utmParams?: UTMParams;
  metaEventId?: string;
  /** 応募単位の安定ID。Base upsertと広告CAPIの重複排除に共用する。 */
  submissionId?: string;
  /** ChatGPT広告のクリック識別子。Baseには保存せずOpenAI CAPIだけに使う。 */
  oppref?: string;
  /** HEALTH_CHECK_TOKENで認証した本番E2E専用。 */
  testMode?: boolean;
  /** 応募確定時のブラウザURL。Referer が短縮・欠落する環境の保険。 */
  pageUrl?: string;
  /** サイト内回遊前の最初の着地パス。 */
  landingPath?: string;
  /** 着地時点の referrer。 */
  initialReferrer?: string;
  /** 送信したUTMをどこから復元したか。 */
  attributionSource?: 'query' | 'click_id' | 'cookie' | 'referrer' | 'direct';
};

const META_SOURCE_NAMES: Record<string, string> = {
  meta: 'Meta',
  fb: 'Facebook',
  facebook: 'Facebook',
  ig: 'Instagram',
  instagram: 'Instagram',
  th: 'Threads',
  threads: 'Threads',
  msg: 'Messenger',
  messenger: 'Messenger',
};

const META_AD_MEDIUMS = new Set(['ad', 'cpc', 'ads', 'paid', 'search']);

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // JSONオブジェクトは独自toStringを持ち得る。String(value)自体がthrowする入力もあるため捨てる。
  return '';
};

/** 応募者入力で通知行の偽装やLarkのat記法を成立させない。 */
function larkLineText(value: unknown, fallback = '未取得'): string {
  const normalized = text(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

/**
 * LIFT JOBフォームの8桁生年月日を、Lark Baseの年齢計算式が解釈できる表記へ揃える。
 * 既に区切り文字付きで届いた旧クライアントの値も同じ形式へ正規化する。
 */
export function formatLiftJobBirthDate(value: unknown): string {
  const raw = text(value);
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  const separated = raw.match(/^(\d{4})([-/.])(\d{2})\2(\d{2})$/);
  const yearText = compact?.[1] ?? separated?.[1];
  const monthText = compact?.[2] ?? separated?.[3];
  const dayText = compact?.[3] ?? separated?.[4];
  if (!yearText || !monthText || !dayText) return '';

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }

  return `${yearText}/${monthText}/${dayText}`;
}

/** リクエスト/Cookie由来の値は型注釈を信用せず、サーバー境界で文字列へ正規化する。 */
function normalizeUtmParams(value: unknown): UTMParams {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    utm_source: text(input.utm_source),
    utm_medium: text(input.utm_medium),
    utm_campaign: text(input.utm_campaign),
    utm_term: text(input.utm_term),
    utm_creative: text(input.utm_creative),
    utm_content: text(input.utm_content),
    utm_id: text(input.utm_id),
  };
}

function pathnameFromUrl(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return '';
  }
}

/** opprefはOpenAI CAPI専用。通知・BaseのLP URLへ重複保存しない。 */
function withoutOppref(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.delete('oppref');
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * LIFT JOBの通知に出す流入経路。キャンペーンはMeta配信だが、
 * {{site_source_name}} で取れる配置（fb / ig / threads / messenger）は潰さない。
 * UTMが無い場合に「RIDEJOB HP」や「Meta広告」と推測で埋めると集計を汚すため、
 * 取得できなかった事実を明示する。
 */
export function describeLiftJobRoute(utm: UTMParams = {}): string {
  const source = text(utm.utm_source).toLowerCase();
  const medium = text(utm.utm_medium).toLowerCase();
  if (!source) return '経路不明（UTM未取得）';
  const platform = META_SOURCE_NAMES[source];
  if (platform) {
    if (!medium) return `${platform}（流入区分未取得）`;
    return `${platform}${META_AD_MEDIUMS.has(medium) ? '広告' : ''}（${medium}）`;
  }
  const label = getMediaName(utm);
  return medium ? `${label}（${medium}）` : label;
}

/** Baseの媒体別集計用の大分類。配置の詳細は utm_source に保存する。 */
export function getLiftJobMediaName(utm: UTMParams = {}): string {
  const source = text(utm.utm_source).toLowerCase();
  const medium = text(utm.utm_medium).toLowerCase();
  if (!source) return '経路不明';
  if (META_SOURCE_NAMES[source] && META_AD_MEDIUMS.has(medium)) return 'Meta広告';
  return getMediaName(utm);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return '';
}

export function buildLiftJobNotification(params: {
  utm: UTMParams;
  pageUrl: string;
  email?: string;
  fullName?: string;
  fullNameKana?: string;
  phoneNumber?: string;
  jobPositionLabel: string;
  desiredLocationLabel: string;
  ageLabel: string;
  birthDateLabel: string;
  isTest?: boolean;
}): string {
  const { utm } = params;
  return `
${params.isTest ? '【E2Eテスト・実応募ではありません】\n' : ''}LIFT JOB（ロケットナウ）の応募がありました！
-------------------------
	流入経路: ${larkLineText(describeLiftJobRoute(utm))}
	キャンペーンID: ${larkLineText(utm.utm_campaign)}
	広告セットID: ${larkLineText(utm.utm_term)}
	CR-ID: ${larkLineText(utm.utm_content)}
	広告ID: ${larkLineText(utm.utm_id)}
	広告名: ${larkLineText(utm.utm_creative)}
	LP: ${larkLineText(params.pageUrl)}
	メールアドレス: ${larkLineText(params.email, '未入力')}
	氏名（漢字）: ${larkLineText(params.fullName, '未入力')}
	氏名（ふりがな）: ${larkLineText(params.fullNameKana, '未入力')}
	電話番号: ${larkLineText(params.phoneNumber, '未入力')}
	希望職種: ${larkLineText(params.jobPositionLabel, '未入力')}
	希望勤務地: ${larkLineText(params.desiredLocationLabel, '未入力')}
	年齢: ${larkLineText(params.ageLabel, '未入力')}
	生年月日: ${larkLineText(formatLiftJobBirthDate(params.birthDateLabel), '未入力')}
-------------------------
  `.trim();
}

export function buildLiftJobBasePayload(params: {
  utm: UTMParams;
  adId: string;
  adCreativeId: string;
  adImageUrl: string;
  formData: CoupangFormData;
  jobPositionLabel: string;
  desiredLocationLabel: string;
  pageUrl: string;
  landingPath: string;
  initialReferrer: string;
  attributionSource: CoupangSubmission['attributionSource'];
  userAgent: string;
  clientIp: string;
  submittedAt: string;
  submissionId: string;
  environment?: string;
}): Record<string, unknown> {
  // 共通resolverはUTMなしをRIDEJOB HPとみなすが、LIFT JOBは別サービス・別Base。
  // 推測でRIDEJOBへ寄せず、sourceを実測できたときだけマスタ名候補を送る。
  const applicationSource = text(params.utm.utm_source)
    ? resolveApplicationSourceMasterName(params.utm)
    : undefined;
  return {
    media_name: getLiftJobMediaName(params.utm),
    application_source: applicationSource || '',
    utm_source: text(params.utm.utm_source),
    utm_medium: text(params.utm.utm_medium),
    utm_campaign: text(params.utm.utm_campaign),
    utm_term: text(params.utm.utm_term),
    utm_creative: text(params.utm.utm_creative),
    utm_content: text(params.utm.utm_content),
    utm_id: text(params.utm.utm_id),
    ad_id: params.adId,
    ad_creative_id: params.adCreativeId,
    ad_image_url: params.adImageUrl,
    email: params.formData.email || '',
    full_name: params.formData.fullName || '',
    full_name_kana: params.formData.fullNameKana || '',
    phone_number: params.formData.phoneNumber || '',
    job_position: params.jobPositionLabel,
    desired_location: params.desiredLocationLabel,
    age: params.formData.age || '',
    birth_date: formatLiftJobBirthDate(params.formData.birthDate),
    submitted_at: params.submittedAt,
    submission_id: params.submissionId,
    environment: params.environment,
    user_agent: params.userAgent,
    client_ip: params.clientIp,
    form_origin: 'coupang_rocketnow',
    is_coupang: true,
    page_url: params.pageUrl,
    landing_path: params.landingPath,
    initial_referrer: params.initialReferrer,
    attribution_source: params.attributionSource || 'direct',
  };
}

export function buildLiftJobDirectBaseFields(
  payload: Record<string, unknown>,
): Record<string, LarkFieldValue | undefined> {
  const applicationSource = text(payload.application_source);
  const submittedAt = text(payload.submitted_at);
  const submittedAtMs = Date.parse(submittedAt);
  return {
    '求職者名': text(payload.full_name),
    'フリガナ': text(payload.full_name_kana),
    '電話番号': text(payload.phone_number),
    'メールアドレス': text(payload.email),
    '生年月日': text(payload.birth_date),
    'マスタ-応募職種': text(payload.job_position),
    '希望勤務地': text(payload.desired_location),
    '応募経由(マスタ連動)': applicationSource ? [applicationSource] : undefined,
    '流入媒体（自動判定）': text(payload.media_name),
    '応募日': Number.isFinite(submittedAtMs) ? submittedAtMs : undefined,
    'utm_source': text(payload.utm_source),
    'utm_medium': text(payload.utm_medium),
    'utm_campaign': text(payload.utm_campaign),
    'utm_term': text(payload.utm_term),
    'utm_content': text(payload.utm_content),
    'utm_creative': text(payload.utm_creative),
    'utm_id': text(payload.utm_id),
    'ad_id': text(payload.ad_id),
    'ad_creative_id': text(payload.ad_creative_id),
    'ad_image_url': text(payload.ad_image_url),
    'page_url': text(payload.page_url),
    'landing_path': text(payload.landing_path),
    'initial_referrer': text(payload.initial_referrer),
    'attribution_source': text(payload.attribution_source),
    'submission_id': text(payload.submission_id),
    'ステータス': '応募者',
  };
}


export async function POST(request: NextRequest) {
  try {
    const submissionData = (await request.json()) as CoupangSubmission;
    const {
      utmParams: submittedUtmParams,
      metaEventId,
      submissionId: submittedSubmissionId,
      oppref: submittedOppref,
      testMode: requestedTestMode,
      pageUrl: submittedPageUrl,
      landingPath: submittedLandingPath,
      initialReferrer: submittedInitialReferrer,
      attributionSource,
      ...formData
    } = submissionData;
    const isTestMode = requestedTestMode === true;
    if (isTestMode) {
      const expected = process.env.HEALTH_CHECK_TOKEN || '';
      const provided = request.headers.get('x-e2e-token') || '';
      if (!expected || provided !== expected) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
    }
    if (!formatLiftJobBirthDate(formData.birthDate)) {
      return NextResponse.json({ message: 'Invalid birthDate' }, { status: 400 });
    }
    const utmParams = normalizeUtmParams(submittedUtmParams);
    const submissionId = firstText(submittedSubmissionId, metaEventId).slice(0, 128);
    if (!submissionId) {
      return NextResponse.json({ message: 'submissionId is required' }, { status: 400 });
    }
    const oppref = text(submittedOppref).slice(0, 2048) || undefined;
    const requestReferer = request.headers.get('referer') || '';
    const pageUrl = withoutOppref(firstText(submittedPageUrl, requestReferer, COUPANG_EVENT_SOURCE_URL));
    const landingPath = firstText(submittedLandingPath, pathnameFromUrl(pageUrl), BASE_PATH ? '/entry/coupang' : '/coupang');
    const initialReferrer = firstText(submittedInitialReferrer);

    // 環境判定
    const isProduction = process.env.NODE_ENV === 'production';
    const sendBaseOnly = process.env.LARK_SEND_BASE_ONLY === 'true';

    // Webhook URL取得（既存のCoupang用URL使用）
    const larkWebhookUrl = isProduction
      ? process.env.LARK_WEBHOOK_URL_COUPANG_PROD || process.env.LARK_WEBHOOK_URL_COUPANG
      : process.env.LARK_WEBHOOK_URL_COUPANG_TEST || process.env.LARK_WEBHOOK_URL_COUPANG;

    const baseWebhookUrl = isProduction
      ? process.env.LARK_BASE_WEBHOOK_URL_COUPANG_PROD || process.env.LARK_BASE_WEBHOOK_URL_COUPANG
      : process.env.LARK_BASE_WEBHOOK_URL_COUPANG_TEST || process.env.LARK_BASE_WEBHOOK_URL_COUPANG;

    const directBaseConfigured = isLarkBaseConfigured('liftjob');

    /** Base に入らなかった応募を Supabase の退避先に残せたか */
    let vaultSaved = false;

    // LIFT JOBは通知とBase保存がどちらも必須。誤設定URLへ応募者情報を送らない。
    //
    // ⚠️ 2026-09-24: ここは Base 保存より手前。素の 500 で返すと応募内容はどこにも残らない
    // （2026-09-17〜24 の障害と同じ型）。設定漏れは無音でデプロイされるので、
    // 退避に残せたなら応募者には再送させない（再送は重複を増やすだけ）。
    //
    // ⚠️ 既知の規約差: この経路は退避して即 return するので **Lark 通知を試さない**。
    // applicants / submit-application は「Base が全滅しても通知は出す」なので、そちらに
    // 揃えるには通知処理（:700 以降）まで到達させる必要がある。退避先の env を入れたあと、
    // 別 PR で統一すること（それまでは vault の `notified:false` 行が唯一の記録）。
    const bailWithVault = async (reason: string) => {
      console.error(reason);
      // source は後段の退避・markSubmissionVaultNotified と同じ値にする。
      // 揃っていないと同一 submissionId で source 違いの行ができ、通知済みマークも当たらない。
      const saved = await saveToSubmissionVault({
        source: 'form_applicant/coupang',
        kind: 'application',
        submissionId,
        profile: 'liftjob',
        reason,
        notified: false,
        payload: submissionData as unknown as Record<string, unknown>,
      });
      return saved
        ? NextResponse.json({ message: 'Application submitted successfully!' })
        : NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    };
    if (!directBaseConfigured && (!baseWebhookUrl || !isAllowedLarkWebhookUrl(baseWebhookUrl, 'base'))) {
      return bailWithVault('Lark Base Webhook URL is missing or invalid for Coupang.');
    }
    // 通知先が無いことと、応募を保存できないことは別。Base が生きているなら
    // 通知の設定漏れだけで Base への保存まで捨てない
    // （applicants ルートにも同じ規約を入れる = PMAgent-dev-new/form_applicant#96。まだ未マージ）。
    // ここへ来る時点で Base 経路は生きている（上の分岐で bail 済み）。
    // 後続の通知処理は notifyWebhookUrl の有無でガード済み。
    if (!sendBaseOnly && (!larkWebhookUrl || !isAllowedLarkWebhookUrl(larkWebhookUrl, 'notification'))) {
      const reason = 'Lark Webhook URL is missing or invalid for Coupang.';
      console.error(`${reason} / Base への保存は続行する`);
      vaultSaved = await saveToSubmissionVault({
        source: 'form_applicant/coupang',
        kind: 'application',
        submissionId,
        profile: 'liftjob',
        reason: `${reason} (Base への保存は続行)`,
        notified: false,
        payload: submissionData as unknown as Record<string, unknown>,
      });
    }
    // base-only モードでは上の検証を通らないが、Base 保存が全滅したときはこの URL へ
    // フォールバック通知を出す。allowlist を通らない URL へ応募者情報を送らないよう、
    // 実際に使う値をここで1度だけ検証しておく（通常モードでは上の検証と同じ結果になる）。
    const notifyWebhookUrl =
      larkWebhookUrl && isAllowedLarkWebhookUrl(larkWebhookUrl, 'notification') ? larkWebhookUrl : '';

    const fallbackJobPositionMap = JOB_POSITION_LABELS as Record<string, string>;
    const fallbackLocationMap = LOCATION_LABELS as Record<string, string>;

    // ラベル変換。
    // 現行フォームは**日本語ラベルをそのまま value として送る**（jobPosition は
    // COUPANG_FIXED_JOB_POSITION 固定、desiredLocation は GAS 由来の日本語値を
    // `{ value, label: value }` で選択肢にしている）。したがって値はそのまま通せばよい。
    // JOB_POSITION_LABELS / LOCATION_LABELS は旧スラッグ（field_sales / tokyo）を
    // 送ってくる古いクライアント用のフォールバックとしてのみ残す。
    //
    // ⚠️ ここで GAS の step1-options を引いて突き合わせていたが、投稿値が既に最終ラベルなので
    // `find()` は恒等一致にしかならず、ラベルに一切寄与していなかった。
    // その一方で GAS は実測 5〜68秒かかり 404 を返す日もあり（2026-09-10 実測）、
    // **応募者をその秒数だけ待たせていた**ため、POST 経路からは外した。
    // 選択肢マスタの取得は LP 側の `/api/coupang/step1-options` が担っており、そちらは変えていない。
    const jobPositionLabel = formData.jobPosition
      ? (fallbackJobPositionMap[formData.jobPosition] || formData.jobPosition)
      : '未選択';
    const desiredLocationLabel = formData.desiredLocation
      ? (fallbackLocationMap[formData.desiredLocation] || formData.desiredLocation)
      : '未選択';
    const ageLabel = formData.age ? `${formData.age}歳` : '未選択';
    const birthDateLabel = formData.birthDate || '未入力';

    // Meta広告の広告ID(ad.id)から広告画像URLを解決する（Coupangは常にMeta流入）。
    // 入稿URLの utm_id={{ad.id}} を優先。後方互換で utm_content / utm_creative が数値なら ad.id とみなす。
    // ※ v3では utm_content は CR-ID（非数値）、utm_term は {{adset.id}} のため ad.id には使わない。
    //   （数値判定なので CR-ID を ad.id と誤認することはない）
    const adId = isLikelyAdId(utmParams?.utm_id)
      ? (utmParams?.utm_id as string)
      : isLikelyAdId(utmParams?.utm_content)
        ? (utmParams?.utm_content as string)
        : isLikelyAdId(utmParams?.utm_creative)
          ? (utmParams?.utm_creative as string)
          : '';
    let adImageUrl = '';
    let adCreativeId = '';
    if (adId) {
      const resolved = await resolveAdImageUrl(adId);
      if (resolved) {
        adImageUrl = resolved.imageUrl || '';
        adCreativeId = resolved.creativeId || '';
      }
      console.log('Resolved Meta ad image (coupang):', { adId, adImageUrl: adImageUrl ? '(取得済)' : '(なし)', adCreativeId });
    }

    const userAgent = request.headers.get('user-agent') || '';
    const clientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
    const basePayload = buildLiftJobBasePayload({
      utm: utmParams,
      adId,
      adCreativeId,
      adImageUrl,
      formData,
      jobPositionLabel,
      desiredLocationLabel,
      pageUrl,
      landingPath,
      initialReferrer,
      attributionSource,
      userAgent,
      clientIp,
      submittedAt: new Date().toISOString(),
      submissionId,
      environment: process.env.NODE_ENV,
    });

    // Baseは先に確定する。専用資格情報があればsubmission_idで直接upsertし、
    // 未設定の旧環境だけAutomation Webhookへフォールバックする。
    let baseRecordId = '';
    let notificationAlreadySent = false;
    let notificationInProgress = false;
    /** 直書き・Webhook ともに失敗したときの理由。応募は通すが通知に印を付ける。 */
    let baseSaveFailed = '';
    try {
      if (directBaseConfigured) {
        let saved = await upsertBaseRecordByTextField(
          LIFTJOB_TABLE_ID,
          'submission_id',
          submissionId,
          buildLiftJobDirectBaseFields(basePayload),
          'liftjob',
          'is',
          false,
        );
        baseRecordId = saved.recordId;
        notificationAlreadySent = saved.previousFields['Lark通知送信済み'] === true;
        // 同時送信の作成競合では、敗者が先着の通知済み更新を短時間待つ。
        // Webhook通知にはuuid重複排除が無いため、処理中のままなら送信せず再試行を促す。
        if (!saved.created && !notificationAlreadySent) {
          for (let attempt = 0; attempt < 12 && !notificationAlreadySent; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            saved = await upsertBaseRecordByTextField(
              LIFTJOB_TABLE_ID,
              'submission_id',
              submissionId,
              buildLiftJobDirectBaseFields(basePayload),
              'liftjob',
              'is',
              false,
            );
            notificationAlreadySent = saved.previousFields['Lark通知送信済み'] === true;
          }
          const submittedAt = Number(saved.previousFields['応募日']);
          notificationInProgress = !notificationAlreadySent
            && (!Number.isFinite(submittedAt) || Date.now() - submittedAt < 30_000);
        }
        console.log('[coupang] Lark Base direct upsert succeeded', {
          recordId: saved.recordId,
          created: saved.created,
        });
      } else if (baseWebhookUrl) {
        const resp = await fetch(baseWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(basePayload),
          signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
        });
        const result = (await resp.json().catch(() => ({}))) as LarkWebhookResult;
        if (!resp.ok || !isLarkAccepted(result)) {
          throw new Error(
            `http=${resp.status} code=${result.code ?? result.StatusCode ?? 'n/a'} msg=${result.msg ?? result.StatusMessage ?? 'n/a'}`,
          );
        }
        console.log('[coupang] Lark Base webhook triggered successfully');
      }
    } catch (error) {
      // ⚠️ 500 を返さない。この行より後ろに Lark通知・確認メール・SMS・CAPI が全部ある。
      // RIDE JOB 側（applicants/route.ts）では同型の分岐で応募が5日間失われた（2026-09-17〜09-23）。
      // Base に入らなくても通知だけは必ず出す。
      baseSaveFailed = describeError(error);
      console.error('[coupang] Lark Base save failed; 通知は継続する:', `submission=${submissionId} ${baseSaveFailed}`);
      // Lark に入らなかった応募を構造化して退避する（応募の成否には影響させない）。
      vaultSaved = await saveToSubmissionVault({
        source: 'form_applicant/coupang',
        kind: 'application',
        submissionId,
        profile: 'liftjob',
        reason: baseSaveFailed,
        notified: false,
        payload: basePayload,
      });
    }

    if (sendBaseOnly && !baseSaveFailed) {
      console.log('[coupang] submission settled:', {
        mode: 'base-only',
        directBaseConfigured,
        baseRecordId: baseRecordId || undefined,
      });
      return NextResponse.json(
        { message: 'Application submitted successfully!', ...(isTestMode ? { baseRecordId } : {}) },
        { status: 200 },
      );
    }

    // 不変条件: Base 保存が全滅したうえ通知先も無いなら、応募はどこにも残らない。
    // 200 を返すと応募者は「送信できた」と思って離脱し、こちらは応募があったことすら分からない。
    if (baseSaveFailed && !notifyWebhookUrl && !vaultSaved) {
      console.error(
        '[coupang] 応募をどこにも記録できない（Base保存が失敗し、通知先も退避先も無い）:',
        `submission=${submissionId} ${baseSaveFailed}`,
      );
      return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }

    if (notificationInProgress) {
      console.warn('[coupang] Duplicate submission is still being processed', { submissionId });
      return NextResponse.json(
        { message: 'Application is still being processed; retry shortly' },
        { status: 503 },
      );
    }

    /** Lark 通知を出せたか */
    let notified = false;
    const tasks: Promise<void>[] = [];
    const taskFailures: string[] = [];
    const markFailed = (label: string) => {
      if (!taskFailures.includes(label)) taskFailures.push(label);
    };
    const trackTask = (label: string, run: () => Promise<unknown>): Promise<void> =>
      Promise.resolve()
        .then(run)
        .then(
          () => undefined,
          (error: unknown) => {
            markFailed(label);
            const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            const cause = error instanceof Error && error.cause
              ? ` cause=${String((error.cause as { code?: string })?.code ?? error.cause)}`
              : '';
            console.error(`[coupang] ${label} failed: ${detail}${cause}`);
          },
        );

    // Base upsertが冪等なので、通知失敗は500にして同じsubmission_idで安全に再送できる。
    if (notifyWebhookUrl && !notificationAlreadySent) {
      const messageContent = buildLiftJobNotification({
        utm: utmParams,
        pageUrl,
        email: formData.email,
        fullName: formData.fullName,
        fullNameKana: formData.fullNameKana,
        phoneNumber: formData.phoneNumber,
        jobPositionLabel,
        desiredLocationLabel,
        ageLabel,
        birthDateLabel,
        isTest: isTestMode,
      });
      // Base に保存できなかった応募は、この通知が唯一の記録になる。手入力が要ることを先頭で示す。
      const notificationText = baseSaveFailed
        ? `⚠️Base未登録（${vaultSaved ? '退避済み・要取り込み' : '退避も失敗・この通知が唯一の記録'}）\n${messageContent}`
        : messageContent;
      try {
        const resp = await fetch(notifyWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ msg_type: 'text', content: { text: notificationText } }),
          signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
        });
        const result = (await resp.json().catch(() => ({}))) as LarkWebhookResult;
        if (!resp.ok || !isLarkAccepted(result)) {
          throw new Error(
            `http=${resp.status} code=${result.code ?? result.StatusCode ?? 'n/a'} msg=${result.msg ?? result.StatusMessage ?? 'n/a'}`,
          );
        }
        console.log('[coupang] Lark notification sent successfully');
        if (baseRecordId) {
          try {
            await updateBaseRecord(
              LIFTJOB_TABLE_ID,
              baseRecordId,
              { 'Lark通知送信済み': true },
              'liftjob',
            );
          } catch (error) {
            // 通知は既に受理済み。ここで500にするとブラウザ再送で同じ通知を重複させる。
            markFailed('lark-notification-state');
            console.error('[coupang] Lark notification state update failed after successful send:', `submission=${submissionId} ${describeError(error)}`);
          }
        }
        notified = true;
      } catch (error) {
        // ⚠️ 500 を返さない。応募者に「エラーが発生しました」が出て再送し、
        // 冪等性の無い Webhook 経路で重複が増える（RIDE JOB 側で実際に起きた）。
        // 応募が Base に残っているなら、通知の失敗は応募者に転嫁しない。
        console.error('[coupang] Lark通知に失敗（応募は記録済み）:', `submission=${submissionId} ${describeError(error)}`);
        vaultSaved = await saveToSubmissionVault({
          source: 'form_applicant/coupang',
          kind: 'application',
          submissionId,
          profile: 'liftjob',
          reason: `Lark通知に失敗: ${describeError(error)}`,
          notified: false,
          payload: basePayload,
        }) || vaultSaved;
      }
    } else if (notificationAlreadySent) {
      console.log('[coupang] Lark notification already sent; skipping duplicate', { submissionId });
    }

      // 自動返信メール — 非致命。クーパン専用の文面(COUPANG_CONTENT)を使う。
      // 共通ルートの実行時リスト SUPPORTED_ORIGINS は経由しない（専用ルートからの直接呼び出し）。
      //
      // ⚠️ **既定OFF。** `COUPANG_EMAIL_ENABLED=true` で点火する。
      // 文面はクライアント・運用側の確認待ちで、確認前にマージ＝自動デプロイされると
      // その瞬間から実送信が始まってしまう。既存の ENABLE_EMAIL_NOTIFICATION は
      // 全職種共通のグローバルスイッチで、止めるとタクシー・整備士の稼働中メールまで
      // 道連れになるため、クーパン単体で止められる口をここに用意する。
      if (!isTestMode && formData.email && process.env.COUPANG_EMAIL_ENABLED === 'true') {
        const recipientEmail = formData.email;
        tasks.push(
          trackTask('confirmation-email', async () => {
            const result = await sendApplicationConfirmationEmail({
              to: recipientEmail,
              applicantName: formData.fullName || '',
              applicantNameKana: formData.fullNameKana,
              phoneNumber: formData.phoneNumber,
              email: recipientEmail,
              formOrigin: 'coupang',
            });
            if (result.sent) {
              console.log('Confirmation email sent:', { messageId: result.messageId, formOrigin: 'coupang' });
            } else if (result.reason === 'error') {
              markFailed('confirmation-email');
              console.error('Confirmation email failed:', { error: result.error, formOrigin: 'coupang' });
            } else {
              console.log('Confirmation email skipped:', { reason: result.reason, formOrigin: 'coupang' });
            }
          })
        );
      }

      // 面談予約リンクのSMS — 非致命。文面と予約リンク先は eeasy(leomeet) 側が持つ。
      // media は共通ルートと同じ正規化（生の utm_source を渡すと eeasy 側の表記が揃わない）。
      //
      // ⚠️ **既定OFF。** eeasy 側に 'coupang' チャネルを登録し、その文面と
      // 予約リンク(`/book/cpj`)を確認してから `COUPANG_SMS_ENABLED=true` で点火する。
      // 未登録のまま送ると、eeasy 側が既定チャネルへフォールバックする実装だった場合に
      // **営業職の応募者へタクシー転職の文面が届く**（応募者から見える誤送信）。
      // こちら側からは eeasy の挙動を検証できないため、確認を人手のゲートにする。
      if (!isTestMode && formData.phoneNumber && process.env.COUPANG_SMS_ENABLED === 'true') {
        const media = (utmParams?.utm_source || 'form').toLowerCase().slice(0, 32);
        tasks.push(
          trackTask('application-sms', async () => {
            const r = await sendApplicationSms({
              channel: 'coupang',
              phone: formData.phoneNumber,
              applicantName: formData.fullName,
              media,
            });
            if (r.sent) {
              console.log('Application SMS sent:', { order: r.deliveryOrderId, ref: r.ref, channel: 'coupang', media });
            } else if (r.reason === 'disabled' || r.reason === 'dry_run' || r.reason === 'no_phone') {
              // 意図的にスキップした場合だけ info。それ以外は無言不達になりうるので error。
              console.log('Application SMS skipped:', { reason: r.reason, channel: 'coupang', media });
            } else {
              markFailed('application-sms');
              console.error('Application SMS not delivered:', { reason: r.reason, error: r.error, channel: 'coupang', media });
            }
          })
        );
      }

      // Meta Conversions API（Lead）— 非致命。eventId が無ければスキップ
      if (!isTestMode && isMetaAdsAttribution(utmParams)) {
        const capiUserAgent = request.headers.get('user-agent') || '';
        const capiClientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
        // クロージャに入ると typeof による絞り込みが効かないので、ここで確定させる。
        const capiEventId = submissionId;
        tasks.push(
          trackTask('meta-capi', async () => {
            const result = await sendMetaCapiLead({
              eventId: capiEventId,
              // referer が取れない場合でも website イベントとして成立させる。
              eventSourceUrl: requestReferer || pageUrl || COUPANG_EVENT_SOURCE_URL,
              contentName: COUPANG_META_CONTENT_NAME,
              // dedup 後に残るのは通常サーバー側なので、Pixel と同じ value/currency を持たせる。
              value: 0,
              currency: 'JPY',
              email: formData.email,
              phone: formData.phoneNumber,
              fbp: request.cookies.get('_fbp')?.value,
              fbc: request.cookies.get('_fbc')?.value,
              clientIpAddress: capiClientIp || undefined,
              clientUserAgent: capiUserAgent || undefined,
            });
            if (!result.ok) throw new Error(`status=${result.status ?? 'unknown'}`);
          })
        );
      }

      // ChatGPT広告 Conversions API。opprefがある応募だけを送り、E2Eではvalidate-onlyにする。
      if (oppref && isOpenAiAdsAttribution(utmParams)) {
        tasks.push(
          trackTask('openai-capi', async () => {
            const result = await sendOpenAiConversion({
              eventId: submissionId,
              oppref,
              sourceUrl: pageUrl || COUPANG_EVENT_SOURCE_URL,
              validateOnly: isTestMode,
            });
            if (!result.ok) {
              throw new Error(`status=${result.status ?? 'unknown'} skipped=${result.skipped ?? 'none'}`);
            }
          }),
        );
      }

      await Promise.allSettled(tasks);

    if (vaultSaved && notified) {
      await markSubmissionVaultNotified('form_applicant/coupang', submissionId);
    }

    // 不変条件: Base・通知・退避のどれか1つに残ったときだけ 200。
    // どこにも残っていないなら 200 にしてはいけない（応募者は送信できたと思って離脱する）。
    if (baseSaveFailed && !notified && !vaultSaved) {
      console.error(
        '[coupang] 応募をどこにも記録できなかった（Base保存・Lark通知・退避のすべてが失敗）:',
        `submission=${submissionId} ${baseSaveFailed}`,
      );
      return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }

      if (isTestMode && oppref && taskFailures.includes('openai-capi')) {
        return NextResponse.json(
          { message: 'OpenAI validation failed', baseRecordId, failed: taskFailures },
          { status: 502 },
        );
      }

      // 応募1件につき必ず1行出す。無言で壊れていることを検知するための足跡。
      console.log('[coupang] submission settled:', {
        mode: 'full',
        tasks: tasks.length + 1,
        failed: taskFailures,
        larkWebhookConfigured: Boolean(larkWebhookUrl),
        directBaseConfigured,
        baseWebhookConfigured: Boolean(baseWebhookUrl),
        emailEnabled: !isTestMode && process.env.COUPANG_EMAIL_ENABLED === 'true',
        smsEnabled: !isTestMode && process.env.COUPANG_SMS_ENABLED === 'true',
      });

    return NextResponse.json(
      {
        message: 'Application submitted successfully!',
        ...(isTestMode ? { baseRecordId, failed: taskFailures } : {}),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('Error processing Coupang application:', describeError(error));
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
