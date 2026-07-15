import { NextRequest, NextResponse } from 'next/server';
import type { FormData } from '@/app/components/application-form/types';
import { mapJobTimingLabel } from '@/app/components/application-form/utils/mapJobTimingLabel';
import { getMechanicQualificationFieldLabel, mapMechanicQualifications } from '@/app/components/application-form/utils/mapMechanicQualifications';
import { mapDesiredIncomeLabel } from '@/app/components/application-form/utils/mapDesiredIncomeLabel';
import {
  isSupportedEmailOrigin,
  sendApplicationConfirmationEmail,
} from '@/lib/email/send-application-confirmation';
import { sendApplicationSms } from '@/lib/sms/send-application-sms';
import { resolveAdImageUrl, isLikelyAdId } from '@/lib/meta/resolveAdImage';
import { sendMetaCapiLead } from '@/lib/meta/capi';
import {
  createBaseRecord,
  isLarkBaseConfigured,
  type LarkFieldValue,
  type LarkProfile,
} from '@/lib/larkBase';

// Bitable 直書きの投入先テーブル（env で上書き可）。
//   default / bus       → 求職者DB🚕   （ridejob base：APP_*_RIDEJOB）
//   mechanic / newgrad  → 求職者DB👷‍♂️  （mechanic base：APP_*_MECHANIC・既存流用）
// ※ coupang は今回対象外（従来どおり Base Webhook 送信）。
const RIDEJOB_TABLE_ID = process.env.LARK_BASE_TABLE_ID_RIDEJOB || 'tblO0pPqFyHqpVcj';
const MECHANIC_TABLE_ID = process.env.LARK_BASE_TABLE_ID_MECHANIC_APPLICANTS || 'tblXcvtQJqoD2PIV';

// Bitable 直書きに必要な、リクエスト内で算出済みの値をまとめたもの。
type BaseWriteContext = {
  isMechanic: boolean;
  isMechanicNewgrad: boolean;
  isCoupang: boolean;
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
};

type DirectBaseWrite = {
  profile: LarkProfile;
  tableId: string;
  fields: Record<string, LarkFieldValue | undefined>;
};

// 流入元(origin)に応じて、直書き先テーブルと日本語カラムへのマッピングを決める。
// coupang は今回対象外なので null（＝呼び出し側で Base Webhook にフォールバック）。
// media_name の「応募経由(マスタ連動)」リンクは張らず、utm系＋クリエイティブ等のテキストのみ書き込む方針。
function resolveDirectBaseWrite(ctx: BaseWriteContext): DirectBaseWrite | null {
  if (ctx.isCoupang) return null;

  const address = [ctx.form.municipalityName, ctx.form.townName].filter(Boolean).join('') || undefined;

  if (ctx.isMechanic) {
    // 転職時期／希望年収／転職意向／保有資格は専用 Select への型変換リスクを避け、対応履歴メモに集約する。
    const memo = [
      ctx.jobTimingLabel ? `転職時期: ${ctx.jobTimingLabel}` : '',
      ctx.desiredIncomeLabel ? `希望年収: ${ctx.desiredIncomeLabel}` : '',
      ctx.jobIntentLabel ? `転職意向: ${ctx.jobIntentLabel}` : '',
      ctx.mechanicQualificationsLabel ? `${ctx.qualificationFieldLabel}: ${ctx.mechanicQualificationsLabel}` : '',
    ].filter(Boolean).join(' / ') || undefined;

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
        対応履歴メモ: memo,
        utm_source: ctx.utm.utm_source,
        utm_medium: ctx.utm.utm_medium,
        utm_campaign: ctx.utm.utm_campaign,
        utm_term: ctx.utm.utm_term,
        utm_creative: ctx.utm.utm_creative,
        utm_content: ctx.utm.utm_content,
        ad_id: ctx.adId,
        ad_creative_id: ctx.adCreativeId,
        ad_image_url: ctx.adImageUrl,
        LP_URL: ctx.pageUrl,
        クリエイティブ: ctx.mediaName,
      },
    };
  }

  // default / bus → 求職者DB🚕（ridejob base）
  const memo = ctx.jobTimingLabel ? `転職時期: ${ctx.jobTimingLabel}` : undefined;
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
      対応履歴メモ: memo,
      utm_source: ctx.utm.utm_source,
      utm_medium: ctx.utm.utm_medium,
      utm_campaign: ctx.utm.utm_campaign,
      utm_term: ctx.utm.utm_term,
      utm_creative: ctx.utm.utm_creative,
      utm_content: ctx.utm.utm_content,
      ad_id: ctx.adId,
      ad_creative_id: ctx.adCreativeId,
      ad_image_url: ctx.adImageUrl,
      LP_URL: ctx.pageUrl,
      クリエイティブ: ctx.mediaName,
    },
  };
}

