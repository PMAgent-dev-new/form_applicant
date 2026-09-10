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
import {
  createTaskTracker,
  describeError,
  LARK_FETCH_TIMEOUT_MS,
  readLarkResult,
} from '@/lib/side-effects';

/**
 * referer が取れないときに CAPI へ渡す既定の event_source_url。
 * 同じコードが2ゾーンで動くため、固定値にすると旧ドメインからの応募が
 * 新ドメイン由来として記録される。BASE_PATH でゾーンを判別して振り分ける。
 */
const COUPANG_EVENT_SOURCE_URL = BASE_PATH
  ? 'https://ridejob.jp/entry/coupang'
  : 'https://ridejob.pmagent.jp/coupang';

type UTMParams = {
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
};

/**
 * Base 自動化 Webhook へ送る（通常経路・Baseのみ経路の両方で使う）。
 * 失敗は HTTP ステータスで判定する。HTTP 200 で code が 0 でない応答は、Base 自動化 Webhook が
 * 成功時に何を返すかの一次情報が無く、失敗と決めつけると誤警報になりうるので警告だけ残す（共通ルートと同じ）。
 * 応答本文はログに出さない（readLarkResult が code と msg に絞る）。
 * 例外（タイムアウト・通信エラー）は呼び出し側へそのまま投げる。
 */
async function sendToBaseWebhook(
  url: string,
  payload: Record<string, unknown>,
  markFailed: (label: string) => void
): Promise<void> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
  });
  const result = await readLarkResult(resp);
  if (!resp.ok) {
    markFailed('lark-base-webhook');
    console.error(`[coupang] Failed to send to Lark Base Webhook (${result.detail})`);
    return;
  }
  if (!result.ok) {
    console.warn(
      `[coupang] Lark Base Webhook: HTTP ${resp.status} だが code が 0 ではない（${result.detail}）。応答形式が未確認のため失敗には数えない`
    );
  }
  console.log('[coupang] Lark Base webhook triggered successfully');
}

