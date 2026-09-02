import { createHash } from 'crypto';

/**
 * OpenAI（ChatGPT広告）Conversions API。サーバー側から応募完了を送る。
 *
 * ## なぜサーバー側か
 * ブラウザPixelは入れていない。Pixelを入れずCAPIだけで運用する場合、
 * **クリックとの突合に使えるのは oppref だけ**になる。
 * 公式ドキュメント: 「Unlike the pixel, the API does not capture oppref for you.
 * Capture the value yourself and pass it with the server event.」
 * → 着地時に oppref を拾って Cookie(rj_attr) に保存し、応募時にここへ渡す。
 *   参照: src/lib/attribution.ts
 *
 * ## 個人情報について（既定では送らない）
 * user オブジェクト（ハッシュ化したメール・電話・氏名、IP、UA）はマッチ率を上げるが、
 * **OpenAI という新しい第三者への個人データ提供**にあたる。プライバシーポリシー側の
 * 判断が要るため、既定では送らず `OPENAI_ADS_ADVANCED_MATCHING=true` で明示的に有効化する。
 *
 * 失敗は非致命。応募処理そのものは絶対に止めない（Meta CAPI と同じ方針）。
 */

const ENDPOINT = 'https://bzr.openai.com/v1/events';
const PIXEL_ID = process.env.OPENAI_ADS_PIXEL_ID ?? '';
const API_KEY = process.env.OPENAI_ADS_CAPI_KEY ?? '';
const ADVANCED_MATCHING = process.env.OPENAI_ADS_ADVANCED_MATCHING === 'true';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** メール: 前後空白を除去して小文字化してから SHA256。 */
export function hashEmail(email?: string): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized ? sha256(normalized) : undefined;
}

/**
 * 電話: 記号を除去し、国番号を保持したうえで先頭の 0 を落として SHA256。
 * 日本の国内表記（090-1234-5678）は国番号が無いので 81 を補う。
 * 補わずに先頭0だけ落とすと 9012345678 となり、別の国の番号として扱われる。
 */
export function hashPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[\s().+-]/g, '').replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const withCountry = digits.startsWith('0') ? `81${digits.replace(/^0+/, '')}` : digits;
  if (withCountry.length < 8 || withCountry.length > 15) return undefined;
  return sha256(withCountry);
}

export type OpenAiConversionInput = {
  /** 冪等キー。再送時は同じ値を使う（Meta と同じ submission 単位のIDを流用している）。 */
  eventId: string;
  /** OpenAI がクリック時に着地URLへ付ける識別子。これが無いとクリックと突合できない。 */
  oppref?: string;
  /** action_source=web では必須。 */
  sourceUrl?: string;
  email?: string;
  phone?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  /** テスト用。省略時は現在時刻。 */
  timestampMs?: number;
};

type OpenAiEvent = {
  id: string;
  type: 'registration_completed';
  timestamp_ms: number;
  action_source: 'web';
  data: { type: 'customer_action' };
  oppref?: string;
  source_url?: string;
  user?: Record<string, unknown>;
};

/**
 * 送信するイベント本体を組み立てる。突合材料が何も無ければ null を返す。
 *
 * oppref が無く advanced matching も無効なら、OpenAI 側はこのイベントを
 * どのクリックにも紐づけられない。レポートに乗らないイベントを積むだけなので送らない。
 */
export function buildConversionEvent(input: OpenAiConversionInput): OpenAiEvent | null {
  const user: Record<string, unknown> = {};
  if (ADVANCED_MATCHING) {
    const em = hashEmail(input.email);
    const ph = hashPhone(input.phone);
    if (em) user.emails_sha256 = [em];
    if (ph) user.phone_numbers_sha256 = [ph];
    if (input.clientIpAddress) user.ip_address = input.clientIpAddress;
    if (input.clientUserAgent) user.user_agent = input.clientUserAgent;
  }

  const hasMatchSignal = Boolean(input.oppref) || Object.keys(user).length > 0;
  if (!hasMatchSignal) return null;

  const event: OpenAiEvent = {
    id: input.eventId,
    type: 'registration_completed',
    timestamp_ms: input.timestampMs ?? Date.now(),
    action_source: 'web',
    data: { type: 'customer_action' },
  };
  if (input.oppref) event.oppref = input.oppref;
  if (input.sourceUrl) event.source_url = input.sourceUrl;
  if (Object.keys(user).length > 0) event.user = user;
  return event;
}

export async function sendOpenAiConversion(
  input: OpenAiConversionInput,
): Promise<{ ok: boolean; status?: number; skipped?: string }> {
  // 先に「送るべきイベントか」を判定する。順序を逆にすると、env 未設定の間は
  // 全応募（大半が Meta 経由）で警告が鳴り続け、読まれない警告になる。
  const event = buildConversionEvent(input);
  if (!event) {
    // oppref が無い＝広告クリック由来ではない応募。突合できないので送らない。
    return { ok: false, skipped: 'no_match_signal' };
  }

  if (!PIXEL_ID || !API_KEY) {
    // ここで鳴る＝「oppref があるのに設定漏れで取りこぼしたCV」。放置してはいけない警告。
    console.warn('[OpenAI CAPI] OPENAI_ADS_PIXEL_ID / OPENAI_ADS_CAPI_KEY 未設定のため送信しません（oppref あり）');
    return { ok: false, skipped: 'not_configured' };
  }

  try {
    const res = await fetch(`${ENDPOINT}?pid=${encodeURIComponent(PIXEL_ID)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ validate_only: false, events: [event] }),
      // タイムアウト必須。応募APIは全タスクを await してからレスポンスを返すため、
      // ここがハングすると応募者の待ち時間に直結する（最悪、保存済みなのにエラー画面）。
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[OpenAI CAPI] 送信失敗', res.status, text.slice(0, 300));
      return { ok: false, status: res.status };
    }
    console.log('[OpenAI CAPI] 送信成功', event.id, event.oppref ? 'oppref=あり' : 'oppref=なし');
    return { ok: true, status: res.status };
  } catch (e) {
    console.error('[OpenAI CAPI] 送信でエラー', e);
    return { ok: false };
  }
}
