import { describe, it, expect } from "vitest";
import { groupCandidates, validatePlan, type AiPlan } from "./groups";
import { emailKey } from "./policy";
import {
  marketingConsentPayload,
  readMarketingConsent,
} from "@/lib/marketing-consent";
import type { Candidate, ConsentEvidence } from "./types";
const now = Date.parse("2026-11-24T00:00:00Z");
const person = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  name: `見本 ${id}`,
  email: `${id}@example.com`,
  phone: `090000000${id.padStart(2, "0")}`,
  role: "トラック",
  region: "埼玉県",
  qualifications: "大型免許",
  status: "未確認",
  appliedAt: "2026-11-22",
  consentDate: now,
  consentMethod: "フォーム",
  emailStopped: false,
  stopKnown: true,
  isTest: false,
  ...overrides,
});
function data(candidates: Candidate[]) {
  return {
    candidates,
    suppressed: new Set<string>(),
    evidence: candidates.map((c) => ({
      source: "form_applicant/applicants",
      submissionId: c.id,
      email: c.email,
      phone: c.phone,
      recordedAt: "2026-11-22T00:00:00Z",
      isTest: false,
      consent: readMarketingConsent(marketingConsentPayload("register"), {
        email: c.email,
        phone: c.phone,
        receivedAt: "2026-11-22T00:00:00Z",
      }),
    })) satisfies ConsentEvidence[],
  };
}
const job = {
  id: "demo",
  title: "配送",
  company: "サンプル",
  region: "埼玉県上尾市",
  requirements: "大型免許が必要です",
  url: "https://ridejob.jp/job/demo",
  updatedAt: "2026-11-23",
};
const plan: AiPlan = {
  roles: ["トラック"],
  qualificationTerms: ["大型免許"],
  subject: "配送のお仕事のご案内",
  body: "公開中の配送のお仕事をご案内します。ご興味がありましたらご確認ください。",
  rationale: "トラックの募集",
  checks: ["勤務条件"],
};
describe("AI proposal and local matching", () => {
  it("does not widen to unknown role/location and keeps qualification gaps visible", () => {
    const d = data([
      person("1"),
      person("2", { qualifications: "未登録" }),
      person("3", { region: "東京都" }),
      person("4", { role: "未確認" }),
    ]);
    const r = groupCandidates(plan, job, d, [], now);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0].candidates[0].email).toContain("***");
    expect(
      r.groups.find((g) => g.qualificationCheck)?.candidates.map((c) => c.id),
    ).toEqual(["2"]);
    expect(
      r.groups
        .flatMap((g) => g.candidates)
        .map((c) => c.id)
        .sort(),
    ).toEqual(["1", "2"]);
  });
  it("excludes consent missing, cross-record optout, suppressed, recent and unresolved sends", () => {
    const candidates = [
      person("1"),
      person("2"),
      person("3"),
      person("4"),
      person("5"),
    ];
    const d = data(candidates);
    d.evidence = d.evidence.filter((e) => e.submissionId !== "1");
    d.candidates.push({ ...candidates[1], id: "old2", emailStopped: true });
    d.suppressed.add(emailKey(candidates[2].email));
    const locks = [
      {
        contact_key: emailKey(candidates[3].email),
        last_sent_at: "2026-11-23T00:00:00Z",
        message: { status: "accepted" },
      },
      {
        contact_key: emailKey(candidates[4].email),
        last_sent_at: "2026-10-01T00:00:00Z",
        message: { status: "unknown" },
      },
    ];
    const result = groupCandidates(plan, job, d, locks, now);
    expect(result.groups).toEqual([]);
    expect(result.excluded.recentOrUnknown).toBe(2);
  });
  it("uses one record per contact across groups and keeps instructor distinct from mechanic", () => {
    const a = person("1", { role: "整備士教員" }),
      b = { ...a, id: "2", role: "整備士", appliedAt: "2026-11-20" };
    const result = groupCandidates(
      { ...plan, roles: ["講師", "整備士"] },
      job,
      data([a, b]),
      [],
      now,
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].label).toContain("講師");
    expect(result.excluded.duplicates).toBe(1);
  });
  it("rejects hallucinated qualifications, arbitrary role and external URLs", () => {
    expect(() =>
      validatePlan({ ...plan, qualificationTerms: ["普通二種"] }, job),
    ).toThrow();
    expect(() => validatePlan({ ...plan, roles: ["女性"] }, job)).toThrow();
    expect(() =>
      validatePlan({ ...plan, body: plan.body + " https://evil.example" }, job),
    ).toThrow();
    expect(() =>
      validatePlan(
        { ...plan, qualificationTerms: ["女性"] },
        { ...job, requirements: "女性" },
      ),
    ).toThrow();
    expect(validatePlan(plan, job)).toEqual(plan);
  });
});

it("includes the existing bus and chauffeur master values without mixing them into taxi", () => {
  const d = data([
    person("1", { role: "バスドライバー" }),
    person("2", { role: "ハイヤー/役員専属運転手" }),
  ]);
  const result = groupCandidates(
    { ...plan, roles: ["バス", "ハイヤー"] },
    job,
    d,
    [],
    now,
  );
  expect(result.groups.map((g) => g.label)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("バス /"),
      expect.stringContaining("ハイヤー /"),
    ]),
  );
  expect(
    result.groups
      .flatMap((g) => g.candidates)
      .map((c) => c.id)
      .sort(),
  ).toEqual(["1", "2"]);
  expect(
    validatePlan({ ...plan, roles: ["バス", "ハイヤー"] }, job).roles,
  ).toEqual(["バス", "ハイヤー"]);
});
