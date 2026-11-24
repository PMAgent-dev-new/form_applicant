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
  const from = "ridejob@pmagent.jp";
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

// 2026-11-24 三木さん承認。担当者・媒体をまたぐ同一人への接触制限。
export const SCOUT_BATCH_LIMIT = 300;
export const SCOUT_COOLDOWN_HOURS = 168;

export function claudeConfig() {
  const key = process.env.SCOUT_CLAUDE_API_KEY;
  const model = process.env.SCOUT_CLAUDE_MODEL;
  const monthlyLimit = Number(process.env.SCOUT_AI_MONTHLY_LIMIT);
  if (
    process.env.SCOUT_AI_ENABLED !== "true" ||
    !key ||
    !model ||
    !/^claude-[a-z0-9-]{3,80}$/.test(model) ||
    !Number.isInteger(monthlyLimit) ||
    monthlyLimit < 1 ||
    monthlyLimit > 100
  )
    throw new ScoutError(
      "Claudeの接続・モデル・月間利用上限を設定してください",
      409,
    );
  return { key, model, monthlyLimit };
}
