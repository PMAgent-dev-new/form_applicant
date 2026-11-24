import { validEmail } from "./policy";
export class ScoutError extends Error {
  constructor(
    public code: string,
    public status = 503,
  ) {
    super(code);
  }
}
export function scoutConfig() {
  if (process.env.SCOUT_ENABLED !== "true")
    throw new ScoutError("スカウト機能は準備中です", 404);
  const databaseUrl = process.env.SUBMISSION_VAULT_URL;
  const serviceKey = process.env.SUBMISSION_VAULT_SERVICE_KEY;
  const publicUrl = process.env.SCOUT_PUBLIC_URL;
  const authKey = process.env.SCOUT_SUPABASE_ANON_KEY;
  const secret = process.env.SCOUT_TOKEN_SECRET;
  if (
    !databaseUrl ||
    !serviceKey ||
    !publicUrl ||
    !authKey ||
    !secret ||
    secret.length < 32
  )
    throw new ScoutError("管理者による接続設定が必要です");
  const url = new URL(publicUrl);
  if (
    (url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV === "development" && url.hostname === "127.0.0.1"
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ScoutError("公開URLの設定を確認してください");
  return {
    databaseUrl: databaseUrl.replace(/\/+$/, ""),
    serviceKey,
    authKey,
    secret,
    publicUrl: publicUrl.replace(/\/+$/, ""),
  };
}
export function senderConfig() {
  const from = process.env.SCOUT_FROM_EMAIL?.trim();
  const replyTo = process.env.SCOUT_REPLY_TO?.trim();
  const address = process.env.SCOUT_SENDER_POSTAL_ADDRESS?.trim();
  if (
    !from ||
    !replyTo ||
    !validEmail(from) ||
    !validEmail(replyTo) ||
    !address ||
    address.length > 200 ||
    /[\r\n]/.test(address)
  )
    throw new ScoutError("送信元・返信先・事業者住所の設定が必要です");
  return { from, replyTo, address, name: "RIDE JOB（株式会社PM Agent）" };
}
