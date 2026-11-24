import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./db", () => ({ rpc: vi.fn() }));
import { rpc } from "./db";
import { generatePlan, publicJobInput, buildClaudeRequest } from "./ai";
const staff = {
  id: "staff-private",
  email: "private-staff@example.com",
  display_name: "社内担当者",
};
const job = {
  id: "demo",
  title: "トラックの配送",
  company: "サンプル運送",
  region: "埼玉県",
  url: "https://ridejob.jp/job/demo",
  updatedAt: "2026-11-24",
  requirements: "大型免許",
  work: "配送",
};
const plan = {
  roles: ["トラック"],
  qualificationTerms: ["大型免許"],
  subject: "配送のお仕事のご案内",
  body: "配送のお仕事をご案内します。ご興味がありましたらご確認ください。",
  rationale: "配送募集",
  checks: ["就業条件"],
};
const response = {
  model: "claude-haiku-4-5-20251001",
  stop_reason: "tool_use",
  content: [{ type: "tool_use", name: "propose_scout", input: plan }],
  usage: { input_tokens: 500, output_tokens: 200 },
};
describe("Claude boundary", () => {
  beforeEach(() => {
    vi.stubEnv("SCOUT_AI_ENABLED", "true");
    vi.stubEnv("SCOUT_CLAUDE_API_KEY", "test-key");
    vi.stubEnv("SCOUT_CLAUDE_MODEL", "claude-haiku-4-5-20251001");
    vi.stubEnv("SCOUT_AI_MONTHLY_LIMIT", "100");
    vi.mocked(rpc).mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it("sends only whitelisted public-job fields to Anthropic, never staff/candidate/recipient details", async () => {
    const spy = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", spy);
    const result = await generatePlan(staff, {
      ...job,
      ...{
        candidate: { name: "秘密の候補者", email: "private@example.com" },
        applyEmail: "secret@example.com",
      },
    });
    const [url, request] = spy.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(request.body).not.toMatch(
      /private|秘密|secret|staff-private|社内担当者/,
    );
    expect(body.max_tokens).toBe(1800);
    expect(body.tools).toHaveLength(1);
    expect(result.plan).toEqual(plan);
    expect(rpc).toHaveBeenCalledWith("scout_ai_reserve", {
      p_staff: staff.id,
      p_limit: 100,
    });
  });
  it("uses the approved Sonnet 5.5 request profile without unsupported forced tools or sampling", () => {
    const payload = JSON.parse(buildClaudeRequest(job, "claude-sonnet-5-5"));
    expect(payload.model).toBe("claude-sonnet-5-5");
    expect(payload.thinking).toEqual({ type: "between_tools" });
    expect(payload.output_config).toEqual({ effort: "medium" });
    expect(payload.tools[0].strict).toBe(true);
    expect(payload.tool_choice.type).toBe("auto");
    expect(payload).not.toHaveProperty("temperature");
    expect(payload.max_tokens).toBe(1800);
    expect(
      JSON.parse(buildClaudeRequest(job, "claude-haiku-4-5-20251001")),
    ).not.toHaveProperty("thinking");
  });
  it("removes contact links in public text", () => {
    expect(
      JSON.stringify(
        publicJobInput({
          ...job,
          work: "連絡：test@example.com 03-1234-5678 https://example.com",
        }),
      ),
    ).not.toMatch(/test@example|03-1234|https:/);
  });
  it("does not call provider before configuration or after atomic monthly limit", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    vi.stubEnv("SCOUT_AI_ENABLED", "false");
    await expect(generatePlan(staff, job)).rejects.toMatchObject({
      status: 409,
    });
    vi.stubEnv("SCOUT_AI_ENABLED", "true");
    vi.mocked(rpc).mockResolvedValue(false);
    await expect(generatePlan(staff, job)).rejects.toMatchObject({
      status: 429,
    });
    expect(spy).not.toHaveBeenCalled();
  });
  it("does not retry timeouts and rejects truncation, refusal or unsupported tool results", async () => {
    const spy = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", spy);
    await expect(generatePlan(staff, job)).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    for (const r of [
      { ...response, stop_reason: "max_tokens" },
      { ...response, content: [{ type: "text", text: "refused" }] },
      {
        ...response,
        content: [{ type: "tool_use", name: "send_email", input: plan }],
      },
    ]) {
      spy.mockResolvedValueOnce(Response.json(r));
      await expect(generatePlan(staff, job)).rejects.toMatchObject({
        status: 422,
      });
    }
  });
});