// Base への保存。可能なら Bitable API で直書きし、未設定 or 失敗 or 対象外(coupang) なら
// 既存の Base 自動化 Webhook にフォールバックする（応募データを取りこぼさないため）。
async function saveToBase(
  ctx: BaseWriteContext,
  baseWebhookUrl: string | undefined,
  basePayload: Record<string, unknown>
): Promise<void> {
  const target = resolveDirectBaseWrite(ctx);
  if (target && isLarkBaseConfigured(target.profile)) {
    try {
      await createBaseRecord(target.tableId, target.fields, target.profile);
      console.log(`Lark Base 直書き成功 (${target.profile} / ${target.tableId})`);
      return;
    } catch (e) {
      console.error(`Lark Base 直書き失敗、Webhook にフォールバック (${target.profile}):`, e);
    }
  }

  if (baseWebhookUrl) {
    const resp = await fetch(baseWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    });
    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error(`Failed to send to Lark Base Webhook (${resp.status}): ${errorBody}`);
    } else {
      console.log('Lark Base webhook triggered successfully');
    }
  } else {
    console.warn('Lark Base Webhook URL is not configured. Skipping Base record creation.');
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
};

type ApplicantSubmission = ApplicantFormData & {
  utmParams?: UTMParams;
  experiment?: ExperimentInfo;
  formOrigin?: 'coupang' | 'default' | 'bus' | 'mechanic' | 'mechanic_newgrad';
  metaEventId?: string;
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

function getMediaName(utmParams: { utm_source?: string; utm_medium?: string }): string {
  const { utm_source, utm_medium } = utmParams;
  
  console.log('getMediaName input:', { utm_source, utm_medium });
  
  if (!utm_source) {
    console.log('No utm_source found, returning 直接アクセス');
    return '直接アクセス';
  }
  
  // Based on parameter.md definitions
  switch (utm_source.toLowerCase()) {
    case 'google':
      if (utm_medium === 'search') {
        return 'Googleリスティング';
      }
      return 'Google';
      
    case 'tiktok':
      console.log('Matched tiktok, utm_medium:', utm_medium);
      if (utm_medium === 'ad') {
        return 'TikTok広告';
      } else if (utm_medium === 'organic') {
        return 'TikTokオーガニック';
      }
      return 'TikTok';
      
    case 'meta':
      if (utm_medium === 'ad') {
        return 'Meta広告';
      }
      return 'Meta';
      
    case 'youtube':
      if (utm_medium === 'organic') {
        return 'YouTubeオーガニック';
      }
      return 'YouTube';
      
    case 'threads':
      if (utm_medium === 'organic') {
        return 'スレッドオーガニック';
      }
      return 'スレッド';
      
    default:
      return `${utm_source}${utm_medium ? `(${utm_medium})` : ''}`;
  }
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
    
    // Determine env and feature flags
    const isProduction = process.env.NODE_ENV === 'production';
    const sendBaseOnly = process.env.LARK_SEND_BASE_ONLY === 'true';

    // Determine form origin type
    const referer = request.headers.get('referer') || '';
    const isCoupang = formOrigin === 'coupang' || /\/coupang(\?|$|\/)?.*/.test(referer);
    const isMechanicNewgrad = formOrigin === 'mechanic_newgrad' || /\/mechanic-newgrad(\?|$|\/)?.*/.test(referer);
    const isMechanic = formOrigin === 'mechanic' || /\/mechanic(\?|$|\/)?.*/.test(referer) || isMechanicNewgrad;

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
    if (sendBaseOnly) {
      if (!baseWebhookUrl) {
        console.error('Lark Base Webhook URL is not configured while LARK_SEND_BASE_ONLY=true.');
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
      }
    } else {
      if (!larkWebhookUrl) {
        console.error('Lark Webhook URL is not configured in environment variables.');
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
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
    };

    // 並列送信（Baseのみテスト中は直下の単独送信へ）
    if (!sendBaseOnly) {
      const tasks: Promise<void>[] = [];

      // Lark 送信タスク
      if (larkWebhookUrl) {
        const title = isMechanic
          ? '整備士の応募がありました！'
          : isCoupang ? 'クーパンの応募がありました！' : '新しい応募がありました！';
        const utmDisplay = utmParams?.utm_source
          ? `${utmParams.utm_source}${utmParams.utm_medium ? `(${utmParams.utm_medium})` : ''}`
          : 'RIDEJOB HP';
        const locationDisplay = formData.prefectureName || formData.municipalityName || formData.townName
          ? `${formData.prefectureName || ''} ${formData.municipalityName || ''} ${formData.townName || ''}`.replace(/\s+/g, ' ').trim()
          : '未入力';
        const mechanicQualificationsDisplay = isMechanic && mechanicQualificationsLabel
          ? `${qualificationFieldLabel}: ${mechanicQualificationsLabel}`
          : '';
        const desiredIncomeDisplay = isMechanic && !isMechanicNewgrad && desiredIncomeLabel
          ? `希望年収: ${desiredIncomeLabel}`
          : '';
        const jobIntentDisplay = isMechanic && !isMechanicNewgrad && jobIntentLabel
          ? `転職意向: ${jobIntentLabel}`
          : '';
        const transferTimingDisplay = isMechanicNewgrad ? '' : `転職時期: ${jobTimingLabel || '未選択'}`;
        const additionalFields = [transferTimingDisplay, desiredIncomeDisplay, mechanicQualificationsDisplay, jobIntentDisplay]
          .filter(Boolean)
          .join('\n');
        const ageDisplay = calculateAge(formData.birthDate) ?? '未入力';
        const messageContent = `
${title}
-------------------------
流入元: ${utmDisplay}
生年月日: ${formData.birthDate || '未入力'}
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
          content: { text: messageContent },
        } as const;

        tasks.push(
          (async () => {
            const resp = await fetch(larkWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(larkPayload),
            });
            if (!resp.ok) {
              const errorBody = await resp.text();
              console.error(`Failed to send notification to Lark (${resp.status}): ${errorBody}`);
            } else {
              const result = await resp.json();
              console.log('Lark notification sent successfully:', result);
            }
          })()
        );
      }

      // Base 送信タスク（Bitable API 直書き優先・未設定/失敗/対象外は Webhook フォールバック）
      {
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
          experiment_name: submissionData?.experiment?.name || '',
          experiment_variant: submissionData?.experiment?.variant || '',
          submitted_at: new Date().toISOString(),
          environment: process.env.NODE_ENV,
          user_agent: userAgent,
          client_ip: clientIp,
          form_origin: formOrigin || '',
          is_coupang: isCoupang,
          page_url: referer,
        } as Record<string, unknown>;

        tasks.push(saveToBase(baseWriteCtx, baseWebhookUrl, basePayload));
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
                to: recipientEmail,
                messageId: result.messageId,
                formOrigin: origin,
              });
            } else if (result.reason === 'error') {
              console.error('Confirmation email failed:', {
                to: recipientEmail,
                error: result.error,
                formOrigin: origin,
              });
            } else {
              console.log('Confirmation email skipped:', {
                to: recipientEmail,
                reason: result.reason,
                formOrigin: origin,
              });
            }
          })()
        );
      }

      // 新規応募SMS(ライド/メカの全応募者)。流入元では絞らない(電話を残した応募者に予約リンクを送る)。
      // coupang / bus は対象外(smsChannel=null)。送信本体は eeasy の共通エンドポイントに委譲。
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
          }).then(() => {})
        );
      }

      // どれかが失敗しても応募自体は成功扱い (Lark/Base/メール全て)
      await Promise.allSettled(tasks);
    } else {
      // Baseのみ送信（テストモード）— 直書き優先・フォールバック Webhook
      const userAgent = request.headers.get('user-agent') || '';
      const clientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
      const basePayload = {
        media_name: isCoupang ? 'Meta広告' : (getMediaName(utmParams || {})),
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
        experiment_name: submissionData?.experiment?.name || '',
        experiment_variant: submissionData?.experiment?.variant || '',
        submitted_at: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        user_agent: userAgent,
        client_ip: clientIp,
        form_origin: formOrigin || '',
        is_coupang: isCoupang,
        page_url: referer,
      } as Record<string, unknown>;

      await saveToBase(baseWriteCtx, baseWebhookUrl, basePayload);
    }

    // クライアントには成功したことを返す
    // (Larkへの通知成否に関わらず、データを受け付けた時点で成功とすることも多い)
    return NextResponse.json({ message: 'Application submitted successfully!' }, { status: 200 });

  } catch (error) {
    console.error('Error processing application in API route:', error);
    // 予期せぬエラー
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
} 
