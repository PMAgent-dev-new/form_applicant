import { NextRequest, NextResponse } from 'next/server';
import type { FormData } from '@/app/components/application-form/types';
import { mapJobTimingLabel } from '@/app/components/application-form/utils/mapJobTimingLabel';
import { getMechanicQualificationFieldLabel, mapMechanicQualifications, mapMechanicQualificationToBaseOptions } from '@/app/components/application-form/utils/mapMechanicQualifications';
import { mapDesiredIncomeLabel } from '@/app/components/application-form/utils/mapDesiredIncomeLabel';
import { mapTruckLicenses, mapTruckLicensesToBaseOptions } from '@/app/components/application-form/utils/mapTruckLicenses';
import {
  isSupportedEmailOrigin,
  sendApplicationConfirmationEmail,
} from '@/lib/email/send-application-confirmation';
import { sendApplicationSms } from '@/lib/sms/send-application-sms';
import { describeMedia, getMediaName } from '@/lib/media-name';
import {
  resolveApplicationSourceMasterName,
  resolveJobCategoryMasterName,
} from '@/lib/lark-masters';
import { resolveAdImageUrl, isLikelyAdId } from '@/lib/meta/resolveAdImage';
import { sendMetaCapiLead } from '@/lib/meta/capi';
import { sendOpenAiConversion } from '@/lib/openai/capi';
import {
  createBaseRecord,
  isLarkBaseConfigured,
  sendLarkTextMessage,
  updateBaseRecord,
  upsertBaseRecordByTextField,
  type LarkFieldValue,
  type LarkLinkedRecordName,
  type LarkProfile,
} from '@/lib/larkBase';
import { assessCatalogTouch, type CatalogAttributionStatus } from '@/lib/catalog-attribution';
import { isMetaCatalogJob } from '@/lib/catalog-eligibility';
import { fetchJobById } from '@/lib/microcms';
import { describeError } from '@/lib/describe-error';
import { findRecentRecordByPhone } from '@/lib/larkBase';
import { markSubmissionVaultNotified, saveToSubmissionVault } from '@/lib/submissionVault';
import { neutralizeLarkTags } from '@/lib/lark-text';

// Bitable 直書きの投入先テーブル（env で上書き可）。
//   default / bus       → 求職者DB🚕   （ridejob base：APP_*_RIDEJOB）
//   mechanic / newgrad  → 求職者DB👷‍♂️  （mechanic base：APP_*_MECHANIC・既存流用）
// ※ coupang は今回対象外（従来どおり Base Webhook 送信）。
const RIDEJOB_TABLE_ID = process.env.LARK_BASE_TABLE_ID_RIDEJOB || 'tblO0pPqFyHqpVcj';
const MECHANIC_TABLE_ID = process.env.LARK_BASE_TABLE_ID_MECHANIC_APPLICANTS || 'tblXcvtQJqoD2PIV';
const LARK_FETCH_TIMEOUT_MS = 5000;
/**
 * Base Webhook フォールバックで「同じ電話番号なら同じ応募」とみなす時間窓。
 * 送信ボタンの連打・再読み込みによる再送を束ねるのが目的で、
 * **Lark IM の uuid 重複排除（1時間・larkBase.ts の sendLarkTextMessage）に合わせている。**
 * ここを短くすると、窓の外・IMの窓の内（例: T+40分）の再送で
 * 「Base には新しい行ができるのに通知は重複排除されて出ない」＝誰も気づかない行が生まれる。
 * 2つの窓は揃えること。
 */
const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;

type LarkWebhookResult = {
  code?: number | string;
  msg?: string;
  StatusCode?: number | string;
  StatusMessage?: string;
};

const isZeroCode = (value: number | string | undefined): boolean =>
  typeof value === 'number'
    ? value === 0
    : typeof value === 'string' && value.trim() !== '' && Number(value) === 0;

const isNonZeroCode = (value: number | string | undefined): boolean =>
  typeof value === 'number'
    ? value !== 0
    : typeof value === 'string' && value.trim() !== '' && Number(value) !== 0;

/** Lark Bot / AnyCross はHTTP 200でも本文で失敗を返すため、明示的な成功コードまで確認する。 */
const isLarkAccepted = (result: LarkWebhookResult): boolean =>
  (isZeroCode(result.code) || isZeroCode(result.StatusCode))
  && !isNonZeroCode(result.code)
  && !isNonZeroCode(result.StatusCode);

// Bitable 直書きに必要な、リクエスト内で算出済みの値をまとめたもの。
export type BaseWriteContext = {
  isMechanic: boolean;
  isMechanicNewgrad: boolean;
  isCoupang: boolean;
  isTruck: boolean;
  isBus: boolean;
  // タクシーLP（`/`・`/taxi`・`/people-b`）からの応募。formOrigin が明示的に 'default' のときだけ true。
  // default は formOrigin 未指定時のフォールバックも兼ねるため、推測では立てない。
  isTaxi: boolean;
  truckLicensesLabel: string;
  mediaName: string;
  utm: UTMParams;
  adId: string;
  adCreativeId: string;
  adImageUrl: string;
  form: ApplicantFormData;
  jobTimingLabel: string;
  jobIntentLabel: string;
  desiredIncomeLabel: string;
  mechanicQualificationsLabel: string;
  qualificationFieldLabel: string;
  pageUrl: string;
  submittedAtMs: number; // 応募日（DateTime）用 epoch ms
  submissionId: string;
  appliedJobId?: string;
  catalogJobId?: string;
  catalogJobName?: string;
  catalogClickedAtMillis?: number;
  catalogAttributionStatus?: CatalogAttributionStatus;
};

const submissionMarker = (submissionId: string): string => `[submission_id:${submissionId}]`;
const notificationMarker = (submissionId: string): string => `[lark_notified:${submissionId}]`;
export const appendLarkNotificationMarker = (memo: string, submissionId: string): string => {
  const marker = notificationMarker(submissionId);
  if (memo.includes(marker)) return memo;
  return [memo.trim(), marker].filter(Boolean).join('\n');
};

const buildCatalogMemoLines = (ctx: BaseWriteContext): string[] => [
  ctx.submissionId ? submissionMarker(ctx.submissionId) : '',
  ctx.appliedJobId ? `応募求人ID: ${ctx.appliedJobId}` : '',
  ctx.catalogJobId ? `広告クリック求人ID: ${ctx.catalogJobId}` : '',
  ctx.catalogJobName ? `広告クリック求人名: ${ctx.catalogJobName}` : '',
  ctx.catalogClickedAtMillis ? `カタログクリック日時: ${new Date(ctx.catalogClickedAtMillis).toISOString()}` : '',
  ctx.catalogAttributionStatus ? `カタログ求人一致判定: ${ctx.catalogAttributionStatus}` : '',
].filter(Boolean);

type DirectBaseWrite = {
  profile: LarkProfile;
  tableId: string;
  fields: Record<string, LarkFieldValue | LarkLinkedRecordName | undefined>;
};

