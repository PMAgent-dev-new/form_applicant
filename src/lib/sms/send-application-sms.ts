/**
 * 新規応募SMS送信の高レベル API(ライド/メカ/クーパンのフォーム応募者向け・流入元不問)。
 *
 * 送信本体は eeasy(leomeet) の共通エンドポイント /api/sms/send に委譲する
 * (文面・事業部マッピング・CPaaS送信・効果測定記録は eeasy 側に一元化)。
 *
 * - 環境変数で全体ON/OFF (`META_SMS_ENABLED=true` で有効。未設定は送らない)
 * - `META_SMS_DRY_RUN=true` で実送信せずログのみ
 * - 送信失敗時も throw せず結果を返す(呼び出し側でフォーム送信成功は維持)
 *
 * 必要な環境変数:
 *   META_SMS_ENABLED    'true' で有効化
 *   EEASY_SMS_SEND_URL  例: https://leomeet.pmagent.jp/api/sms/send
 *   SMS_SEND_SECRET     eeasy 側 SMS_SEND_SECRET と一致させる Bearer トークン
 *   META_SMS_DRY_RUN    'true' でドライラン(任意)
 */

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
    });
    const data = (await resp.json().catch(() => ({}))) as {
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
    return { sent: false, reason: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
