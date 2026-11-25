import { beforeEach, expect, test, vi } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
vi.mock("./db", () => ({ rpc: vi.fn() }));
import { rpc } from "./db";
import { verifyPortalRequest, consumePortalClaim } from "./portal-auth";
const key = "test-only-key-".repeat(5);
const target = "/entry/api/scout/batches?id=test";
const actor = { id: "11111111-1111-4111-8111-111111111111", email: "staff@example.test", display_name: "確認担当" };
function request(overrides: Record<string, unknown> = {}, actual: { body?: string; target?: string; method?: string } = {}) {
  const body = '{"action":"step"}';
  const claim = { v: 1, ...actor, session: "a".repeat(64), at: Date.now(), nonce: randomUUID(), method: "POST", target, body: createHash("sha256").update(body).digest("hex"), ...overrides };
  const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return new Request("https://ridejob.jp" + (actual.target || target), { method: actual.method || "POST", body: actual.body ?? body, headers: { "x-pma-scout-claim": encoded, "x-pma-scout-signature": createHmac("sha256", key).update(encoded).digest("hex") } });
}
beforeEach(() => { process.env.SCOUT_PORTAL_KEY = key; delete process.env.NEXT_PUBLIC_BASE_PATH; vi.clearAllMocks(); });
test("valid signature binds the unchanged request and leaves its body readable", async () => {
  const r = request(); const c = await verifyPortalRequest(r);
  expect(c.id).toBe(actor.id); expect(await r.text()).toBe('{"action":"step"}');
});
test("Next base-path normalization preserves the exact signed public target", async () => {
  process.env.NEXT_PUBLIC_BASE_PATH = "/entry";
  const normalized = new NextRequest(request({}, {target:target.replace("/entry", "")}));
  expect((await verifyPortalRequest(normalized)).target).toBe(target);
  expect((await verifyPortalRequest(request())).target).toBe(target);
});
test("base-path handling still rejects other endpoints, queries and unsigned prefixes", async () => {
  process.env.NEXT_PUBLIC_BASE_PATH = "/entry";
  for (const changed of ["/api/scout/send?id=test", "/api/scout/batches?id=other", "/other/api/scout/batches?id=test"]) {
    await expect(verifyPortalRequest(new NextRequest(request({}, {target:changed})))).rejects.toMatchObject({status:401});
  }
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  await expect(verifyPortalRequest(new NextRequest(request({}, {target:target.replace("/entry", "")})))).rejects.toMatchObject({status:401});
});
test("changed body, method, query and expired claims fail before any database work", async () => {
  for (const r of [request({}, {body:'{"action":"approve"}'}), request({}, {method:"PUT"}), request({}, {target:target+"2"}), request({at:Date.now()-61000}), request({at:Date.now()+61000}), request({session:""}), request({v:2})]) await expect(verifyPortalRequest(r)).rejects.toMatchObject({status:401});
  expect(rpc).not.toHaveBeenCalled();
});
test("forged signature and missing server key fail closed", async () => {
  const r = request(); r.headers.set("x-pma-scout-signature","0".repeat(64));
  await expect(verifyPortalRequest(r)).rejects.toMatchObject({status:401});
  delete process.env.SCOUT_PORTAL_KEY;
  await expect(verifyPortalRequest(request())).rejects.toMatchObject({status:503});
});
test("diagnostics contain fixed reason codes without request or identity data", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(verifyPortalRequest(request({}, {target:target+"2"}))).rejects.toMatchObject({status:401});
    expect(log.mock.calls).toEqual([["scout_portal_auth_denied", "target"]]);
  } finally { log.mockRestore(); }
});
test("verified claim still requires a live session, permission, consent and one-use nonce", async () => {
  const c = await verifyPortalRequest(request());
  vi.mocked(rpc).mockResolvedValueOnce(actor).mockResolvedValueOnce(null);
  expect(await consumePortalClaim(c)).toEqual(actor);
  await expect(consumePortalClaim(c)).rejects.toMatchObject({status:401});
  expect(rpc).toHaveBeenCalledWith("scout_portal_auth",expect.objectContaining({p_staff:actor.id,p_session:c.session,p_nonce:c.nonce,p_policy:"2026-11-25-scout-v1"}));
});

test("UTF-8 Japanese batch within the existing character limit passes signed verification", async () => {
  const body = JSON.stringify({copies:Array.from({length:9},()=>({body:"あ".repeat(4000)}))});
  expect(body.length).toBeLessThan(100000); expect(Buffer.byteLength(body)).toBeGreaterThan(100000);
  const req = request({body:createHash("sha256").update(body).digest("hex")},{body});
  expect((await verifyPortalRequest(req)).id).toBe(actor.id);
});
