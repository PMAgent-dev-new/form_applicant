import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./sources", () => ({
  loadJob: vi.fn(async (id: string) => ({
    id,
    title: "配送スタッフ",
    company: "公開企業",
    region: "埼玉県",
    work: "配送業務",
    requirements: "大型免許",
    url: `https://ridejob.jp/job/${id}`,
    updatedAt: "2026-11-24",
  })),
}));
import { runPreflight } from "../../../scripts/scout-preflight";
let attempts: number;
let paidCalls: number;
let failGeneration: boolean;
let delayQuota: boolean;
let truncateResponse: boolean;
const args = () => [
  "--approved-three-public-jobs",
  "2026-11-01",
  "0",
  "2026-11-24T05:30:00Z",
];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T05:00:00Z"));
  for (const [name, value] of Object.entries({
    SCOUT_ENABLED: "false",
    SCOUT_SEND_ENABLED: "false",
    SCOUT_AI_ENABLED: "false",
    SCOUT_CLAUDE_MODEL: "claude-sonnet-5-5",
    SCOUT_AI_MONTHLY_LIMIT: "100",
    SCOUT_CLAUDE_API_KEY: "test-key",
    SUBMISSION_VAULT_SERVICE_KEY: "test-service",
    SUBMISSION_VAULT_URL: "https://tdlnowmdanapxmgebaqu.supabase.co",
    MICROCMS_SERVICE_DOMAIN: "public-test",
    MICROCMS_API_KEY: "test-cms",
  }))
    vi.stubEnv(name, value);
  attempts = 0;
  paidCalls = 0;
  failGeneration = false;
  delayQuota = false;
  truncateResponse = false;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, request?: RequestInit) => {
      if (url.startsWith("https://api.anthropic.com/v1/models/"))
        return Response.json({ id: "claude-sonnet-5-5" });
      if (url.includes("microcms.io/api/v1/jobs?"))
        return Response.json({
          contents: ["job1", "job2", "job3"].map((id) => ({
            id,
            publishedAt: "2026-11-24",
          })),
        });
      if (url.includes("/rest/v1/scout_ai_usage?")) {
        expect(request?.method).toBe("PATCH");
        const expected = Number(
          new URL(url).searchParams.get("attempts")?.slice(3),
        );
        if (expected !== attempts) return Response.json([]);
        attempts++;
        if (delayQuota) vi.setSystemTime(new Date(Date.now() + 2000));
        return Response.json([{ month: "2026-11-01", attempts }]);
      }
      if (url === "https://api.anthropic.com/v1/messages") {
        paidCalls++;
        if (failGeneration) throw new Error("network failure");
        return Response.json({
          model: "claude-sonnet-5-5",
          stop_reason: truncateResponse ? "max_tokens" : "tool_use",
          content: [
            {
              type: "tool_use",
              name: "propose_scout",
              input: {
                roles: ["トラック"],
                qualificationTerms: ["大型免許"],
                subject: "配送スタッフのご案内",
                body: "公開中の配送のお仕事をご案内します。ご興味があれば詳細をご確認ください。",
                rationale: "配送業務の募集",
                checks: ["就業条件を確認"],
              },
            },
          ],
          usage: { input_tokens: 1000, output_tokens: 400 },
        });
      }
      throw new Error("unexpected network destination");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("counts exactly three calls and refuses replay of the same approved build", async () => {
  await runPreflight(args());
  expect(paidCalls).toBe(3);
  expect(attempts).toBe(3);
  await expect(runPreflight(args())).rejects.toThrow(
    "quota_already_used_or_changed",
  );
  expect(paidCalls).toBe(3);
});
it("refuses enabled delivery, expired approval, wrong month, and excessive starting quota before network", async () => {
  vi.stubEnv("SCOUT_SEND_ENABLED", "true");
  await expect(runPreflight(args())).rejects.toThrow("preflight_gate");
  vi.stubEnv("SCOUT_SEND_ENABLED", "false");
  for (const invalid of [
    ["--approved-three-public-jobs", "2026-11-01", "98", args()[3]],
    ["--approved-three-public-jobs", "2026-10-01", "0", args()[3]],
    ["--approved-three-public-jobs", "2026-11-01", "0", "2026-11-24T04:00:00Z"],
  ])
    await expect(runPreflight(invalid)).rejects.toThrow("preflight_gate");
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps the charged attempt and never retries an unknown provider result", async () => {
  failGeneration = true;
  await expect(runPreflight(args())).rejects.toThrow("network failure");
  expect(paidCalls).toBe(1);
  expect(attempts).toBe(1);
});

it("checks the deadline again immediately before a paid request", async () => {
  vi.setSystemTime(new Date("2026-11-24T05:29:59Z"));
  delayQuota = true;
  await expect(runPreflight(args())).rejects.toThrow("preflight_expired");
  expect(paidCalls).toBe(0);
  expect(attempts).toBe(1);
});
it("does not book a new-month request against the old month", async () => {
  vi.setSystemTime(new Date("2026-11-30T14:59:59Z"));
  delayQuota = true;
  await expect(
    runPreflight([args()[0], args()[1], "0", "2026-11-30T15:30:00Z"]),
  ).rejects.toThrow("preflight_month_changed");
  expect(paidCalls).toBe(0);
});
it("records safe token usage and stop reason before rejecting a paid truncated response", async () => {
  truncateResponse = true;
  await expect(runPreflight(args())).rejects.toThrow(
    "claude_response_rejected",
  );
  const logs = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
  expect(
    logs.some(
      (line) =>
        line.includes('"stopReason":"max_tokens"') &&
        line.includes('"input":1000') &&
        line.includes('"attempts":1'),
    ),
  ).toBe(true);
  expect(paidCalls).toBe(1);
  expect(attempts).toBe(1);
});