// 流入元(origin)に応じて、直書き先テーブルと日本語カラムへのマッピングを決める。
// coupang は今回対象外なので null（＝呼び出し側で Base Webhook にフォールバック）。
// 「応募経由(マスタ連動)」「マスタ-応募職種」はマスタへのリンク。名前の決め方は lark-masters.ts を参照。
// 判定できない入力は undefined を返して空欄のまま残す（誤った経由・職種を書かない）。
export function resolveDirectBaseWrite(ctx: BaseWriteContext): DirectBaseWrite | null {
  if (ctx.isCoupang) return null;

  const address = [ctx.form.municipalityName, ctx.form.townName].filter(Boolean).join('') || undefined;
  const applicationSourceName = resolveApplicationSourceMasterName(ctx.utm);
  const applicationSourceLink = applicationSourceName
    ? { linkedRecordName: applicationSourceName }
    : undefined;

  if (ctx.isMechanic) {
    // 経験者フォームの転職時期／資格は Base の専用 Select に保存する。
    // 新卒フォームの資格回答（通学コース）は従来どおり対応履歴メモに残す。
    const memo = [
      ctx.isMechanicNewgrad && ctx.jobTimingLabel ? `転職時期: ${ctx.jobTimingLabel}` : '',
      ctx.isMechanicNewgrad && ctx.mechanicQualificationsLabel
        ? `${ctx.qualificationFieldLabel}: ${ctx.mechanicQualificationsLabel}`
        : '',
    ].filter(Boolean).join(' / ') || undefined;

    // 希望年収（経験者フォームのみの設問）は「履歴書（添付なし）」欄（テキスト）へ保存する。
    // mapDesiredIncomeLabel は未回答時に「未選択」を返すため、その場合は書き込まない。
    const desiredIncomeText =
      ctx.desiredIncomeLabel && ctx.desiredIncomeLabel !== '未選択'
        ? `希望年収: ${ctx.desiredIncomeLabel}`
        : undefined;

    return {
      profile: 'mechanic',
      tableId: MECHANIC_TABLE_ID,
      fields: {
        求職者名: ctx.form.fullName,
        フリガナ: ctx.form.fullNameKana,
        電話番号: ctx.form.phoneNumber,
        メールアドレス: ctx.form.email,
        生年月日: ctx.form.birthDate,
        郵便番号: ctx.form.postalCode,
        '居住地/都道府県': ctx.form.prefectureName,
        '居住地/市区町村以下': address,
        応募日: ctx.submittedAtMs,
        ステータス: 'リード',
        登録職種: '自動車整備士',
        転職時期: ctx.isMechanicNewgrad ? undefined : ctx.jobTimingLabel || undefined,
        資格: ctx.isMechanicNewgrad || !ctx.form.mechanicQualification
          ? undefined
          : mapMechanicQualificationToBaseOptions(ctx.mechanicQualificationsLabel),
        '履歴書（添付なし）': desiredIncomeText,
        対応履歴メモ: memo,
        utm_source: ctx.utm.utm_source,
        utm_medium: ctx.utm.utm_medium,
        utm_campaign: ctx.utm.utm_campaign,
        utm_term: ctx.utm.utm_term,
        utm_creative: ctx.utm.utm_creative,
        utm_content: ctx.utm.utm_content,
        utm_id: ctx.utm.utm_id,
        ad_id: ctx.adId,
        ad_creative_id: ctx.adCreativeId,
        ad_image_url: ctx.adImageUrl,
        LP_URL: ctx.pageUrl,
        '流入媒体（自動判定）': ctx.mediaName,
        submission_id: ctx.submissionId,
        応募求人ID: ctx.appliedJobId,
        広告クリック求人ID: ctx.catalogJobId,
        広告クリック求人名: ctx.catalogJobName,
        カタログクリック日時: ctx.catalogClickedAtMillis,
        カタログ求人一致判定: ctx.catalogAttributionStatus,
        // 整備士Baseの応募経由マスタは tblzMUVSWmTzmGfA。リンク先はフィールド定義から解決するので
        // テーブルIDはここに書かない。職種は専用の Select「登録職種」で持っているため対象外。
        '応募経由(マスタ連動)': applicationSourceLink,
      },
    };
  }

  // default / bus / truck → 求職者DB🚕（ridejob base）
  // 職種と保有免許は専用フィールドへ保存し、転職時期だけ対応履歴メモへ残す。
  const memo = [
    ctx.jobTimingLabel ? `転職時期: ${ctx.jobTimingLabel}` : '',
    ...buildCatalogMemoLines(ctx),
  ].filter(Boolean).join('\n') || undefined;

  // 応募職種マスタ側のレコード名。タクシーLPは1本で「タクシー」と「ハイヤー転向」の両方を受けるため、
  // どちらの求人として扱うかはクリエイティブで振り分ける（lark-masters.ts）。
  const jobCategoryName = resolveJobCategoryMasterName({
    isTaxi: ctx.isTaxi,
    isTruck: ctx.isTruck,
    isBus: ctx.isBus,
    utmCreative: ctx.utm.utm_creative,
  });
  return {
    profile: 'ridejob',
    tableId: RIDEJOB_TABLE_ID,
    fields: {
      求職者名: ctx.form.fullName,
      フリガナ: ctx.form.fullNameKana,
      電話番号: ctx.form.phoneNumber,
      メールアドレス: ctx.form.email,
      生年月日: ctx.form.birthDate,
      郵便番号: ctx.form.postalCode,
      都道府県: ctx.form.prefectureName,
      市区町村以下: address,
      応募日: ctx.submittedAtMs,
      Status: 'リード',
      // 求職者DB🚕 に「登録職種」列は無く、職種は応募職種マスタへの関連フィールド
      //「マスタ-応募職種」で持つ（linkedRecordName からレコードIDを解決して書き込む）。
      'マスタ-応募職種': jobCategoryName ? { linkedRecordName: jobCategoryName } : undefined,
      保有資格: ctx.isTruck ? mapTruckLicensesToBaseOptions(ctx.form.truckLicenses) : undefined,
      対応履歴メモ: memo,
      utm_source: ctx.utm.utm_source,
      utm_medium: ctx.utm.utm_medium,
      utm_campaign: ctx.utm.utm_campaign,
      utm_term: ctx.utm.utm_term,
      utm_creative: ctx.utm.utm_creative,
      utm_content: ctx.utm.utm_content,
      utm_id: ctx.utm.utm_id,
      ad_id: ctx.adId,
      ad_creative_id: ctx.adCreativeId,
      ad_image_url: ctx.adImageUrl,
      LP_URL: ctx.pageUrl,
      '流入媒体（自動判定）': ctx.mediaName,
      '応募経由(マスタ連動)': applicationSourceLink,
    },
  };
}

