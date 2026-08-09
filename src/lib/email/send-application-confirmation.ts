/**
 * 応募受付完了メール送信の高レベル API。
 *
 * - 環境変数で全体ON/OFF (`ENABLE_EMAIL_NOTIFICATION=false` で無効化)
 * - `EMAIL_DRY_RUN=true` で実送信せずログのみ
 * - 送信失敗時も throw せず SendResult として返す (呼び出し側でフォーム送信成功は維持)
 */

import { sendGmailMessage } from './gmail-client';
import {
  buildApplicationConfirmationHtml,
  buildApplicationConfirmationText,
  getBrandConfig,
} from './templates/application-confirmation';
import type {
  ApplicationConfirmationInput,
  EmailFormOrigin,
  SendResult,
} from './types';

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

/** カンマ区切りのメールアドレスリストをパース。空白除去・空要素除去・形式チェックを行う。 */
function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && EMAIL_PATTERN.test(s));
}

const SUPPORTED_ORIGINS: readonly EmailFormOrigin[] = [
  'default',
  'bus',
  'mechanic',
  'mechanic_newgrad',
  'truck',
];

export function isSupportedEmailOrigin(
  value: string | undefined | null
): value is EmailFormOrigin {
  return !!value && (SUPPORTED_ORIGINS as readonly string[]).includes(value);
}

export async function sendApplicationConfirmationEmail(
  input: ApplicationConfirmationInput
): Promise<SendResult> {
  if (process.env.ENABLE_EMAIL_NOTIFICATION === 'false') {
    return { sent: false, reason: 'disabled' };
  }

  const to = input.to?.trim();
  if (!to) {
    return { sent: false, reason: 'no-email' };
  }
  if (!EMAIL_PATTERN.test(to)) {
    return { sent: false, reason: 'invalid-email' };
  }

  const senderEmail = process.env.GMAIL_SENDER_EMAIL;
  if (!senderEmail) {
    return {
      sent: false,
      reason: 'error',
      error: 'GMAIL_SENDER_EMAIL is not configured.',
    };
  }

  const brand = getBrandConfig(input.formOrigin);
  const fromName =
    process.env.GMAIL_SENDER_NAME_OVERRIDE || brand.fromName;
  const subject = brand.subject;

  const htmlBody = buildApplicationConfirmationHtml(input);
  const textBody = buildApplicationConfirmationText(input);

  // CC / BCC を環境変数から読み取り (カンマ区切り)
  const cc = parseEmailList(process.env.GMAIL_CC);
  const bcc = parseEmailList(process.env.GMAIL_BCC);

  if (process.env.EMAIL_DRY_RUN === 'true') {
    console.log('[EMAIL_DRY_RUN] Would send confirmation email', {
      to,
      cc,
      bcc,
      from: senderEmail,
      fromName,
      subject,
      formOrigin: input.formOrigin,
    });
    return { sent: false, reason: 'dry-run' };
  }

  try {
    const result = await sendGmailMessage({
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      from: senderEmail,
      fromName,
      subject,
      textBody,
      htmlBody,
    });
    return { sent: true, messageId: result.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sent: false, reason: 'error', error: message };
  }
}
