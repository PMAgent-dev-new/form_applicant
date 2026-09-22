/**
 * 新規応募SMS送信の高レベル API(ライド/メカ/クーパンのフォーム応募者向け・流入元不問)。
 *
 * 送信本体は eeasy(leomeet) の共通エンドポイント /api/sms/send に委譲する
 * (文面・事業部マッピング・CPaaS送信・効果測定記録は eeasy 側に一元化)。
 *
 * - 環境変数で全体ON/OFF (`META_SMS_ENABLED=true` で有効。未設定は送らない)
 * - `META_SMS_DRY_RUN=true` で実送信せずログのみ
 * - 送信失敗時も throw せず結果を返す(呼び出し側でフォーム送信成功は維持)
 * - eeasy が5秒以内に応答しなければ打ち切り、reason: 'error' を返す
 *
 * 必要な環境変数:
 *   META_SMS_ENABLED    'true' で有効化
 *   EEASY_SMS_SEND_URL  例: https://leomeet.pmagent.jp/api/sms/send
 *   SMS_SEND_SECRET     eeasy 側 SMS_SEND_SECRET と一致させる Bearer トークン
 *   META_SMS_DRY_RUN    'true' でドライラン(任意)
 */

import { describeError } from '../describe-error';

/**
 * eeasy(leomeet) 側に登録されたチャネル名。文面と予約リンク先は eeasy 側が持つ。
 * ⚠️ eeasy 側に未登録のチャネルを渡すと、レスポンスが skipped になり**無言で送られない**。
 * 新しいチャネルを足すときは eeasy 側の登録を先に済ませること。
 */
export type SmsChannel = 'ridejob' | 'mechanic' | 'coupang';

export type SmsSendResult = {
  sent: boolean;
  reason?: string;
  deliveryOrderId?: number;
  ref?: string;
  error?: string;
};

export async function sendApplicationSms(input: {
  channel: SmsChannel;
  phone?: string;
  applicantName?: string;
  /** 流入元ラベル(eeasy の sms_messages.media に記録)。未指定は 'form'。 */
  media?: string;
}): Promise<SmsSendResult> {
  if (process.env.META_SMS_ENABLED !== 'true') {
    return { sent: false, reason: 'disabled' };
  }
  const url = process.env.EEASY_SMS_SEND_URL;
  const secret = process.env.SMS_SEND_SECRET;
  if (!url || !secret) {
    return { sent: false, reason: 'not_configured' };
  }
  if (!input.phone) {
    return { sent: false, reason: 'no_phone' };
  }
  if (process.env.META_SMS_DRY_RUN === 'true') {
    console.log('[meta-sms] dry-run', { channel: input.channel, hasName: !!input.applicantName });
    return { sent: false, reason: 'dry_run' };
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: input.phone,
        channel: input.channel,
        media: input.media || 'form',
        applicantName: input.applicantName || undefined,
      }),
      // タイムアウト必須。応募APIは全タスクを await してからレスポンスを返すため、eeasy が応答しないと
      // Promise.allSettled が張り付き、サマリ行も出ないまま実行上限で打ち切られる。
      // 値は他の外部送信（Lark・OpenAI CAPI）と同じ 5 秒。
      signal: AbortSignal.timeout(5000),
    });
    // 2xx の本文の読み取り中のタイムアウトは握りつぶさない。{} に落とすと成否（data.ok）を確かめないまま
    // `http_200` と記録され、原因がタイムアウトだと分からなくなる。
    // 2xx 以外は従来どおり {} にして `http_<status>` を返す（ステータスを残す）。壊れた JSON も従来どおり {} 扱い。
    const data = (await resp.json().catch((e: unknown) => {
      if (resp.ok && e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw e;
      return {};
    })) as {
      ok?: boolean;
      skipped?: string;
      error?: string;
      deliveryOrderId?: number;
      ref?: string;
    };
    if (resp.ok && data.ok) {
      return { sent: true, deliveryOrderId: data.deliveryOrderId, ref: data.ref };
    }
    return { sent: false, reason: data.skipped || data.error || `http_${resp.status}` };
  } catch (e) {
    // error は呼び出し側がログに出す。message だけだと undici の 'fetch failed' の原因（ECONNRESET 等）が
    // 消えるので describeError で1行にする（タイムアウトは 'TimeoutError: ...' になる）。
    return { sent: false, reason: 'error', error: describeError(e) };
  }
}
