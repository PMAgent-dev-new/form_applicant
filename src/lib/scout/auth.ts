import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, rpc } from "./db";
import { scoutConfig, ScoutError } from "./config";
import { normalizeEmail } from "./policy";
import type { Staff } from "./types";

export const SESSION_COOKIE = "rj_scout_session";
export const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};
export const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: privateHeaders });
export function checkOrigin(req: NextRequest) {
  const origin = new URL(scoutConfig().publicUrl).origin;
  if (req.headers.get("origin") !== origin)
    throw new ScoutError("この画面からもう一度操作してください", 403);
}
export async function readInput(req: NextRequest, maxLength = 16000) {
  checkOrigin(req);
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new ScoutError("入力形式が正しくありません", 400);
  const text = await req.text();
  if (text.length > maxLength) throw new ScoutError("入力が長すぎます", 400);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new ScoutError("入力を確認してください", 400);
  }
}
export async function requireStaff(req: NextRequest): Promise<Staff> {
  const c = scoutConfig();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 8000)
    throw new ScoutError("ログインしてください", 401);
  // Cookie内のIDやJWTの自己申告を信用せず、Authサーバーで検証する。
  const r = await fetch(`${c.databaseUrl}/auth/v1/user`, {
    headers: { apikey: c.authKey, Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new ScoutError("ログインし直してください", 401);
  const user = await r.json();
  if (!user.id || !user.email || !user.email_confirmed_at)
    throw new ScoutError("確認済みの担当者アカウントが必要です", 403);
  const q = new URLSearchParams({
    select: "id,email,display_name",
    id: `eq.${user.id}`,
    active: "eq.true",
    limit: "1",
  });
  const rows = await db<Staff[]>(`scout_staff?${q}`);
  if (
    rows.length !== 1 ||
    normalizeEmail(rows[0].email) !== normalizeEmail(user.email)
  )
    throw new ScoutError("スカウトの利用権限がありません", 403);
  return rows[0];
}
export async function login(req: NextRequest) {
  const input = await readInput(req);
  const c = scoutConfig();
  if (
    typeof input.email !== "string" ||
    typeof input.password !== "string" ||
    input.password.length > 300 ||
    input.email.length > 254
  )
    throw new ScoutError("ログイン情報を確認してください", 400);
  const email = normalizeEmail(input.email);
  const hash = (s: string) =>
    createHmac("sha256", c.secret).update(s).digest("hex");
  // IPは補助。担当者メール別の共有DB制限を必ず併用する。
  const ip = req.headers.get("x-vercel-forwarded-for") || "unknown";
  if (
    !(await rpc<boolean>("scout_auth_attempt", {
      p_keys: [hash(`email:${email}`), hash(`ip:${ip}`)],
    }))
  )
    throw new ScoutError("しばらく待ってからログインしてください", 429);
  const rows = await db<Staff[]>(
    `scout_staff?${new URLSearchParams({ select: "id,email,display_name", email: `eq.${email}`, active: "eq.true", limit: "1" })}`,
  );
  if (rows.length !== 1)
    throw new ScoutError("ログイン情報を確認してください", 401);
  const r = await fetch(`${c.databaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: c.authKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: input.password }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new ScoutError("ログイン情報を確認してください", 401);
  const result = await r.json();
  if (
    result.user?.id !== rows[0].id ||
    !result.user?.email_confirmed_at ||
    !result.access_token
  )
    throw new ScoutError("ログイン情報を確認してください", 401);
  const response = json({ staff: rows[0] });
  response.cookies.set(SESSION_COOKIE, result.access_token, {
    httpOnly: true,
    secure: new URL(c.publicUrl).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: Math.min(3600, result.expires_in || 3600),
  });
  return response;
}
export async function protectedHandler(
  req: NextRequest,
  fn: (staff: Staff) => Promise<NextResponse>,
) {
  try {
    return await fn(await requireStaff(req));
  } catch (e) {
    return safeError(e);
  }
}
export function safeError(e: unknown) {
  // DB/プロバイダの応答・個人情報・認証値はログやブラウザーに出さない。
  return e instanceof ScoutError
    ? json({ error: e.code }, e.status)
    : json(
        {
          error:
            "処理を完了できませんでした。履歴を確認してから再度操作してください",
        },
        503,
      );
}
