import { createHash } from "node:crypto";
import {
  LEGACY_MARKETING_NOTICE,
  LEGACY_MARKETING_NOTICE_VERSION,
  MARKETING_ACTIONS,
  MARKETING_NOTICE_VERSION,
  type MarketingAction,
} from "@/lib/marketing-consent";
import type { Candidate, ConsentEvidence, Eligibility } from "./types";

export const normalizeEmail = (v: string) => v.trim().toLowerCase();
export const normalizePhone = (v: string) =>
  v.replace(/^\+81/, "0").replace(/[^0-9]/g, "");
export const normalizeName = (v: string) =>
  v.normalize("NFKC").replace(/[\s　]/g, "");
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const emailKey = (email: string) =>
  `email:${digest(normalizeEmail(email))}`;
export const contactKeys = (c: Candidate) =>
  [
    emailKey(c.email),
    ...(c.phone ? [`phone:${digest(normalizePhone(c.phone))}`] : []),
  ].sort();
export const validEmail = (email: string) =>
  email.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
    email,
  );
export const maskEmail = (v: string) =>
  validEmail(v) ? v.replace(/^(.).*?@/, "$1***@") : "未登録";

export function matchesRole(saved: string, filter: string): boolean {
  const instructor = /整備士教員|講師|教員/.test(saved);
  if (filter === "講師") return instructor;
  if (filter === "整備士") return saved.includes("整備士") && !instructor;
  return !filter || saved.includes(filter);
}

// PostgreSQL jsonbの読み戻しではキー順が変わる。順序だけを更新と扱わない。
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const sameSnapshot = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const allowedSources = new Set([
  "form_applicant/applicants",
  "jobmadley/applications",
  "jobmadley/submit-application",
]);
export function verifiedConsent(
  e: ConsentEvidence,
  c: Candidate,
  now = Date.now(),
): boolean {
  const v = e.consent as Record<string, unknown> | null;
  if (
    !v ||
    e.isTest ||
    !allowedSources.has(e.source) ||
    !e.submissionId ||
    normalizeEmail(e.email) !== normalizeEmail(c.email)
  )
    return false;
  if (
    !e.phone ||
    !c.phone ||
    normalizePhone(e.phone) !== normalizePhone(c.phone)
  )
    return false;
  if (
    v.accepted !== true ||
    v.status !== "accepted" ||
    v.scope !== "job_updates" ||
    !Array.isArray(v.channels) ||
    !v.channels.includes("email")
  )
    return false;
  if (
    typeof v.received_at !== "string" ||
    !Number.isFinite(Date.parse(v.received_at)) ||
    Date.parse(v.received_at) > now + 60_000
  )
    return false;
  if (v.notice_version === LEGACY_MARKETING_NOTICE_VERSION)
    return v.method === "checkbox" && v.notice_text === LEGACY_MARKETING_NOTICE;
  if (
    v.notice_version !== MARKETING_NOTICE_VERSION ||
    v.method !== "button" ||
    typeof v.action !== "string" ||
    !Object.hasOwn(MARKETING_ACTIONS, v.action)
  )
    return false;
  const action = MARKETING_ACTIONS[v.action as MarketingAction];
  return (
    action.accepted &&
    v.notice_text === action.notice &&
    v.button_text === action.label
  );
}

/** 判定はメールの実際の宛先に対して行う。同じ電話だけで別メールへ同意を移さない。 */
export function eligibility(
  candidate: Candidate,
  all: Candidate[],
  evidence: ConsentEvidence[],
  suppressed: Set<string>,
  now = Date.now(),
): Eligibility {
  const reasons: string[] = [];
  const email = normalizeEmail(candidate.email);
  const related = all.filter((c) => email && normalizeEmail(c.email) === email);
  if (!validEmail(email)) reasons.push("有効なメールアドレスがありません");
  if (candidate.isTest) reasons.push("テストレコードです");
  if (related.some((c) => !c.stopKnown))
    reasons.push("配信停止の状態を確認できません");
  if (related.some((c) => c.emailStopped) || suppressed.has(emailKey(email)))
    reasons.push("メール配信停止中です");
  if (
    related.some(
      (c) =>
        normalizeName(c.name) !== normalizeName(candidate.name) ||
        (c.phone &&
          candidate.phone &&
          normalizePhone(c.phone) !== normalizePhone(candidate.phone)),
    )
  )
    reasons.push(
      "同じメールに異なる登録情報があります。担当者による照合が必要です",
    );
  if (!candidate.consentDate || !candidate.consentMethod)
    reasons.push("Larkの配信同意記録が未確認です");
  const match = evidence
    .filter((e) => verifiedConsent(e, candidate, now))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  if (!match) reasons.push("この連絡先に対応する配信同意の原本が未確認です");
  return {
    allowed: reasons.length === 0,
    reasons,
    ...(match ? { evidence: match } : {}),
  };
}

export function validateCopy(subject: unknown, body: unknown) {
  if (
    typeof subject !== "string" ||
    !subject.trim() ||
    subject.length > 120 ||
    /[\x00-\x1f\x7f]/.test(subject)
  )
    throw new Error("件名は改行なしの120文字以内で入力してください");
  if (
    typeof body !== "string" ||
    body.trim().length < 20 ||
    body.length > 4000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)
  )
    throw new Error("本文は20〜4,000文字で入力してください");
  // 任意URLや受信者操作を足さず、求人URL・停止リンクはサーバーで付ける。
  if (/(?:https?:\/\/|www\.|mailto:|<[^>]+>)/i.test(body))
    throw new Error("URL・HTMLは本文に貼らず、求人を選択してください");
  if (body.includes("ご経験とのつながりをご記入ください"))
    throw new Error("本文の記入案内を、おすすめする理由に書き換えてください");
  return { subject: subject.trim(), body: body.trim() };
}