// Base への保存。可能なら Bitable API で直書きし、未設定 or 失敗 or 対象外(coupang) なら
// 既存の Base 自動化 Webhook にフォールバックする（応募データを取りこぼさないため）。
type BaseSaveResult = {
  recordId?: string;
  /** Base への保存が直書き・Webhook ともに失敗した。応募は通すが通知に印を付ける。 */
  baseSaveFailed?: string;
  /**
   * 既存レコードを「同じ応募」とみなして新しい行を作らなかった。
   * このレコードは**こちらが作ったものではない**ので、書き戻しをしてはいけない。
   */
  dedupedExisting?: true;
  /**
   * どの経路で Base に保存したか。通知の見出しに出して、Lark 側で件数を数えられるようにする。
   * 直書きが失敗し続けていても `webhook` なら通知は普通に届くため、印が無いと
   * 「直った」のか「静かに壊れたまま」なのかが区別できない（§4 の黙って壊れるもの）。
   */
  savedVia?: 'direct' | 'webhook';
  notificationAlreadySent: boolean;
  notificationInProgress?: boolean;
  notificationRecoveryOnly?: boolean;
  notificationRecoveryExpired?: boolean;
  profile?: LarkProfile;
  tableId?: string;
  memo?: string;
};

async function saveToBase(
  ctx: BaseWriteContext,
  baseWebhookUrl: string | undefined,
  basePayload: Record<string, unknown>
): Promise<BaseSaveResult> {
  const target = resolveDirectBaseWrite(ctx);
  if (target && isLarkBaseConfigured(target.profile)) {
    try {
      if (ctx.submissionId) {
        const usesMemoMarker = target.profile === 'ridejob';
        const uniqueValue = usesMemoMarker ? submissionMarker(ctx.submissionId) : ctx.submissionId;
        let saved = await upsertBaseRecordByTextField(
          target.tableId,
          usesMemoMarker ? '対応履歴メモ' : 'submission_id',
          uniqueValue,
          target.fields,
          target.profile,
          usesMemoMarker ? 'contains' : 'is',
          false,
        );
        const hasNotificationMarker = (fields: Record<string, unknown>): boolean => usesMemoMarker
          ? String(fields['対応履歴メモ'] ?? '').includes(notificationMarker(ctx.submissionId))
          : fields['Lark通知送信済み'] === true;
        let notificationAlreadySent = hasNotificationMarker(saved.previousFields);

        // 同じsubmission_idが同時到着した場合、作成の敗者は先着の通知完了を待つ。
        // 先着が落ちたケースだけは30秒後の再送が引き継げるようにする。
        if (!saved.created && !notificationAlreadySent) {
          for (let attempt = 0; attempt < 12 && !notificationAlreadySent; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            saved = await upsertBaseRecordByTextField(
              target.tableId,
              usesMemoMarker ? '対応履歴メモ' : 'submission_id',
              uniqueValue,
              target.fields,
              target.profile,
              usesMemoMarker ? 'contains' : 'is',
              false,
            );
            notificationAlreadySent = hasNotificationMarker(saved.previousFields);
          }
        }
        const submittedAt = Number(saved.previousFields['応募日']);
        const notificationAge = Number.isFinite(submittedAt) ? Date.now() - submittedAt : undefined;
        const notificationInProgress = !saved.created
          && !notificationAlreadySent
          && (notificationAge === undefined || notificationAge < 30_000);
        const notificationRecoveryExpired = !saved.created
          && !notificationAlreadySent
          && notificationAge !== undefined
          && notificationAge >= 55 * 60_000;
        const notificationRecoveryOnly = !saved.created
          && !notificationAlreadySent
          && !notificationInProgress
          && !notificationRecoveryExpired;
        console.log(`Lark Base upsert成功 (${target.profile} / ${target.tableId})`, {
          recordId: saved.recordId,
          created: saved.created,
        });
        return {
          recordId: saved.recordId,
          savedVia: 'direct',
          notificationAlreadySent,
          notificationInProgress,
          notificationRecoveryOnly,
          notificationRecoveryExpired,
          profile: target.profile,
          tableId: target.tableId,
          memo: usesMemoMarker
            ? String(saved.previousFields['対応履歴メモ'] ?? target.fields['対応履歴メモ'] ?? '').trim()
            : undefined,
        };
      }
      await createBaseRecord(target.tableId, target.fields, target.profile);
      console.log(`Lark Base 直書き成功 (${target.profile} / ${target.tableId})`);
      return { savedVia: 'direct', notificationAlreadySent: false };
    } catch (e) {
      console.error(`Lark Base 直書き失敗、Webhook にフォールバック (${target.profile}):`, describeError(e));
      // ⚠️ ここで throw してはいけない。
      //
      // #89 は「submission_id を持つ新経路は直接 Base upsert が冪等性の正本で、Webhook へ落とすと
      // 同じ応募が別レコードになり得る」として失敗を呼び出し側へ返していた。その結果、
      // 2026-09-17 17:55:35 JST のデプロイ（ridejob-entry dpl_8STaHdMpMh6GEkV8zNWn7h5o9rGa）直後から直書きの失敗が 500 になり、通知もメールもSMSもCAPIも
      // 走らないまま応募が消えた。自社LP経由の応募は5日間ゼロ（約90件）。
      //
      // 重複レコードは後から統合できる。失われた応募は戻らない。フォールバックを優先する。
    }
  }

  if (target && !isLarkBaseConfigured(target.profile)) {
    console.error(`Lark Base 直書きの認証情報が未設定、Webhook にフォールバック (${target.profile})`);
  }

  if (baseWebhookUrl) {
    // Base 自動化 Webhook には冪等性が無い。直書きが失敗し続けている間、
    // 応募者が送信を繰り返すと同じ応募が何行も増える（2026-09-23 に実際に発生。
    // 自社LP経由45レコードに対し実人数8人・最多15行）。
    // 作る前に、同じ電話番号の応募が直近にないかを1回だけ確かめる。
    if (target && ctx.form.phoneNumber) {
      const dup = await findRecentRecordByPhone(
        target.tableId, ctx.form.phoneNumber, DUPLICATE_WINDOW_MS, target.profile,
      ).catch((e) => {
        // 重複チェックの失敗で応募を落とさない。確認できなければ作る（消すより重複の方がまし）。
        console.error('重複チェックに失敗、Webhookへ進む:', describeError(e));
        return null;
      });
      if (dup) {
        console.warn('同じ電話番号の応募が直近にあるため Base Webhook を呼ばない:', {
          profile: target.profile, recordId: dup.recordId,
        });
        return {
          recordId: dup.recordId,
          dedupedExisting: true,
          notificationAlreadySent: false,
          profile: target.profile,
          tableId: target.tableId,
          memo: String(dup.fields['対応履歴メモ'] ?? '').trim() || undefined,
        };
      }
    }
    const resp = await fetch(baseWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
      signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
    });
    const result = (await resp.json().catch(() => ({}))) as LarkWebhookResult;
    if (!resp.ok || !isLarkAccepted(result)) {
      throw new Error(
        `Lark Base Webhook failed: http=${resp.status} code=${result.code ?? result.StatusCode ?? 'n/a'} msg=${result.msg ?? result.StatusMessage ?? 'n/a'}`,
      );
    }
    console.log('Lark Base webhook triggered successfully');
    return { savedVia: 'webhook', notificationAlreadySent: false };
  } else {
    throw new Error('Lark Base direct credentials and webhook URL are both not configured.');
  }
}

// Types for submission payload
type ExperimentInfo = {
  name?: string;
  variant?: string;
};

