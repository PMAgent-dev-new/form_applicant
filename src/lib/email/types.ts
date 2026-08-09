/**
 * 自動返信メール対応フォームの種別。
 * Coupang(ロケットナウ)は別ルート/別仕様なのでここには含めない。
 */
export type EmailFormOrigin = 'default' | 'bus' | 'mechanic' | 'mechanic_newgrad' | 'truck';

export type ApplicationConfirmationInput = {
  to: string;
  applicantName: string;
  applicantNameKana?: string;
  phoneNumber?: string;
  email: string;
  formOrigin: EmailFormOrigin;
};

export type SendSkippedReason =
  | 'disabled'
  | 'dry-run'
  | 'invalid-email'
  | 'no-email'
  | 'unsupported-origin';

export type SendResult =
  | { sent: true; messageId?: string }
  | { sent: false; reason: SendSkippedReason }
  | { sent: false; reason: 'error'; error: string };
