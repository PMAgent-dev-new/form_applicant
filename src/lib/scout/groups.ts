import { ScoutError } from "./config";
import {
  contactKeys,
  eligibility,
  maskEmail,
  matchesRole,
  validateCopy,
} from "./policy";
import type { Candidate, ConsentEvidence, ScoutJob } from "./types";

export const SCOUT_ROLES = [
  "タクシー",
  "トラック",
  "バス",
  "ハイヤー",
  "整備士",
  "講師",
  "製造・組立",
] as const;
export type ScoutRole = (typeof SCOUT_ROLES)[number];
export type AiPlan = {
  roles: ScoutRole[];
  qualificationTerms: string[];
  subject: string;
  body: string;
  rationale: string;
  checks: string[];
};
export type GroupCandidate = Pick<
  Candidate,
  "id" | "name" | "email" | "role" | "region" | "qualifications" | "status"
> & { reason: string };
export type CandidateGroup = {
  id: string;
  label: string;
  qualificationCheck: boolean;
  candidates: GroupCandidate[];
};
export type ContactState = {
  contact_key: string;
  last_sent_at: string | null;
  message: { status: string } | null;
};
export type Proposal = {
  id: string;
  staff_id: string;
  job_snapshot: ScoutJob;
  plan: AiPlan;
  model: string;
  created_at: string;
  expires_at: string;
};
const prefectures =
  "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(
    " ",
  );
export const jobPrefectures = (job: ScoutJob) =>
  prefectures.filter((p) => job.region.includes(p));
export const plainJobText = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot);/g, " ")
    .replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "［連絡先省略］")
    .replace(/\b0\d{1,4}[-ー ]?\d{1,4}[-ー ]?\d{3,4}\b/g, "［電話省略］")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

export function validatePlan(value: unknown, job: ScoutJob): AiPlan {
  if (!value || typeof value !== "object")
    throw new ScoutError("AIの提案形式を確認できません", 422);
  const p = value as Record<string, unknown>;
  const stringList = (v: unknown, max: number, length: number): v is string[] =>
    Array.isArray(v) &&
    v.length <= max &&
    v.every((x) => typeof x === "string" && x.trim() && x.length <= length);
  if (
    !stringList(p.roles, SCOUT_ROLES.length, 20) ||
    !p.roles.length ||
    !p.roles.every((r) => SCOUT_ROLES.includes(r as ScoutRole)) ||
    !stringList(p.qualificationTerms, 8, 50) ||
    !stringList(p.checks, 8, 160) ||
    typeof p.rationale !== "string" ||
    !p.rationale.trim() ||
    p.rationale.length > 600
  )
    throw new ScoutError(
      "AIの選定条件を確認できません。再作成してください",
      422,
    );
  const source = plainJobText(job.requirements || "").normalize("NFKC");
  if (
    p.qualificationTerms.some(
      (t) =>
        /歳|年齢|女性|男性|性別|国籍|日本人|外国人|健康|障害|家族|既婚|未婚|年収|給与|身長|体重/.test(
          t,
        ) || !source.includes(t.normalize("NFKC")),
    )
  )
    throw new ScoutError(
      "AIの資格条件が求人原文に見つかりません。再作成してください",
      422,
    );
  let copy;
  try {
    copy = validateCopy(p.subject, p.body);
  } catch {
    throw new ScoutError("AIの文面を確認できません。再作成してください", 422);
  }
  return {
    roles: [...new Set(p.roles)] as ScoutRole[],
    qualificationTerms: [...new Set(p.qualificationTerms)],
    ...copy,
    rationale: p.rationale,
    checks: p.checks,
  };
}

/** AIには候補者を渡さない。公開求人からAIが作った職種条件と、勤務地の都道府県を自社内で照合。 */
export function groupCandidates(
  plan: AiPlan,
  job: ScoutJob,
  data: {
    candidates: Candidate[];
    evidence: ConsentEvidence[];
    suppressed: Set<string>;
  },
  locks: ContactState[],
  now = Date.now(),
) {
  const regions = jobPrefectures(job);
  if (!regions.length)
    throw new ScoutError("求人の勤務地を都道府県まで確認できません", 409);
  const blockedKeys = new Set(
    locks
      .filter(
        (l) =>
          ["sending", "unknown"].includes(l.message?.status || "") ||
          (l.last_sent_at && Date.parse(l.last_sent_at) > now - 168 * 3600000),
      )
      .map((l) => l.contact_key),
  );
  const groups = new Map<string, CandidateGroup>(),
    seen = new Set<string>();
  const excluded = { consentOrStop: 0, recentOrUnknown: 0, duplicates: 0 };
  // 同じ連絡先は登録日が新しい記録を先に照合。登録日を転職意向の評価には使わない。
  const candidates = [...data.candidates].sort(
    (a, b) =>
      (b.appliedAt || "").localeCompare(a.appliedAt || "") ||
      a.id.localeCompare(b.id),
  );
  for (const c of candidates) {
    const role = plan.roles.find((r) =>
      r === "製造・組立" ? /製造|組立/.test(c.role) : matchesRole(c.role, r),
    );
    const region = regions.find((r) => c.region.startsWith(r));
    if (!role || !region) continue;
    if (
      !eligibility(c, data.candidates, data.evidence, data.suppressed, now)
        .allowed
    ) {
      excluded.consentOrStop++;
      continue;
    }
    const keys = contactKeys(c);
    if (keys.some((k) => blockedKeys.has(k))) {
      excluded.recentOrUnknown++;
      continue;
    }
    if (keys.some((k) => seen.has(k))) {
      excluded.duplicates++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    const hits = plan.qualificationTerms.filter((t) =>
      c.qualifications.normalize("NFKC").includes(t.normalize("NFKC")),
    );
    const qualificationCheck =
      !plan.qualificationTerms.length ||
      hits.length !== plan.qualificationTerms.length;
    const id = `${role}|${region}|${qualificationCheck ? "check" : "record"}`;
    if (!groups.has(id))
      groups.set(id, {
        id,
        label: `${role} / ${region} / ${qualificationCheck ? "資格・条件の確認が必要" : "資格の記載一致あり"}`,
        qualificationCheck,
        candidates: [],
      });
    groups.get(id)!.candidates.push({
      id: c.id,
      name: c.name,
      email: maskEmail(c.email),
      role: c.role,
      region: c.region,
      qualifications: c.qualifications,
      status: c.status,
      reason: `登録職種と勤務地の都道府県が一致${hits.length ? `。資格欄の記載：${hits.join("・")}` : "。資格条件は要確認"}`,
    });
  }
  return { groups: [...groups.values()], excluded };
}
