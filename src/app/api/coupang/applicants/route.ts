import { NextRequest, NextResponse } from 'next/server';
import type { CoupangFormData } from '@/app/components/coupang-form/types';
import {
  COUPANG_META_CONTENT_NAME,
  JOB_POSITION_LABELS,
  LOCATION_LABELS,
} from '@/app/components/coupang-form/constants';
import { resolveAdImageUrl, isLikelyAdId } from '@/lib/meta/resolveAdImage';
import { sendMetaCapiLead } from '@/lib/meta/capi';
import { sendApplicationConfirmationEmail } from '@/lib/email/send-application-confirmation';
import { sendApplicationSms } from '@/lib/sms/send-application-sms';
import { BASE_PATH } from '@/lib/basePath';
import { getMediaName } from '@/lib/media-name';
import { resolveApplicationSourceMasterName } from '@/lib/lark-masters';

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

/** Lark Bot / AnyCross は HTTP 200 でも body 側に失敗コードを返すため両方見る。 */
function isLarkRejected(result: LarkWebhookResult): boolean {
  return hasNonZeroCode(result.code) || hasNonZeroCode(result.StatusCode);
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
}): string {
  const { utm } = params;
  return `
LIFT JOB（ロケットナウ）の応募がありました！
-------------------------
流入経路: ${describeLiftJobRoute(utm)}
キャンペーンID: ${text(utm.utm_campaign) || '未取得'}
広告セットID: ${text(utm.utm_term) || '未取得'}
CR-ID: ${text(utm.utm_content) || '未取得'}
広告ID: ${text(utm.utm_id) || '未取得'}
広告名: ${text(utm.utm_creative) || '未取得'}
LP: ${params.pageUrl || '未取得'}
メールアドレス: ${params.email || '未入力'}
氏名（漢字）: ${params.fullName || '未入力'}
氏名（ふりがな）: ${params.fullNameKana || '未入力'}
電話番号: ${params.phoneNumber || '未入力'}
希望職種: ${params.jobPositionLabel}
希望勤務地: ${params.desiredLocationLabel}
年齢: ${params.ageLabel}
生年月日: ${params.birthDateLabel}
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
    birth_date: params.formData.birthDate || '',
    submitted_at: params.submittedAt,
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


export async function POST(request: NextRequest) {
  try {
    const submissionData = (await request.json()) as CoupangSubmission;
    const {
      utmParams: submittedUtmParams,
      metaEventId,
      pageUrl: submittedPageUrl,
      landingPath: submittedLandingPath,
      initialReferrer: submittedInitialReferrer,
      attributionSource,
      ...formData
    } = submissionData;
    const utmParams = normalizeUtmParams(submittedUtmParams);
    const requestReferer = request.headers.get('referer') || '';
    const pageUrl = firstText(submittedPageUrl, requestReferer, COUPANG_EVENT_SOURCE_URL);
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

    // 必須URLの検証
    if (sendBaseOnly) {
      if (!baseWebhookUrl) {
        console.error('Lark Base Webhook URL is not configured for Coupang.');
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
      }
    } else {
      if (!larkWebhookUrl) {
        console.error('Lark Webhook URL is not configured for Coupang.');
        return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
      }
    }

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

    // 並列送信
    if (!sendBaseOnly) {
      const tasks: Promise<void>[] = [];

      // 副作用（Lark通知・Base送信・メール・SMS・CAPI）はどれも非致命なので
      // Promise.allSettled に流している。ただし fetch が throw した場合、
      // allSettled は握りつぶし **ログが1行も出ない**。
      // 2026-09-10 のE2Eで、Lark通知もBase送信も無言のまま飛んでいないことが判明した
      // （SMSのログだけが出て、通知系は成功ログも失敗ログも出ていなかった）。
      // 例外を必ず記録し、最後にまとめて可視化する。
      const taskFailures: string[] = [];
      // 失敗を1箇所に集約する。throw だけでなく **HTTPエラーやLarkの非0コードも**
      // ここへ入れないと、サマリ行が「失敗0件」と嘘をつく。
      const markFailed = (label: string) => {
        if (!taskFailures.includes(label)) taskFailures.push(label);
      };
      // run() は同期 throw しうるので Promise.resolve().then() でくるむ。
      // 直接 run().then(...) にすると同期 throw が外側 catch まで飛び、
      // 応募そのものを500で落としてしまう。
      const trackTask = (label: string, run: () => Promise<unknown>): Promise<void> =>
        Promise.resolve()
          .then(run)
          .then(
            () => undefined,
            (e: unknown) => {
              markFailed(label);
              // undici の fetch 失敗は message が 'fetch failed' としか出ないので cause まで出す。
              const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
              const cause = e instanceof Error && e.cause ? ` cause=${String((e.cause as { code?: string })?.code ?? e.cause)}` : '';
              console.error(`[coupang] ${label} threw and was swallowed: ${detail}${cause}`);
            }
          );

      // Lark 送信タスク
      if (larkWebhookUrl) {
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
        });

        const larkPayload = {
          msg_type: 'text',
          content: { text: messageContent },
        } as const;

        tasks.push(
          trackTask('lark-notification', async () => {
            const resp = await fetch(larkWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(larkPayload),
              // タイムアウトが無いと、Lark 側が応答しないときに Promise.allSettled が
              // 張り付いたまま関数が実行上限で落ち、ログが1行も残らない。
              // 既存の entry-bp ルートと同じ 5 秒に揃える。
              signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
            });
            // Lark の Webhook は **HTTP 200 でも body の code が非0なら失敗**（bot除外・トークン失効など）。
            // 200 だけ見て成功扱いにすると、届いていないのに「sent successfully」と記録される。
            const result = (await resp.json().catch(() => ({}))) as LarkWebhookResult;
            if (!resp.ok || isLarkRejected(result)) {
              markFailed('lark-notification');
              console.error(
                `[coupang] Failed to send notification to Lark (http=${resp.status} code=${result?.code ?? 'n/a'} msg=${result?.msg ?? 'n/a'})`
              );
            } else {
              console.log('[coupang] Lark notification sent successfully');
            }
          })
        );
      }

      // Base 送信タスク
      if (baseWebhookUrl) {
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
          environment: process.env.NODE_ENV,
        });

        tasks.push(
          trackTask('lark-base-webhook', async () => {
            const resp = await fetch(baseWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(basePayload),
              signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
            });
            const result = (await resp.json().catch(() => ({}))) as LarkWebhookResult;
            if (!resp.ok || isLarkRejected(result)) {
              markFailed('lark-base-webhook');
              console.error(
                `[coupang] Failed to send to Lark Base Webhook (http=${resp.status} code=${result.code ?? result.StatusCode ?? 'n/a'} msg=${result.msg ?? result.StatusMessage ?? 'n/a'})`
              );
            } else {
              console.log('[coupang] Lark Base webhook triggered successfully');
            }
          })
        );
      }

      // 自動返信メール — 非致命。クーパン専用の文面(COUPANG_CONTENT)を使う。
      // 共通ルートの実行時リスト SUPPORTED_ORIGINS は経由しない（専用ルートからの直接呼び出し）。
      //
      // ⚠️ **既定OFF。** `COUPANG_EMAIL_ENABLED=true` で点火する。
      // 文面はクライアント・運用側の確認待ちで、確認前にマージ＝自動デプロイされると
      // その瞬間から実送信が始まってしまう。既存の ENABLE_EMAIL_NOTIFICATION は
      // 全職種共通のグローバルスイッチで、止めるとタクシー・整備士の稼働中メールまで
      // 道連れになるため、クーパン単体で止められる口をここに用意する。
      if (formData.email && process.env.COUPANG_EMAIL_ENABLED === 'true') {
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
      if (formData.phoneNumber && process.env.COUPANG_SMS_ENABLED === 'true') {
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
      if (typeof metaEventId === 'string' && metaEventId) {
        const capiUserAgent = request.headers.get('user-agent') || '';
        const capiClientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
        // クロージャに入ると typeof による絞り込みが効かないので、ここで確定させる。
        const capiEventId = metaEventId;
        tasks.push(
          trackTask('meta-capi', () =>
            sendMetaCapiLead({
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
            })
          )
        );
      }

      await Promise.allSettled(tasks);

      // 応募1件につき必ず1行出す。無言で壊れていることを検知するための足跡。
      console.log('[coupang] submission settled:', {
        mode: 'full',
        tasks: tasks.length,
        failed: taskFailures,
        larkWebhookConfigured: Boolean(larkWebhookUrl),
        baseWebhookConfigured: Boolean(baseWebhookUrl),
        emailEnabled: process.env.COUPANG_EMAIL_ENABLED === 'true',
        smsEnabled: process.env.COUPANG_SMS_ENABLED === 'true',
      });
    } else {
      // Baseのみ送信（テストモード）
      if (baseWebhookUrl) {
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
          environment: process.env.NODE_ENV,
        });

        const resp = await fetch(baseWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(basePayload),
          signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
        });
        const result = (await resp.json().catch(() => ({}))) as LarkWebhookResult;
        if (!resp.ok || isLarkRejected(result)) {
          console.error(
            `[coupang] Failed to send to Lark Base Webhook (http=${resp.status} code=${result.code ?? result.StatusCode ?? 'n/a'} msg=${result.msg ?? result.StatusMessage ?? 'n/a'})`
          );
          return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
        } else {
          console.log('[coupang] Lark Base webhook triggered successfully');
        }
        // Baseのみ経路でも必ず足跡を残す（この行が無い＝無言の失敗、と読めるようにする）
        console.log('[coupang] submission settled:', {
          mode: 'base-only',
          baseWebhookConfigured: true,
        });
      }
    }

    return NextResponse.json({ message: 'Application submitted successfully!' }, { status: 200 });
  } catch (error) {
    console.error('Error processing Coupang application:', error);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
