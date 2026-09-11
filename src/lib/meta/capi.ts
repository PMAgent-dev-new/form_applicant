import { createHash } from 'crypto';
import { describeError } from '../describe-error';

/**
 * Meta Conversions API（サーバー側）。
 * ブラウザの Pixel と同一 event_id を送ることで重複排除される。
 * 失敗は非致命（呼び出し側で握りつぶす）。
 */

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN ?? '';
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE;
const API_VERSION = 'v21.0';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** メールは小文字・前後空白除去してから SHA256。 */
function hashEmail(email?: string): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized ? sha256(normalized) : undefined;
}

/** 電話は数字のみにし、日本の先頭0を国番号81へ正規化してから SHA256。 */
function hashPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  if (digits.startsWith('0')) digits = `81${digits.slice(1)}`;
  return sha256(digits);
}

export type MetaCapiLeadInput = {
  eventId: string;
  eventSourceUrl?: string;
  email?: string;
  phone?: string;
  fbp?: string;
  fbc?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  contentIds?: string[];
  /** custom_data.content_name。職種別にカスタムコンバージョンで切り出すための識別子。 */
  contentName?: string;
  value?: number;
  currency?: string;
};

export async function sendMetaCapiLead(input: MetaCapiLeadInput): Promise<{ ok: boolean; status?: number; skipped?: string }> {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn('[CAPI] NEXT_PUBLIC_META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not configured, skipping');
    // 未設定は送信失敗ではなくスキップ（メール/SMS/Meta CAPI は未設定なら自動スキップする付加機能:
    // src/app/api/health/route.ts）。呼び出し側が送信失敗と区別できるよう理由を返す。
    return { ok: false, skipped: 'not_configured' };
  }

  const userData: Record<string, unknown> = {};
  const em = hashEmail(input.email);
  const ph = hashPhone(input.phone);
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  if (input.clientIpAddress) userData.client_ip_address = input.clientIpAddress;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;

  const customData: Record<string, unknown> = {};
  if (input.contentIds && input.contentIds.length > 0) {
    customData.content_ids = input.contentIds;
    customData.content_type = 'product';
  }
  if (input.contentName) customData.content_name = input.contentName;
  if (typeof input.value === 'number') customData.value = input.value;
  if (input.currency) customData.currency = input.currency;

  const event: Record<string, unknown> = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: 'website',
    user_data: userData,
    custom_data: customData,
  };
  // eventSourceUrl は referer 由来で、取れないと空文字になる。
  // website イベントで event_source_url に空文字を送るとイベントごと弾かれうるため、
  // 値が無いときはキー自体を落とす（呼び出し側でフォールバックURLを渡すのが望ましい）。
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;

  const body: Record<string, unknown> = { data: [event] };
  if (TEST_EVENT_CODE) body.test_event_code = TEST_EVENT_CODE;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // タイムアウト必須（OpenAI CAPI と同じ 5 秒）。応募APIは全タスクを await してからレスポンスを返すため、
        // Meta が応答しないと Promise.allSettled が張り付き、サマリ行も出ないまま実行上限で打ち切られる。
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) {
      // 本文の読み取り中にタイムアウトしても、HTTP ステータスは残す（catch に落とすと status が消える）。
      const text = await res.text().catch(() => '');
      console.error(`[CAPI] Lead send failed: ${res.status} ${text.slice(0, 300)}`);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (error) {
    // エラーオブジェクトを丸ごと渡さない（describeError 参照）。タイムアウトは 'TimeoutError: ...' になる。
    console.error(`[CAPI] Lead send error: ${describeError(error)}`);
    return { ok: false };
  }
}
