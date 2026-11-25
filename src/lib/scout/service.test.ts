import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ db: vi.fn(), dbAll: vi.fn(), rpc: vi.fn() }));
vi.mock("./sources", () => ({
  loadCandidates: vi.fn(),
  loadEvidence: vi.fn(),
  loadJob: vi.fn(),
  syncStop: vi.fn(),
}));
vi.mock("@/lib/email/gmail-client", () => ({ sendGmailMessage: vi.fn() }));
vi.mock("./readiness", () => ({ scoutSenderReady: vi.fn() }));
import { db, dbAll, rpc } from "./db";
import { loadCandidates, loadEvidence, loadJob, syncStop } from "./sources";
import { sendGmailMessage } from "@/lib/email/gmail-client";
import { scoutSenderReady } from "./readiness";
import { createDraft, sendDraft, unsubscribe } from "./service";
import {
  marketingConsentPayload,
  readMarketingConsent,
} from "@/lib/marketing-consent";
import type { Candidate, ScoutMessage } from "./types";
const staff = {
  id: "10000000-0000-0000-0000-000000000001",
  email: "staff@example.com",
  display_name: "見本担当",
};
const c: Candidate = {
  id: "driver:recExample",
  name: "見本 太郎",
  email: "sample@example.com",
  phone: "09012345678",
  role: "トラック",
  region: "埼玉県",
  qualifications: "大型",
  status: "未確認",
  appliedAt: new Date().toISOString(),
  consentDate: Date.now(),
  consentMethod: "応募フォーム",
  emailStopped: false,
  stopKnown: true,
  isTest: false,
};
const job = {
  id: "examplejob",
  title: "配送スタッフ",
  company: "サンプル運送",
  region: "埼玉県",
  url: "https://ridejob.jp/job/examplejob",
  updatedAt: "2026-11-20T00:00:00Z",
};
let saved: ScoutMessage;
describe("scout send boundary", () => {
  beforeEach(() => {
    vi.mocked(scoutSenderReady).mockResolvedValue(true);
    vi.stubEnv("SCOUT_ENABLED", "true");
    vi.stubEnv("SCOUT_SEND_ENABLED", "true");
    vi.stubEnv("SCOUT_COOLDOWN_HOURS", "168");
    vi.stubEnv("SUBMISSION_VAULT_URL", "https://test.supabase.co");
    vi.stubEnv("SUBMISSION_VAULT_SERVICE_KEY", "server-key");
    vi.stubEnv("SCOUT_SUPABASE_ANON_KEY", "public-key");
    vi.stubEnv("SCOUT_PUBLIC_URL", "https://ridejob.jp/entry");
    vi.stubEnv("SCOUT_TOKEN_SECRET", "a".repeat(32));
    vi.stubEnv("SCOUT_FROM_EMAIL", "sender@example.com");
    vi.stubEnv("SCOUT_REPLY_TO", "reply@example.com");
    vi.stubEnv("SCOUT_SENDER_POSTAL_ADDRESS", "東京都（テスト住所）");
    vi.mocked(loadCandidates).mockResolvedValue([c]);
    vi.mocked(loadJob).mockResolvedValue(job);
    vi.mocked(dbAll).mockResolvedValue([]);
    vi.mocked(loadEvidence).mockResolvedValue([
      {
        source: "form_applicant/applicants",
        submissionId: "original",
        email: c.email,
        phone: c.phone,
        isTest: false,
        recordedAt: new Date().toISOString(),
        consent: readMarketingConsent(marketingConsentPayload("register"), {
          email: c.email,
          phone: c.phone,
          receivedAt: new Date().toISOString(),
        }),
      },
    ]);
    vi.mocked(db).mockImplementation(async (path, init) => {
      if (path === "scout_messages" && init?.method === "POST") {
        saved = {
          ...JSON.parse(String(init.body)),
          status: "draft",
          provider_id: null,
          created_at: new Date().toISOString(),
          sent_at: null,
          outcome: "none",
        };
        return [saved];
      }
      if (path.startsWith("scout_messages?")) return [saved];
      if (path.startsWith("scout_unsubscribe_tokens?"))
        return [{ email: c.email }];
      return [];
    });
    vi.mocked(rpc).mockImplementation(async (name) =>
      name === "scout_claim"
        ? "claimed"
        : name === "scout_unsubscribe"
          ? "email:hash"
          : null,
    );
    vi.mocked(sendGmailMessage).mockResolvedValue({
      messageId: "provider-example",
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  const draft = () =>
    createDraft(staff, {
      candidateId: c.id,
      jobId: job.id,
      subject: "お仕事のご案内",
      body: "ご登録の内容を拝見し、お仕事をご紹介したくご連絡しました。",
      conditionsConfirmed: true,
      email: "injected@example.com",
    });
  it("resolves recipients and footer on the server; ignores injected recipient", async () => {
    const d = await draft();
    expect(d.email).toBe(c.email);
    expect(d.from_email).toBe("ridejob@pmagent.jp");
    expect(d.body).toContain("配信停止");
    expect(d.body).toContain("/job/examplejob?utm_source=ridejob_scout");
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });
  it("sender authentication failure stops before reserving a contact or sending mail", async () => {
    const d = await draft();
    vi.mocked(scoutSenderReady).mockResolvedValue(false);
    vi.mocked(rpc).mockClear();
    await expect(sendDraft(staff, d.id)).rejects.toMatchObject({status:503});
    expect(rpc).not.toHaveBeenCalled();
    expect(sendGmailMessage).not.toHaveBeenCalled();
    expect(saved.status).toBe("draft");
  });
  it("rechecks optout after preview, before provider call", async () => {
    const d = await draft();
    vi.mocked(loadCandidates).mockResolvedValue([{ ...c, emailStopped: true }]);
    await expect(sendDraft(staff, d.id)).rejects.toMatchObject({ status: 409 });
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });
  it("blocks changes to candidate name, qualifications or status after final preview", async () => {
    const d = await draft();
    for (const change of [
      { name: "変更後の氏名" },
      { qualifications: "変更後の資格" },
      { status: "他担当が対応中" },
    ]) {
      vi.mocked(loadCandidates).mockResolvedValue([{ ...c, ...change }]);
      await expect(sendDraft(staff, d.id)).rejects.toMatchObject({
        status: 409,
      });
    }
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });
  it("sends an unchanged snapshot after jsonb reordered its keys", async () => {
    const d = await draft();
    saved.candidate_snapshot = Object.fromEntries(
      Object.entries(saved.candidate_snapshot).reverse(),
    ) as Candidate;
    saved.job_snapshot = Object.fromEntries(
      Object.entries(saved.job_snapshot).reverse(),
    ) as typeof job;
    expect((await sendDraft(staff, d.id)).status).toBe("accepted");
  });
  it("rejects changed job, recipient and stale preview", async () => {
    const d = await draft();
    vi.mocked(loadJob).mockResolvedValue({
      ...job,
      updatedAt: "2026-11-24T10:00:00Z",
    });
    await expect(sendDraft(staff, d.id)).rejects.toMatchObject({ status: 409 });
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });
  it("does not call provider for double clicks, cooldown or unresolved earlier send", async () => {
    const d = await draft();
    for (const status of [
      "sending",
      "accepted",
      "unknown",
      "cooldown",
      "unresolved",
    ]) {
      vi.mocked(rpc).mockResolvedValue(status);
      await sendDraft(staff, d.id).catch(() => {});
    }
    expect(sendGmailMessage).not.toHaveBeenCalled();
  });
  it("records a provider timeout as unknown without retry", async () => {
    const d = await draft();
    vi.mocked(sendGmailMessage).mockRejectedValue(new Error("timeout"));
    const r = await sendDraft(staff, d.id);
    expect(r.status).toBe("unknown");
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith(
      "scout_finish",
      expect.objectContaining({ p_status: "unknown" }),
    );
  });
  it("uses no CC/BCC and provides an actual POST one-click endpoint", async () => {
    const d = await draft();
    expect((await sendDraft(staff, d.id)).status).toBe("accepted");
    const args = vi.mocked(sendGmailMessage).mock.calls[0][0];
    expect(args.cc).toBeUndefined();
    expect(args.bcc).toBeUndefined();
    expect(args.unsubscribeUrl).toContain(
      "/entry/api/scout/unsubscribe?token=",
    );
    expect(args.replyTo).toBe("reply@example.com");
  });
  it("retains sending hold if saving provider result fails", async () => {
    const d = await draft();
    vi.mocked(rpc).mockImplementation(async (name) => {
      if (name === "scout_finish") throw new Error("DB failed");
      return "claimed";
    });
    await expect(sendDraft(staff, d.id)).rejects.toThrow();
    expect(sendGmailMessage).toHaveBeenCalledTimes(1);
  });
  it("stops locally even if Lark synchronization is unavailable", async () => {
    vi.mocked(syncStop).mockRejectedValue(new Error("Lark unavailable"));
    expect(await unsubscribe("a".repeat(43))).toEqual({ stopped: true });
    expect(rpc).toHaveBeenCalledWith("scout_unsubscribe", expect.anything());
  });
});