type UTMParams = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_creative?: string;
  utm_content?: string; // Meta広告: {{ad.name}}（広告名）
  utm_id?: string; // Meta広告: {{ad.id}}（広告ID）
};

type ApplicantFormData = {
  jobIntent?: FormData['jobIntent'];
  birthDate?: string;
  fullName?: string;
  fullNameKana?: string;
  postalCode?: string;
  prefectureId?: string;
  prefectureName?: string;
  municipalityId?: string;
  municipalityName?: string;
  townName?: string;
  phoneNumber?: string;
  email?: string;
  jobTiming?: FormData['jobTiming'];
  mechanicQualification?: FormData['mechanicQualification'];
  desiredIncome?: FormData['desiredIncome'];
  truckLicenses?: FormData['truckLicenses'];
};

type ApplicantSubmission = ApplicantFormData & {
  utmParams?: UTMParams;
  experiment?: ExperimentInfo;
  formOrigin?: 'coupang' | 'default' | 'bus' | 'mechanic' | 'mechanic_newgrad' | 'truck';
  metaEventId?: string;
  /** ChatGPT広告のクリック識別子。OpenAI Conversions API の突合キー。 */
  oppref?: string;
  submissionId?: string;
  appliedJobId?: string;
  catalogJobId?: string;
  catalogClickedAt?: string;
  catalogLandingPath?: string;
  catalogSource?: string;
  catalogMedium?: string;
  catalogEvidence?: 'utm' | 'fbclid';
  fbclid?: string;
  attributionLastTouchAt?: string;
};

// UTM parameters to media name mapping function
// 生年月日（YYYY-MM-DD）から年齢を計算する。算出できない場合は null を返す
function calculateAge(birthDate?: string): string | null {
  if (!birthDate) return null;
  const match = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const now = new Date();
  let age = now.getFullYear() - year;
  const monthDiff = now.getMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < day)) {
    age -= 1;
  }
  if (age < 0 || age > 120) return null;
  return `${age}歳`;
}

// Meta(Facebook/Instagram)広告の流入判定。広告側UTMは utm_source=fb 等で来るため複数表記を許容する。
const META_UTM_SOURCES = new Set(['meta', 'fb', 'facebook', 'ig', 'instagram']);
function isMetaUtmSource(utmSource?: string): boolean {
  return META_UTM_SOURCES.has((utmSource || '').toLowerCase());
}