export async function POST(request: NextRequest) {
  try {
    const submissionData = (await request.json()) as CoupangSubmission;
    const { utmParams, ...formData } = submissionData;

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

    // 副作用（Lark通知・Base送信・メール・SMS・CAPI）の失敗を1箇所に集める（src/lib/side-effects.ts）。
    // throw だけでなく **HTTPエラーやLarkの非0コードも** markFailed で入れる。入れないと、
    // サマリ行が「失敗0件」と嘘をつく。
    const { failures: taskFailures, markFailed, trackTask } = createTaskTracker('[coupang]');
    let taskCount = 0;

    // 並列送信
    if (!sendBaseOnly) {
      const tasks: Promise<void>[] = [];

      // 副作用（Lark通知・Base送信・メール・SMS・CAPI）はどれも非致命なので
      // Promise.allSettled に流している。ただし fetch が throw した場合、
      // allSettled は握りつぶし **ログが1行も出ない**。
      // 2026-09-10 のE2Eで、Lark通知もBase送信も無言のまま飛んでいないことが判明した
      // （SMSのログだけが出て、通知系は成功ログも失敗ログも出ていなかった）。
      // 各タスクは trackTask でくるみ、例外を必ず記録する。

      // Lark 送信タスク
      if (larkWebhookUrl) {
        const utmDisplay = utmParams?.utm_source
          ? `${utmParams.utm_source}${utmParams.utm_medium ? `(${utmParams.utm_medium})` : ''}`
          : 'RIDEJOB HP';

        const messageContent = `
ロケットナウの応募がありました！
-------------------------
流入元: ${utmDisplay}
メールアドレス: ${formData.email || '未入力'}
氏名（漢字）: ${formData.fullName || '未入力'}
氏名（ふりがな）: ${formData.fullNameKana || '未入力'}
電話番号: ${formData.phoneNumber || '未入力'}
希望職種: ${jobPositionLabel}
希望勤務地: ${desiredLocationLabel}
年齢: ${ageLabel}
生年月日: ${birthDateLabel}
-------------------------
        `.trim();

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
              signal: AbortSignal.timeout(LARK_FETCH_TIMEOUT_MS),
            });
            // Lark の Webhook は **HTTP 200 でも body の code が非0なら失敗**（bot除外・トークン失効など）。
            // 200 だけ見て成功扱いにすると、届いていないのに「sent successfully」と記録される。
            // 本文の読み取り中のタイムアウトも readLarkResult が握りつぶさずに投げる。
            const result = await readLarkResult(resp);
            if (!result.ok) {
              markFailed('lark-notification');
              console.error(`[coupang] Failed to send notification to Lark (${result.detail})`);
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

        const basePayload = {
          media_name: 'Meta広告',
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
          email: formData.email || '',
          full_name: formData.fullName || '',
          full_name_kana: formData.fullNameKana || '',
          phone_number: formData.phoneNumber || '',
          job_position: jobPositionLabel,
          desired_location: desiredLocationLabel,
          age: formData.age || '',
          birth_date: formData.birthDate || '',
          submitted_at: new Date().toISOString(),
          environment: process.env.NODE_ENV,
          user_agent: userAgent,
          client_ip: clientIp,
          form_origin: 'coupang_rocketnow',
        } as Record<string, unknown>;

        tasks.push(
          trackTask('lark-base-webhook', () => sendToBaseWebhook(baseWebhookUrl, basePayload, markFailed))
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
      if (typeof submissionData.metaEventId === 'string' && submissionData.metaEventId) {
        const capiUserAgent = request.headers.get('user-agent') || '';
        const capiClientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
        const capiReferer = request.headers.get('referer') || '';
        // クロージャに入ると typeof による絞り込みが効かないので、ここで確定させる。
        const capiEventId = submissionData.metaEventId;
        tasks.push(
          trackTask('meta-capi', async () => {
            const r = await sendMetaCapiLead({
              eventId: capiEventId,
              // referer が取れない場合でも website イベントとして成立させる。
              eventSourceUrl: capiReferer || COUPANG_EVENT_SOURCE_URL,
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
            // 送信失敗（HTTPエラー・通信エラー）はライブラリがログを出して ok:false を返す。
            // throw しないので、ここで数えないとサマリが「失敗0件」になる。
            // 未設定（skipped）は数えない。未設定なら自動スキップする付加機能なので（health/route.ts）、
            // 数えるとその環境では全応募が failed になり、サマリが読まれなくなる。
            if (!r.ok && !r.skipped) markFailed('meta-capi');
          })
        );
      }

      await Promise.allSettled(tasks);
      taskCount = tasks.length;
    } else {
      // Baseのみ送信（テストモード）。例外（タイムアウト等）は従来どおり外側 catch で500にする。
      if (baseWebhookUrl) {
        const userAgent = request.headers.get('user-agent') || '';
        const clientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';

        const basePayload = {
          media_name: 'Meta広告',
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
          email: formData.email || '',
          full_name: formData.fullName || '',
          full_name_kana: formData.fullNameKana || '',
          phone_number: formData.phoneNumber || '',
          job_position: jobPositionLabel,
          desired_location: desiredLocationLabel,
          age: formData.age || '',
          birth_date: formData.birthDate || '',
          submitted_at: new Date().toISOString(),
          environment: process.env.NODE_ENV,
          user_agent: userAgent,
          client_ip: clientIp,
          form_origin: 'coupang_rocketnow',
        } as Record<string, unknown>;

        await sendToBaseWebhook(baseWebhookUrl, basePayload, markFailed);
        taskCount = 1;
      }
    }

    // 応募1件につき必ず1行出す（Baseのみ経路も含む）。無言で壊れていることを検知するための足跡。
    // この行が無い応募は、途中で例外に落ちたか、必須の Webhook URL が未設定で 500 を返したか
    // （どちらも専用の error ログが出る）、実行上限で打ち切られている。
    // オブジェクトのまま渡すと util.inspect が複数行に折り返し、行単位の grep で failed が見えなくなる。
    // JSON にして物理的に1行にする。
    console.log('[coupang] submission settled:', JSON.stringify({
      mode: sendBaseOnly ? 'base-only' : 'full',
      tasks: taskCount,
      failed: taskFailures,
      larkWebhookConfigured: Boolean(larkWebhookUrl),
      baseWebhookConfigured: Boolean(baseWebhookUrl),
      emailEnabled: process.env.COUPANG_EMAIL_ENABLED === 'true',
      smsEnabled: process.env.COUPANG_SMS_ENABLED === 'true',
    }));

    return NextResponse.json({ message: 'Application submitted successfully!' }, { status: 200 });
  } catch (error) {
    // エラーオブジェクトを丸ごと渡さない。応募本文の JSON が壊れていると、
    // SyntaxError の message に氏名・メール・電話の断片が載る（describeError 参照）。
    console.error('Error processing Coupang application:', describeError(error));
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
