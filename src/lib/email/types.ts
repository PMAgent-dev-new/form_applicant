/**
 * 自動返信メール対応フォームの種別。
 *
 * coupang(ロケットナウ)は専用ルート /api/coupang/applicants から直接
 * sendApplicationConfirmationEmail を呼ぶ。共通ルート側の実行時リスト
 * SUPPORTED_ORIGINS には**あえて追加しない**（追加すると休眠中の共通ルート
 * coupang 分岐でも発火し、二重送信の芽になるため）。
 */
export type EmailFormOrigin =
  | 'default'
  | 'bus'
  | 'mechanic'
  | 'mechanic_newgrad'
  | 'truck'
  | 'coupang';

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
