import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("./db", () => ({ db: vi.fn(), rpc: vi.fn() }));
import { db, rpc } from "./db";
import { checkOrigin, login, requireStaff, SESSION_COOKIE } from "./auth";
const staff = {
  id: "10000000-0000-0000-0000-000000000001",
  email: "staff@example.com",
  display_name: "担当者",
};
const request = (cookie = "token") =>
  new NextRequest("https://ridejob.jp/entry/api/scout/session", {
    headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
  });
describe("scout auth", () => {
  beforeEach(() => {
    vi.stubEnv("SCOUT_ENABLED", "true");
    vi.stubEnv("SUBMISSION_VAULT_URL", "https://test.supabase.co");
    vi.stubEnv("SUBMISSION_VAULT_SERVICE_KEY", "server-key");
    vi.stubEnv("SCOUT_SUPABASE_ANON_KEY", "public-key");
    vi.stubEnv("SCOUT_PUBLIC_URL", "https://ridejob.jp/entry");
    vi.stubEnv("SCOUT_TOKEN_SECRET", "a".repeat(32));
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(db).mockResolvedValue([staff]);
    vi.mocked(rpc).mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it("Google mode rejects legacy passwords and cookies before contacting Auth", async () => {
    vi.stubEnv("SCOUT_AUTH_MODE", "pma_google");
    vi.stubEnv("SCOUT_PORTAL_KEY", "test-only-key-".repeat(5));
    await expect(login(request())).rejects.toMatchObject({status:403});
    await expect(requireStaff(request())).rejects.toMatchObject({status:401});
    expect(fetch).not.toHaveBeenCalled(); expect(db).not.toHaveBeenCalled();
  });
  it("rejects missing sessions and forged cookie user IDs", async () => {
    await expect(
      requireStaff(
        new NextRequest("https://ridejob.jp/entry/api/scout/session"),
      ),
    ).rejects.toMatchObject({ status: 401 });
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(requireStaff(request(staff.id))).rejects.toMatchObject({
      status: 401,
    });
    expect(db).not.toHaveBeenCalled();
  });
  it("checks confirmed identity and active allowlist on every request", async () => {
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ ...staff, email_confirmed_at: "2026-01-01" }),
        ),
    );
    expect(await requireStaff(request())).toEqual(staff);
    vi.mocked(db).mockResolvedValue([]);
    await expect(requireStaff(request())).rejects.toMatchObject({
      status: 403,
    });
  });
  it("rejects a changed email on an existing user ID", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...staff,
          email: "someone@example.com",
          email_confirmed_at: "2026-01-01",
        }),
      ),
    );
    await expect(requireStaff(request())).rejects.toMatchObject({
      status: 403,
    });
  });
  it("requires the configured Origin, not a client-controlled Host header", () => {
    expect(() =>
      checkOrigin(
        new NextRequest("https://ridejob.jp/entry/api/scout/send", {
          headers: {
            Origin: "https://attacker.example",
            Host: "attacker.example",
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      checkOrigin(
        new NextRequest("https://ridejob.jp/entry/api/scout/send", {
          headers: { Origin: "https://ridejob.jp" },
        }),
      ),
    ).not.toThrow();
  });
  it("stops password attempts before calling the provider when rate limited", async () => {
    vi.mocked(rpc).mockResolvedValue(false);
    await expect(
      login(
        new NextRequest("https://ridejob.jp/entry/api/scout/session", {
          method: "POST",
          headers: {
            Origin: "https://ridejob.jp",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: staff.email,
            password: "example-only",
          }),
        }),
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
