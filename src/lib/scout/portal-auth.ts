import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ScoutError } from "./config";
import { rpc } from "./db";
import type { Staff } from "./types";

const denied = (reason: string) => {
  // Fixed reason codes only: never log claims, signatures, identities or tokens.
  console.warn("scout_portal_auth_denied", reason);
  return new ScoutError("社内アプリからログインし直してください", 401);
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SCOUT_POLICY_VERSION = "2026-11-25-scout-v1";
export type PortalClaim = { v: 1; id: string; email: string; session: string; at: number; nonce: string; method: string; target: string; body: string };

// The signature binds the exact request. A valid signature is still not a login:
// consumePortalClaim checks the live portal session/role/consent in the database.
export async function verifyPortalRequest(req: Request): Promise<PortalClaim> {
  const key = process.env.SCOUT_PORTAL_KEY;
  if (!key || key.length < 43) throw new ScoutError("社内アプリの接続設定が必要です");
  const encoded = req.headers.get("x-pma-scout-claim") || "";
  const signature = req.headers.get("x-pma-scout-signature") || "";
  if (encoded.length > 3000 || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[a-f0-9]{64}$/.test(signature)) throw denied("header_format");
  const expected = createHmac("sha256", key).update(encoded).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw denied("signature");
  let c: PortalClaim;
  try { c = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw denied("claim_json"); }
  const u = new URL(req.url);
  if (!c || c.v !== 1 || !uuid.test(c.id) || typeof c.email !== "string" || c.email.length > 254 || !/^[a-f0-9]{64}$/.test(c.session) || !uuid.test(c.nonce) || !Number.isSafeInteger(c.at) || !/^[a-f0-9]{64}$/.test(c.body)) throw denied("claim_format");
  if (c.at > Date.now() + 5000 || c.at < Date.now() - 60000) throw denied("expired");
  if (c.method !== req.method) throw denied("method");
  if (c.target !== u.pathname + u.search) throw denied("target");
  if (Number(req.headers.get("content-length") || 0) > 400000) throw denied("body_size");
  const body = await req.clone().text();
  if (Buffer.byteLength(body) > 400000 || createHash("sha256").update(body).digest("hex") !== c.body) throw denied("body");
  return c;
}

export async function consumePortalClaim(c: PortalClaim): Promise<Staff> {
  const result = await rpc<Staff | null>("scout_portal_auth", {
    p_staff: c.id, p_email: c.email, p_session: c.session,
    p_nonce: c.nonce, p_issued: new Date(c.at).toISOString(),
    p_policy: SCOUT_POLICY_VERSION,
  });
  if (!result?.id || result.id !== c.id) throw denied("live_identity");
  return result;
}
