/**
 * Gmail API クライアント
 *
 * 認証方式: Service Account + Domain-Wide Delegation
 *   - GCP のサービスアカウントを Workspace 管理コンソールで
 *     スコープ `https://www.googleapis.com/auth/gmail.send` のみ許可しておく
 *   - 実行時に `GMAIL_SENDER_EMAIL` (例: yui@pmagent.jp) を impersonate して送信
 *
 * 必要な環境変数:
 *   - GOOGLE_SERVICE_ACCOUNT_KEY_BASE64  サービスアカウントJSONをbase64化したもの
 *     (または GOOGLE_SERVICE_ACCOUNT_KEY に生JSONを格納)
 *   - GMAIL_SENDER_EMAIL                 送信元 (impersonate対象) のメールアドレス
 */

import { JWT } from 'google-auth-library';
import { describeError } from '../describe-error';

/**
 * Gmail への1リクエストあたりのタイムアウト（トークン取得・送信のそれぞれに効く）。
 * 他の外部送信（Lark・OpenAI CAPI）と同じ 5 秒。応募APIは全タスクを await してからレスポンスを返すため、
 * 無いと相手が応答しないときに Promise.allSettled が張り付き、サマリ行も出ないまま実行上限で打ち切られる。
 */
const GMAIL_TIMEOUT_MS = 5000;

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
};

let cachedKey: ServiceAccountKey | null = null;
let cachedJwtClient: JWT | null = null;
let cachedJwtSubject: string | null = null;

function loadServiceAccountKey(): ServiceAccountKey {
  if (cachedKey) return cachedKey;

  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64 && !raw) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 (or GOOGLE_SERVICE_ACCOUNT_KEY) is not set.'
    );
  }

  const jsonText = b64
    ? Buffer.from(b64, 'base64').toString('utf-8')
    : (raw as string);

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(jsonText) as { client_email?: string; private_key?: string };
  } catch {
    throw new Error('Service account key is not valid JSON.');
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service account key JSON is missing client_email or private_key.');
  }

  cachedKey = {
    client_email: parsed.client_email,
    // PEM の改行が `\n` に化けているケースに対応
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
  };
  return cachedKey;
}

function getJwtClient(impersonateEmail: string): JWT {
  if (cachedJwtClient && cachedJwtSubject === impersonateEmail) {
    return cachedJwtClient;
  }
  const key = loadServiceAccountKey();
  cachedJwtClient = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: impersonateEmail,
    // トークン取得（oauth2.googleapis.com）は google-auth-library 内部の gaxios が行い、既定では
    // タイムアウトが無い。相手が応答しないと getAccessToken() が返らず、取得中のリクエストは
    // ライブラリがまとめるため、同じインスタンスの後続の応募もそれを待ち続ける（2026-09-10 に手元で実測）。
    // 無応答はこの時間で打ち切られ、再試行されない（gaxios が Node では node-fetch を使うため。
    // ネイティブ fetch を使う形に変わると、無応答も再試行されて最大3回になる）。接続断・5xx は既定どおり再試行する。
    // 再試行は前の試行の締切が残っていればそれを引き継ぎ、過ぎていれば新たにこの時間で切れる
    // （合計の上限は、毎回締切の直前に 5xx が返る極端な場合で約22秒）。
    transporterOptions: { timeout: GMAIL_TIMEOUT_MS },
  });
  cachedJwtSubject = impersonateEmail;
  return cachedJwtClient;
}

/**
 * RFC 2047 (encoded-word, B-encoding) を使って、非ASCIIを含むヘッダー値をエンコードする。
 * ASCIIのみであればそのまま返す。
 */
export function encodeMimeWord(value: string): string {
  // ASCII (printable) のみならエンコード不要
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const base64 = Buffer.from(value, 'utf-8').toString('base64');
  return `=?UTF-8?B?${base64}?=`;
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * multipart/alternative (text + html) の MIME メッセージを組み立て、
 * Gmail API の `raw` フィールドに渡せる base64url 文字列を返す。
 *
 * BCC について:
 *   Bcc ヘッダーを raw メッセージに含めると、Gmail API は BCC 宛にも配信し、
 *   かつ To/Cc 宛の受信メッセージからは Bcc ヘッダーを削除して配信する。
 */
export function buildMimeMessage(opts: {
  from: string;
  fromName?: string;
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
}): string {
  const boundary = `___boundary_${Math.random().toString(36).slice(2)}_${Date.now()}___`;
  const fromHeader = opts.fromName
    ? `${encodeMimeWord(opts.fromName)} <${opts.from}>`
    : opts.from;

  const headerLines: string[] = [
    `From: ${fromHeader}`,
    `To: ${opts.to}`,
  ];

  if (opts.cc && opts.cc.length > 0) {
    headerLines.push(`Cc: ${opts.cc.join(', ')}`);
  }
  if (opts.bcc && opts.bcc.length > 0) {
    headerLines.push(`Bcc: ${opts.bcc.join(', ')}`);
  }

  headerLines.push(
    `Subject: ${encodeMimeWord(opts.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  );

  const lines: string[] = [
    ...headerLines,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(opts.textBody, 'utf-8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(opts.htmlBody, 'utf-8').toString('base64'),
    `--${boundary}--`,
    '',
  ];

  return toBase64Url(Buffer.from(lines.join('\r\n'), 'utf-8'));
}

/**
 * Gmail API の users.messages.send を呼んでメールを送信する。
 * 失敗時は throw する(呼び出し側で握り潰す前提)。トークン取得・送信とも GMAIL_TIMEOUT_MS で打ち切る。
 */
export async function sendGmailMessage(opts: {
  to: string;
  /** 送信元 (impersonate対象)。例: support_team@pmagent.jp */
  from: string;
  fromName?: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
}): Promise<{ messageId?: string }> {
  const auth = getJwtClient(opts.from);
  let accessToken: string | null | undefined;
  try {
    const tokenResp = await auth.getAccessToken();
    accessToken = tokenResp.token;
  } catch (e) {
    // gaxios の打ち切りは 'The operation was aborted.' としか出ず、どこで止まったか分からない。
    // 送信側のタイムアウト（TimeoutError）と区別できるよう、トークン取得の失敗だと分かる文言にする。
    // gaxios は応答本文が JSON でないと本文をそのまま message に入れる（HTML のエラーページ等）ので、先頭300字に切る。
    throw new Error(`Failed to obtain Gmail API access token: ${describeError(e).slice(0, 300)}`);
  }
  if (!accessToken) {
    throw new Error('Failed to obtain Gmail API access token.');
  }

  const raw = buildMimeMessage(opts);

  const url = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(opts.from)}/messages/send`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(GMAIL_TIMEOUT_MS),
  });

  if (!resp.ok) {
    // 本文の読み取り中にタイムアウトしても、HTTP ステータスは残す。
    const errorBody = await resp.text().catch(() => '');
    throw new Error(`Gmail API send failed (${resp.status}): ${errorBody.slice(0, 300)}`);
  }

  // 2xx なら送信は成立している。messageId の読み取りがタイムアウトしても送信失敗にはしない
  // （失敗と数えると、届いているのに未送信として記録される）。
  const json = (await resp.json().catch(() => ({}))) as { id?: string };
  return { messageId: json.id };
}
