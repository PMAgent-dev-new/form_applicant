import { describe, expect, it } from "vitest";
import {
  readMarketingConsent,
  marketingConsentPayload,
} from "@/lib/marketing-consent";
import {
  contactKeys,
  eligibility,
  emailKey,
  validateCopy,
  verifiedConsent,
  matchesRole,
  sameSnapshot,
} from "./policy";
import { isScoutPath } from "@/lib/scout-path";
import type { Candidate, ConsentEvidence } from "./types";
const now = Date.parse("2026-11-24T03:00:00Z");
it("maps instructor storage labels separately from general mechanics", () => {
  expect(matchesRole("整備士教員", "講師")).toBe(true);
  expect(matchesRole("整備士教員", "整備士")).toBe(false);
  expect(matchesRole("整備士", "講師")).toBe(false);
  expect(matchesRole("整備士", "整備士")).toBe(true);
});
it("compares jsonb snapshots independently of object key order", () => {
  expect(
    sameSnapshot(
      { id: "x", name: "見本", nested: { a: 1, b: 2 } },
      { nested: { b: 2, a: 1 }, name: "見本", id: "x" },
    ),
  ).toBe(true);
  expect(sameSnapshot({ name: "見本" }, { name: "更新" })).toBe(false);
});
const candidate: Candidate = {
  id: "driver:recTest",
  name: "見本 太郎",
  email: "sample@example.com",
  phone: "09012345678",
  role: "トラック",
  region: "埼玉県",
  qualifications: "大型",
  status: "未確認",
  appliedAt: "2026-11-20T03:00:00Z",
  consentDate: now - 86400000,
  consentMethod: "応募フォーム",
  emailStopped: false,
  stopKnown: true,
  isTest: false,
};
const consent = readMarketingConsent(marketingConsentPayload("register"), {
  receivedAt: "2026-11-20T03:00:00Z",
  pageUrl: "https://ridejob.jp/entry",
  email: candidate.email,
  phone: candidate.phone,
});
const evidence: ConsentEvidence = {
  source: "form_applicant/applicants",
  submissionId: "original-1",
  email: candidate.email,
  phone: candidate.phone,
  recordedAt: "2026-11-20T03:00:00Z",
  consent,
  isTest: false,
};
describe("scout consent and suppression", () => {
  it("requires original text, version, action and exact email/phone", () => {
    expect(verifiedConsent(evidence, candidate, now)).toBe(true);
    for (const change of [
      { email: "different@example.com" },
      { phone: "08012345678" },
      { source: "external/import" },
      { isTest: true },
      { consent: { ...consent, notice_text: "プライバシーポリシーに同意" } },
      { consent: { ...consent, channels: ["sms"] } },
      { consent: { ...consent, status: "unverified" } },
      { consent: { ...consent, action: "apply_only" } },
      { consent: { ...consent, button_text: "別のボタン" } },
      { consent: { ...consent, received_at: "2099-01-01T00:00:00Z" } },
    ])
      expect(verifiedConsent({ ...evidence, ...change }, candidate, now)).toBe(
        false,
      );
  });
  it("never treats a Lark date alone as permission", () =>
    expect(
      eligibility(candidate, [candidate], [], new Set(), now).allowed,
    ).toBe(false));
  it("honors stops in older records and the other base", () => {
    const old = {
      ...candidate,
      id: "mechanic:recOld",
      email: " Sample@Example.com ",
      emailStopped: true,
    };
    expect(
      eligibility(candidate, [candidate, old], [evidence], new Set(), now)
        .allowed,
    ).toBe(false);
    expect(
      eligibility(
        candidate,
        [candidate],
        [evidence],
        new Set([emailKey(candidate.email)]),
        now,
      ).allowed,
    ).toBe(false);
  });
  it("fails closed on conflicting identities and unknown stop shapes", () => {
    for (const other of [
      { ...candidate, name: "別人" },
      { ...candidate, phone: "08000000000" },
      { ...candidate, stopKnown: false },
    ])
      expect(
        eligibility(candidate, [candidate, other], [evidence], new Set(), now)
          .allowed,
      ).toBe(false);
  });
  it("same-phone new email cannot inherit old consent", () => {
    expect(
      eligibility(
        { ...candidate, email: "new@example.com" },
        [candidate],
        [evidence],
        new Set(),
        now,
      ).allowed,
    ).toBe(false);
    expect(contactKeys(candidate)[1]).toEqual(
      contactKeys({ ...candidate, email: "new@example.com" })[1],
    );
  });
  it("does not infer disqualification from job intent or old application", () =>
    expect(
      eligibility(
        { ...candidate, appliedAt: "2023-01-01", status: "情報収集中" },
        [candidate],
        [evidence],
        new Set(),
        now,
      ).allowed,
    ).toBe(true));
});
describe("scout message input", () => {
  it("rejects header injection, HTML and arbitrary links", () => {
    for (const [subject, body] of [
      ["件名\r\nBcc:other@example.com", "本文".repeat(20)],
      ["件名", "本文".repeat(20) + "https://outside.example"],
      ["件名", "本文".repeat(20) + "<img src=x>"],
      ["", "本文".repeat(20)],
    ])
      expect(() => validateCopy(subject, body)).toThrow();
    expect(
      validateCopy(
        "お仕事のご案内",
        "ご登録の内容を拝見し、お仕事をご紹介したくご連絡しました。",
      ).subject,
    ).toBe("お仕事のご案内");
  });
  it("disables tracking for admin and unsubscribe under both base paths", () => {
    for (const p of [
      "/scout",
      "/scout/unsubscribe",
      "/entry/scout",
      "/entry/scout/unsubscribe",
      "/api/scout/send",
    ])
      expect(isScoutPath(p)).toBe(true);
    for (const p of ["/entry", "/mechanic", "/scouting"])
      expect(isScoutPath(p)).toBe(false);
  });
});