export async function POST(request: NextRequest) {
  try {
    const submissionData = (await request.json()) as ApplicantSubmission;
    const { utmParams, formOrigin, ...formData } = submissionData;
    const submissionId = String(submissionData.submissionId || submissionData.metaEventId || '').trim().slice(0, 128);
    if (!submissionId) {
      return NextResponse.json({ message: 'submissionId is required' }, { status: 400 });
    }
    const catalog = assessCatalogTouch({
      catalogJobId: submissionData.catalogJobId,
      catalogClickedAt: submissionData.catalogClickedAt,
      catalogSource: submissionData.catalogSource,
      catalogMedium: submissionData.catalogMedium,
      catalogEvidence: submissionData.catalogEvidence,
      fbclid: submissionData.fbclid,
      appliedJobId: submissionData.appliedJobId,
      utmSource: utmParams?.utm_source,
      utmMedium: utmParams?.utm_medium,
      utmContent: utmParams?.utm_content,
      utmLastTouchAt: submissionData.attributionLastTouchAt,
    });
    let catalogJobName: string | undefined;
    if ((catalog.status === 'same_job' || catalog.status === 'changed_job' || catalog.status === 'applied_job_missing') && catalog.jobId) {
      try {
        const catalogJob = await fetchJobById(catalog.jobId);
        catalogJobName = catalogJob?.jobName || catalogJob?.title;
        if (!catalogJob || !isMetaCatalogJob(catalogJob)) catalog.status = 'invalid';
      } catch (error) {
        // 一時障害をinvalidとして永久保存せず、Base作成前に再送可能な失敗にする。
        console.warn('カタログ求人名の取得に失敗:', describeError(error));
        return NextResponse.json({ message: 'Catalog job source is temporarily unavailable' }, { status: 503 });
      }
    }
    
    // Determine env and feature flags
    const isProduction = process.env.NODE_ENV === 'production';
    const sendBaseOnly = process.env.LARK_SEND_BASE_ONLY === 'true';

    // Determine form origin type
    const referer = request.headers.get('referer') || '';
    const isCoupang = formOrigin === 'coupang' || /\/coupang(\?|$|\/)?.*/.test(referer);
    const isMechanicNewgrad = formOrigin === 'mechanic_newgrad' || /\/mechanic-newgrad(\?|$|\/)?.*/.test(referer);
    const isMechanic = formOrigin === 'mechanic' || /\/mechanic(\?|$|\/)?.*/.test(referer) || isMechanicNewgrad;
    const isTruck = formOrigin === 'truck';
    const isBus = formOrigin === 'bus';
    // 'default' が明示的に送られてきたときだけタクシーLPと見なす。referer からは推測しない
    // （formOrigin 未指定の想定外リクエストにタクシー職種が付いてしまうため）。
    const isTaxi = formOrigin === 'default';

    // Determine the appropriate Lark webhook URLs based on environment (with sensible fallbacks)
    const larkWebhookUrlCommon = isProduction
      ? process.env.LARK_WEBHOOK_URL
          || process.env.LARK_WEBHOOK_URL_TEST
      : process.env.LARK_WEBHOOK_URL_TEST
          || process.env.LARK_WEBHOOK_URL;
    // Optional dedicated webhook for coupang
    const larkWebhookUrlCoupang = isProduction
      ? process.env.LARK_WEBHOOK_URL_COUPANG_PROD || process.env.LARK_WEBHOOK_URL_COUPANG
      : process.env.LARK_WEBHOOK_URL_COUPANG_TEST || process.env.LARK_WEBHOOK_URL_COUPANG;
    // Optional dedicated webhook for mechanic
    const larkWebhookUrlMechanic = isProduction
      ? process.env.LARK_WEBHOOK_URL_MECHANIC_PROD || process.env.LARK_WEBHOOK_URL_MECHANIC
      : process.env.LARK_WEBHOOK_URL_MECHANIC_TEST || process.env.LARK_WEBHOOK_URL_MECHANIC;

    const larkWebhookUrl = isMechanic && larkWebhookUrlMechanic
      ? larkWebhookUrlMechanic
      : (isCoupang && larkWebhookUrlCoupang) ? larkWebhookUrlCoupang : larkWebhookUrlCommon;
    const larkChatId = isCoupang
      ? undefined
      : isMechanic
        ? process.env.LARK_SUBMIT_CHAT_ID_MECHANIC
        : process.env.LARK_SUBMIT_CHAT_ID_RIDEJOB;

    const baseWebhookUrlCommon = isProduction
      ? process.env.LARK_BASE_WEBHOOK_URL_PROD
          || process.env.LARK_BASE_WEBHOOK_URL
          || process.env.LARK_BASE_WEBHOOK_URL_TEST
      : process.env.LARK_BASE_WEBHOOK_URL_TEST
          || process.env.LARK_BASE_WEBHOOK_URL
          || process.env.LARK_BASE_WEBHOOK_URL_PROD;
    // Optional dedicated Base webhook for coupang
    const baseWebhookUrlCoupang = isProduction
      ? process.env.LARK_BASE_WEBHOOK_URL_COUPANG_PROD || process.env.LARK_BASE_WEBHOOK_URL_COUPANG
      : process.env.LARK_BASE_WEBHOOK_URL_COUPANG_TEST || process.env.LARK_BASE_WEBHOOK_URL_COUPANG;
    // Optional dedicated Base webhook for mechanic
    const baseWebhookUrlMechanic = isProduction
      ? process.env.LARK_BASE_WEBHOOK_URL_MECHANIC_PROD || process.env.LARK_BASE_WEBHOOK_URL_MECHANIC
      : process.env.LARK_BASE_WEBHOOK_URL_MECHANIC_TEST || process.env.LARK_BASE_WEBHOOK_URL_MECHANIC;

    const baseWebhookUrl = isMechanic && baseWebhookUrlMechanic
      ? baseWebhookUrlMechanic
      : (isCoupang && baseWebhookUrlCoupang) ? baseWebhookUrlCoupang : baseWebhookUrlCommon;

    // 必須URLの検証（Baseのみテスト時はBase URL、通常時はLark URL）
    //
    // ⚠️ ここは Base 保存より手前。素の 500 で返すと、応募内容はどこにも残らず消える。
    // 設定漏れのままデプロイされると「フォームは動いて見えるのに応募だけが消える」形になり、
    // 誰も気づけない（2026-09-17〜24 の障害と同じ型）。
    // 退避に残せたなら応募は記録されているので、応募者には再送させない（再送は重複を増やすだけ）。
    const vaultProfile = isMechanic ? 'mechanic' : isCoupang ? 'liftjob' : 'ridejob';
    const bailWithVault = async (reason: string) => {
      console.error(reason);
      const saved = await saveToSubmissionVault({
        source: 'form_applicant/applicants',
        kind: 'application',
        submissionId,
        profile: vaultProfile,
        reason,
        notified: false,
        payload: submissionData as unknown as Record<string, unknown>,
      });
      return saved
        ? NextResponse.json({ message: 'Application submitted successfully!' })
        : NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    };

    // 通知先が無いことと、応募を保存できないことは別。
    // Base 直書き（または Base Webhook）が生きているなら、通知の設定漏れだけで
    // Base への保存まで捨ててはいけない。捨てると Base が健全でも応募が全部消える
    // ——`LARK_SUBMIT_CHAT_ID_*` を1つ落とすだけで再現する、2026-09-17〜24 と同じ型の穴。
    // 通知先が無いことは退避に記録し、Base への保存は続行する
    // （後続の通知処理は「chatId か webhookUrl があるとき」だけ走るようガード済み）。
    const canPersistWithoutNotification =
      Boolean(baseWebhookUrl) || (!isCoupang && isLarkBaseConfigured(vaultProfile));
    const missingTargetReason = sendBaseOnly
      ? (!baseWebhookUrl ? 'Lark Base Webhook URL is not configured while LARK_SEND_BASE_ONLY=true.' : null)
      : (!isCoupang && !larkChatId)
        ? 'Idempotent Lark chat ID is not configured.'
        : (!larkChatId && !larkWebhookUrl)
          ? 'Lark chat ID and Webhook URL are both not configured.'
          : null;
    if (missingTargetReason) {
      if (canPersistWithoutNotification) {
        console.error(`${missingTargetReason} / Base への保存は続行する`);
        await saveToSubmissionVault({
          source: 'form_applicant/applicants',
          kind: 'application',
          submissionId,
          profile: vaultProfile,
          reason: `${missingTargetReason} (Base への保存は続行)`,
          notified: false,
          payload: submissionData as unknown as Record<string, unknown>,
        });
      } else {
        return bailWithVault(missingTargetReason);
      }
    }

    // Debug: Log received UTM parameters
    console.log('Received UTM parameters:', utmParams);
    
    // Get media name from UTM parameters (coupangはMeta固定)
    const mediaName = isCoupang ? 'Meta広告' : getMediaName(utmParams || {});
    const submissionJobTiming = (submissionData as { jobTiming?: FormData['jobTiming'] }).jobTiming ?? formData.jobTiming ?? '';
    const jobTimingLabel = mapJobTimingLabel(submissionJobTiming, formOrigin);
    const jobIntentLabel = mapJobTimingLabel(formData.jobIntent ?? '', 'default');
    const mechanicQualificationsLabel = mapMechanicQualifications(formData.mechanicQualification ?? '');
    const truckLicensesLabel = isTruck ? mapTruckLicenses(formData.truckLicenses) : '';
    const desiredIncomeLabel = mapDesiredIncomeLabel(formData.desiredIncome ?? '');
    const qualificationFieldLabel = getMechanicQualificationFieldLabel(formOrigin);
    const baseJobTimingLabel = isMechanicNewgrad ? '' : jobTimingLabel;
    const baseJobIntentLabel = isMechanicNewgrad ? '' : jobIntentLabel;
    const baseDesiredIncomeLabel = isMechanicNewgrad ? '' : desiredIncomeLabel;
    console.log('Generated media name:', mediaName, 'isCoupang:', isCoupang);

    // Meta広告の広告ID(ad.id)から広告画像URLを解決する。
    // 入稿URLの utm_id={{ad.id}} を優先。後方互換で utm_content / utm_creative が数値なら ad.id とみなす。
    // ※ utm_content は {{ad.name}}（広告名）、utm_term は {{adset.id}} のため ad.id には使わない。
    const isMetaInflowForImage = isCoupang || isMetaUtmSource(utmParams?.utm_source);
    const adId = isLikelyAdId(utmParams?.utm_id)
      ? (utmParams?.utm_id as string)
      : isLikelyAdId(utmParams?.utm_content)
        ? (utmParams?.utm_content as string)
        : isLikelyAdId(utmParams?.utm_creative)
          ? (utmParams?.utm_creative as string)
          : '';
    let adImageUrl = '';
    let adCreativeId = '';
    if (isMetaInflowForImage && adId) {
      const resolved = await resolveAdImageUrl(adId);
      if (resolved) {
        adImageUrl = resolved.imageUrl || '';
        adCreativeId = resolved.creativeId || '';
      }
      console.log('Resolved Meta ad image:', { adId, adImageUrl: adImageUrl ? '(取得済)' : '(なし)', adCreativeId });
    }

    // Base 保存用コンテキスト（直書き／Webhook 両方で共有）
    const baseWriteCtx: BaseWriteContext = {
      isMechanic,
      isMechanicNewgrad,
      isCoupang,
      isTruck,
      isBus,
      isTaxi,
      truckLicensesLabel,
      mediaName,
      utm: utmParams || {},
      adId,
      adCreativeId,
      adImageUrl,
      form: formData,
      jobTimingLabel: baseJobTimingLabel,
      jobIntentLabel: baseJobIntentLabel,
      desiredIncomeLabel: baseDesiredIncomeLabel,
      mechanicQualificationsLabel,
      qualificationFieldLabel,
      pageUrl: referer,
      submittedAtMs: Date.now(),
      submissionId,
      appliedJobId: submissionData.appliedJobId,
      catalogJobId: catalog.jobId,
      catalogJobName,
      catalogClickedAtMillis: catalog.clickedAtMillis,
      catalogAttributionStatus: catalog.status,
    };

    const userAgent = request.headers.get('user-agent') || '';
    const clientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
    const basePayload = {
      media_name: mediaName,
      utm_source: utmParams?.utm_source || '',
      utm_medium: utmParams?.utm_medium || '',
      utm_campaign: utmParams?.utm_campaign || '',
      utm_term: utmParams?.utm_term || '',
      utm_creative: utmParams?.utm_creative || '',
      utm_content: utmParams?.utm_content || '',
      utm_id: utmParams?.utm_id || '',
      ad_id: adId,
      ad_creative_id: adCreativeId,
      ad_image_url: adImageUrl,
      birth_date: formData.birthDate || '',
      full_name: formData.fullName || '',
      full_name_kana: formData.fullNameKana || '',
      postal_code: formData.postalCode || '',
      prefecture_id: formData.prefectureId || '',
      prefecture_name: formData.prefectureName || '',
      municipality_id: formData.municipalityId || '',
      municipality_name: formData.municipalityName || '',
      town_name: formData.townName || '',
      phone_number: formData.phoneNumber || '',
      email: formData.email || '',
      job_timing: baseJobTimingLabel,
      job_intent: baseJobIntentLabel,
      desired_income: baseDesiredIncomeLabel,
      mechanic_qualifications: mechanicQualificationsLabel,
      truck_licenses: truckLicensesLabel,
      experiment_name: submissionData?.experiment?.name || '',
      experiment_variant: submissionData?.experiment?.variant || '',
      submitted_at: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      user_agent: userAgent,
      client_ip: clientIp,
      form_origin: formOrigin || '',
      is_coupang: isCoupang,
      page_url: referer,
      submission_id: submissionId,
      applied_job_id: submissionData.appliedJobId || '',
      catalog_job_id: catalog.jobId || '',
      catalog_job_name: catalogJobName || '',
      catalog_clicked_at: catalog.clickedAtMillis
        ? new Date(catalog.clickedAtMillis).toISOString()
        : '',
      catalog_attribution_status: catalog.status || '',
    } as Record<string, unknown>;

    let baseSave: BaseSaveResult;
    /** Base に入らなかった応募を Supabase の退避先に残せたか */
    let vaultSaved = false;
    try {
      baseSave = await saveToBase(baseWriteCtx, baseWebhookUrl, basePayload);
    } catch (error) {
      // ⚠️ ここで 500 を返してはいけない。この行より後ろに Lark通知・確認メール・SMS・
      // Meta CAPI・OpenAI CAPI が全部ある。500 で抜けると応募者の氏名・電話・メールが
      // どこにも残らない（2026-09-17〜09-23 の障害。自社LP経由の応募が5日間ゼロ）。
      // Base に入らなくても、Lark通知の本文には応募内容が全部載る。通知だけは必ず出す。
      const reason = describeError(error);
      console.error('Lark Base save failed; 通知は継続する:', `submission=${submissionId} ${reason}`);
      baseSave = { notificationAlreadySent: false, baseSaveFailed: reason };
      // Lark に入らなかった応募を構造化して退避する。通知は流れて埋もれるため、
      // 後から「取りこぼした応募」を機械的に数えられる受け皿を1つ持たせる。
      // 退避の成否は応募の成否に影響させない（saveToSubmissionVault は投げない）。
      vaultSaved = await saveToSubmissionVault({
        source: 'form_applicant/applicants',
        kind: 'application',
        submissionId,
        profile: resolveDirectBaseWrite(baseWriteCtx)?.profile,
        reason,
        notified: false,
        payload: basePayload,
      });
    }

    // 不変条件: 直書き・Base Webhook・Lark通知のいずれか1つに応募内容が残ったときだけ 200 を返す。
    // どこにも残せないなら 200 にしてはいけない。応募者が「送信できた」と思って離脱し、
    // こちらは応募があったことすら分からなくなる（それが 2026-09-17〜09-23 の障害）。
    if (baseSave.baseSaveFailed && !larkChatId && !larkWebhookUrl && !vaultSaved) {
      console.error(
        '応募をどこにも記録できない（Base保存が失敗し、通知先も退避先も無い）:',
        `submission=${submissionId} ${baseSave.baseSaveFailed}`,
      );
      return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }

    // Base 保存が全滅したときは LARK_SEND_BASE_ONLY を無視して通知へ進む。
    // base-only のまま 200 を返すと、記録も通知も無いまま応募が消える。
    let larkNotified = false;
    if (sendBaseOnly && !baseSave.baseSaveFailed) {
      return NextResponse.json({
        message: 'Application submitted successfully!',
        recordId: baseSave.recordId,
      }, { status: 200 });
    }
    if (baseSave.notificationAlreadySent) {
      console.log('Duplicate submission already notified; skipping side effects', { submissionId });
      return NextResponse.json({ message: 'Application submitted successfully!', duplicate: true }, { status: 200 });
    }
    if (baseSave.notificationInProgress) {
      console.warn('Duplicate submission is still being processed', { submissionId });
      return NextResponse.json(
        { message: 'Application is still being processed; retry shortly' },
        { status: 503 },
      );
    }
    if (baseSave.notificationRecoveryExpired) {
      console.error('Lark通知の安全な自動復旧期限を超過したため再送を停止:', {
        submissionId,
        recordId: baseSave.recordId,
      });
      return NextResponse.json(
        { message: 'Notification recovery requires manual confirmation' },
        { status: 503 },
      );
    }

    // Base確定後に通知し、成功状態をBaseへ書き戻す。以降のメール/SMS/CAPIは並列・非致命。
    if (!sendBaseOnly || baseSave.baseSaveFailed) {
      const tasks: Promise<void>[] = [];

      // Lark 送信タスク
      if (larkChatId || larkWebhookUrl) {
        const baseTitle = isMechanic
          ? '整備士の応募がありました！'
          : isCoupang ? 'クーパンの応募がありました！'
          : isTruck ? 'トラックドライバーの応募がありました！' : '新しい応募がありました！';
        // Base に保存できなかった応募は、この通知が唯一の記録になる。手入力が要ることを本文の先頭で示す。
        const title = baseSave.dedupedExisting
          ? `🔁再送（直近1時間に同じ電話番号あり・行は増やしていません）／${baseTitle}`
          : baseSave.baseSaveFailed
          ? `⚠️Base未登録（${vaultSaved ? '退避済み・要取り込み' : '退避も失敗・この通知が唯一の記録'}）／${baseTitle}`
          // Webhook 経由は直書きが失敗した証拠。AnyCross が受理だけして
          // レコードを作らない「静かな失敗」もあるので、届いたレコードの確認を促す。
          : baseSave.savedVia === 'webhook'
            ? `⚠️Base直書き失敗（Webhook経由・要確認）／${baseTitle}`
            : baseTitle;
        // Base列と同じ語彙(getMediaName)に揃えたうえで、生の medium を括弧で残す。
        // 以前は displaySource だけを通していたため、同じ応募が通知では「youtube(referral)」・
        // Baseでは「YouTube」と別名で出ていた。一方で媒体名だけにすると meta+cpc と meta+ad が
        // 通知上で区別できなくなり、UTMの付け間違いに気づけなくなるため併記する。
        // utm_source が無いときの通知表記は従来どおり「RIDEJOB HP」を維持する。
        const utmDisplay = utmParams?.utm_source
          ? describeMedia(utmParams)
          : 'RIDEJOB HP';
        const locationDisplay = formData.prefectureName || formData.municipalityName || formData.townName
          ? `${formData.prefectureName || ''} ${formData.municipalityName || ''} ${formData.townName || ''}`.replace(/\s+/g, ' ').trim()
          : '未入力';
        const mechanicQualificationsDisplay = isMechanic && mechanicQualificationsLabel
          ? `${qualificationFieldLabel}: ${mechanicQualificationsLabel}`
          : '';
        const truckLicensesDisplay = isTruck && truckLicensesLabel && truckLicensesLabel !== '未選択'
          ? `保有免許: ${truckLicensesLabel}`
          : '';
        const desiredIncomeDisplay = isMechanic && !isMechanicNewgrad && desiredIncomeLabel
          ? `希望年収: ${desiredIncomeLabel}`
          : '';
        const jobIntentDisplay = isMechanic && !isMechanicNewgrad && jobIntentLabel
          ? `転職意向: ${jobIntentLabel}`
          : '';
        const transferTimingDisplay = isMechanicNewgrad ? '' : `転職時期: ${jobTimingLabel || '未選択'}`;
        const additionalFields = [transferTimingDisplay, desiredIncomeDisplay, mechanicQualificationsDisplay, truckLicensesDisplay, jobIntentDisplay]
          .filter(Boolean)
          .join('\n');
        const ageDisplay = calculateAge(formData.birthDate) ?? '未入力';
        const catalogStatusLabels: Record<CatalogAttributionStatus, string> = {
          same_job: '広告で見た求人と同じ',
          changed_job: '広告クリック後に別求人へ応募',
          missing: 'カタログ求人IDを取得できず',
          applied_job_missing: '応募求人IDを取得できず',
          stale: 'クリックから7日以上',
          invalid: '無効なカタログ求人情報',
        };
        const catalogDisplay = catalog.status
          ? [
              `カタログ判定: ${catalogStatusLabels[catalog.status]}`,
              `広告クリック求人ID: ${catalog.jobId || '取得できず'}`,
              `広告クリック求人名: ${catalogJobName || '取得できず'}`,
              `実際の応募求人ID: ${submissionData.appliedJobId || '取得できず'}`,
            ].join('\n')
          : '';
        const messageContent = `
${title}
-------------------------
流入元: ${utmDisplay}
${catalogDisplay ? `${catalogDisplay}\n` : ''}生年月日: ${formData.birthDate || '未入力'}
年齢: ${ageDisplay}
氏名: ${formData.fullName || '未入力'} (${formData.fullNameKana || '未入力'})
郵便番号: ${formData.postalCode || '未入力'}
地域: ${locationDisplay}
${additionalFields ? `${additionalFields}\n` : ''}電話番号: ${formData.phoneNumber || '未入力'}
メールアドレス: ${formData.email || '未入力'}
-------------------------
        `.trim();

        const larkPayload = {
          msg_type: 'text',
          content: { text: neutralizeLarkTags(messageContent) },
        } as const;

        let notificationSent = false;
        if (larkChatId) {
          const apiResult = await sendLarkTextMessage(
            larkChatId,
            messageContent,
            submissionId,
            // 両chatともRIDE JOB通知アプリを参加済みとして実測した共通送信経路。
            'ridejob',
          );
          if (apiResult.ok) {
            notificationSent = true;
            larkNotified = true;
            console.log('Lark API notification sent successfully:', { messageId: apiResult.messageId });
          } else {
            // 通常は Webhook へ落とすと同じ応募が別経路で二重通知されるため、同じuuidでの再送に任せる。
            // ただし Base 保存が全滅しているときは、この通知が唯一の記録になる。
            // 502 で抜けると応募がどこにも残らないので、そのときだけ Webhook へフォールバックする。
            console.error('Lark API notification failed:', {
              status: apiResult.status,
              code: apiResult.code,
              message: apiResult.message,
              ambiguous: apiResult.ambiguous,
              baseSaveFailed: Boolean(baseSave.baseSaveFailed),
            });
            if (apiResult.ambiguous) {
              // Lark 側だけ成功した可能性がある通信例外。Webhook へ落とすと二重通知になる。
              // 同じ uuid の再送（1時間重複排除）に任せる。応募は記録済みなので 200 で返す。
              notificationSent = true;
              larkNotified = true;
            }
            // ⚠️ ここで 502 を返してはいけない。
            // 応募者には「エラーが発生しました」と出て、送信を繰り返す。
            // Base Webhook には冪等性が無いので、再送のたびにレコードが増える
            // （2026-09-23: 自社LP経由45レコードに対し実人数8人・最多15行）。
            // 応募が Base に残っているなら、通知の失敗は応募者の責任ではない。
            // 通知が出せなかった事実は下の退避と invariant で拾う。
          }
        }
        if (!notificationSent && larkWebhookUrl) {
          const resp = await fetch(larkWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(larkPayload),
            signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
          });
          const result = (await resp.json().catch(() => ({}))) as LarkWebhookResult;
          if (!resp.ok || !isLarkAccepted(result)) {
            console.error('Failed to send notification to Lark', {
              status: resp.status,
              code: result.code ?? result.StatusCode,
              message: result.msg ?? result.StatusMessage,
            });
            // ①と同じ理由で 502 を返さない。再送は重複を増やすだけ。
          } else {
            notificationSent = true;
            larkNotified = true;
            console.log('Lark webhook notification sent successfully:', result);
          }
        }
        if (!notificationSent) {
          // 通知が1つも出せなかった。応募は Base に残っているので 200 で返すが、
          // 誰も気づいていないので退避に残して監視で拾う。
          console.error('Lark通知を1つも出せなかった（応募自体は記録済み）:', `submission=${submissionId}`);
          vaultSaved = await saveToSubmissionVault({
            source: 'form_applicant/applicants',
            kind: 'application',
            submissionId,
            profile: resolveDirectBaseWrite(baseWriteCtx)?.profile,
            reason: 'Lark通知に失敗（Base への保存は成功）',
            notified: false,
            payload: basePayload,
          }) || vaultSaved;
        }
        // ⚠️ 重複として既存レコードを指しているときは書き戻さない。
        // putRecord は PUT で列を**置換**するため、他人／別応募の対応履歴メモ
        // （営業の記入・[submission_id:] 冪等キー・カタログ帰属行）が消える。
        // 冪等キーが消えると直書き経路が同じ応募をもう一度作る＝重複を止める処理が重複を作る。
        if (baseSave.recordId && !baseSave.dedupedExisting) {
          const notificationFields = baseSave.profile === 'ridejob'
            ? {
                対応履歴メモ: appendLarkNotificationMarker(baseSave.memo || '', submissionId),
              }
            : { 'Lark通知送信済み': true };
          let notificationStatePersisted = false;
          let lastPersistError: unknown;
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
              await updateBaseRecord(
                baseSave.tableId || (baseWriteCtx.isMechanic ? MECHANIC_TABLE_ID : RIDEJOB_TABLE_ID),
                baseSave.recordId,
                notificationFields,
                baseSave.profile || (baseWriteCtx.isMechanic ? 'mechanic' : 'ridejob'),
              );
              notificationStatePersisted = true;
              break;
            } catch (error) {
              lastPersistError = error;
              if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 100));
            }
          }
          if (!notificationStatePersisted) {
            console.error('Lark通知送信済みの書き戻しが3回失敗:', lastPersistError);
            return NextResponse.json({ message: 'Internal Server Error' }, { status: 503 });
          }
        }
      }

      // 先着は通知済み印の確定前に後続へ進まないため、復旧側でメール・SMS・CAPIまで完了する。
      if (baseSave.notificationRecoveryOnly) {
        console.log('通知復旧後の後続処理を再開:', { submissionId });
      }

      // 応募受付完了 自動返信メール送信タスク
      // formOrigin が default/bus/mechanic/mechanic_newgrad かつ email がある場合のみ送信
      // (Coupang は別ルート/別仕様のため対象外)
      const emailOriginCandidate: string = formOrigin
        ?? (isMechanicNewgrad ? 'mechanic_newgrad'
          : isMechanic ? 'mechanic'
          : isCoupang ? 'coupang'
          : 'default');
      if (isSupportedEmailOrigin(emailOriginCandidate) && formData.email) {
        const recipientEmail = formData.email;
        const origin = emailOriginCandidate;
        tasks.push(
          (async () => {
            const result = await sendApplicationConfirmationEmail({
              to: recipientEmail,
              applicantName: formData.fullName || '',
              applicantNameKana: formData.fullNameKana,
              phoneNumber: formData.phoneNumber,
              email: recipientEmail,
              formOrigin: origin,
            });
            if (result.sent) {
              console.log('Confirmation email sent:', {
                submissionId,
                messageId: result.messageId,
                formOrigin: origin,
              });
            } else if (result.reason === 'error') {
              console.error('Confirmation email failed:', {
                submissionId,
                error: result.error,
                formOrigin: origin,
              });
            } else {
              console.log('Confirmation email skipped:', {
                submissionId,
                reason: result.reason,
                formOrigin: origin,
              });
            }
          })()
        );
      }

      // 新規応募SMS(ライド/メカの全応募者)。流入元では絞らない(電話を残した応募者に予約リンクを送る)。
      // coupang / bus は対象外(smsChannel=null)。truck はタクシーと同じ 'ridejob' チャネル
      // (=面談予約リンクも共通)。送信本体は eeasy の共通エンドポイントに委譲。
      // media には実際の流入元(utm_source)を渡す。無ければ 'form'。
      const smsChannel: 'ridejob' | 'mechanic' | null =
        isCoupang || formOrigin === 'bus' ? null : isMechanic ? 'mechanic' : 'ridejob';
      if (smsChannel && formData.phoneNumber) {
        const channel = smsChannel;
        const media = (utmParams?.utm_source || 'form').toLowerCase().slice(0, 32);
        tasks.push(
          (async () => {
            const r = await sendApplicationSms({
              channel,
              phone: formData.phoneNumber,
              applicantName: formData.fullName,
              media,
            });
            if (r.sent) {
              console.log('Application SMS sent:', { order: r.deliveryOrderId, ref: r.ref, channel, media });
            } else {
              console.log('Application SMS skipped/failed:', { reason: r.reason, error: r.error, channel, media });
            }
          })()
        );
      }

      // Meta Conversions API（Lead）— 非致命。eventId が無ければスキップ
      if (typeof submissionData.metaEventId === 'string' && submissionData.metaEventId) {
        const capiUserAgent = request.headers.get('user-agent') || '';
        const capiClientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
        const capiHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
        const capiProto = request.headers.get('x-forwarded-proto') || 'https';
        const capiFallbackSourceUrl = capiHost ? `${capiProto}://${capiHost}` : undefined;
        tasks.push(
          sendMetaCapiLead({
            eventId: submissionData.metaEventId,
            eventSourceUrl: referer,
            email: formData.email,
            phone: formData.phoneNumber,
            fbp: request.cookies.get('_fbp')?.value,
            fbc: request.cookies.get('_fbc')?.value,
            clientIpAddress: capiClientIp || undefined,
            clientUserAgent: capiUserAgent || undefined,
            contentIds: submissionData.appliedJobId ? [submissionData.appliedJobId] : undefined,
          }).then(() => {})
        );

        // OpenAI（ChatGPT広告）Conversions API — 非致命。
        // oppref が無い応募（＝広告クリック由来でない）は lib 側で送信をスキップする。
        tasks.push(
          sendOpenAiConversion({
            eventId: submissionData.metaEventId,
            oppref: typeof submissionData.oppref === 'string' ? submissionData.oppref : undefined,
            // action_source=web では source_url が必須。Referer を送らない環境
            // （プライバシー拡張・no-referrer のアプリ内ブラウザ等）でも欠落させないよう、
            // ホストヘッダから組み立てた値へフォールバックする。
            sourceUrl: referer || capiFallbackSourceUrl,
            email: formData.email,
            phone: formData.phoneNumber,
            clientIpAddress: capiClientIp || undefined,
            clientUserAgent: capiUserAgent || undefined,
          }).then(() => {})
        );
      }

      // 応募者メール/SMS/CAPIは非致命。BaseとLark通知は上で確定済み。
      await Promise.allSettled(tasks);

      // Base に入らず退避した応募でも、通知が出せていれば人は気づける。
      // 退避テーブルの notified を立てて、監視が「誰も気づいていない行」だけを拾えるようにする。
      if (vaultSaved && larkNotified) {
        await markSubmissionVaultNotified('form_applicant/applicants', submissionId);
      }
    }

    if (baseSave.baseSaveFailed && !larkNotified && !vaultSaved) {
      // Base にも Lark にも残らなかった。200 を返すと応募がそのまま消える。
      console.error(
        '応募をどこにも記録できなかった（Base保存・Lark通知・退避のすべてが失敗）:',
        `submission=${submissionId} ${baseSave.baseSaveFailed}`,
      );
      return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
    }

    // クライアントには成功したことを返す
    // (Larkへの通知成否に関わらず、データを受け付けた時点で成功とすることも多い)
    return NextResponse.json({ message: 'Application submitted successfully!' }, { status: 200 });

  } catch (error) {
    console.error('Error processing application in API route:', describeError(error));
    // 予期せぬエラー
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
} 
