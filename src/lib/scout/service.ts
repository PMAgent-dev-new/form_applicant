import { createHmac, randomUUID } from "node:crypto";
import { db, dbAll, rpc } from "./db";
import {
  scoutConfig,
  senderConfig,
  ScoutError,
  SCOUT_COOLDOWN_HOURS,
} from "./config";
import { loadCandidates, loadEvidence, loadJob, syncStop } from "./sources";
import {
  contactKeys,
  digest,
  eligibility,
  emailKey,
  normalizeEmail,
  sameSnapshot,
  validateCopy,
} from "./policy";
import { sendGmailMessage } from "@/lib/email/gmail-client";
import type {
  Candidate,
  Eligibility,
  ScoutJob,
  ScoutMessage,
  Staff,
} from "./types";

export async function snapshot() {
  const [candidates, evidence, stops] = await Promise.all([
    loadCandidates(),
    loadEvidence(),
    dbAll<{ email_key: string }>(
      "scout_suppressions",
      new URLSearchParams({ select: "email_key", order: "email_key.asc" }),
    ),
  ]);
  return {
    candidates,
    evidence,
    suppressed: new Set(stops.map((s) => s.email_key)),
  };
}
const tokenFor = (id: string) =>
  createHmac("sha256", scoutConfig().secret)
    .update(`unsubscribe:${id}`)
    .digest("base64url");
const unsubscribeUrl = (id: string) =>
  `${scoutConfig().publicUrl}/scout/unsubscribe?token=${tokenFor(id)}`;
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
function ensureEligible(
  candidate: Candidate | undefined,
  s: Awaited<ReturnType<typeof snapshot>>,
) {
  if (!candidate) throw new ScoutError("候補者が見つかりません", 404);
  const result = eligibility(candidate, s.candidates, s.evidence, s.suppressed);
  if (!result.allowed) throw new ScoutError(result.reasons.join("。"), 409);
  return { candidate, result };
}
export function draftRecord(
  staff: Staff,
  candidate: Candidate,
  result: Eligibility,
  job: ScoutJob,
  copy: { subject: string; body: string },
  expiresAt: string,
) {
  const sender = senderConfig();
  const id = randomUUID();
  const url = new URL(job.url);
  url.search = new URLSearchParams({
    utm_source: "ridejob_scout",
    utm_medium: "email",
    utm_campaign: "pma_scout",
    utm_content: id,
  }).toString();
  const body = `${candidate.name}様\n\n${copy.body}\n\n【ご紹介する求人】\n${job.company}\n${job.title}\n勤務地：${job.region || "求人詳細をご確認ください"}\n${url}\n\nご興味・ご質問がありましたら、このメールにご返信ください。\n\nRIDE JOB（株式会社PM Agent）\n担当：${staff.display_name}\n${sender.address}\n返信先：${sender.replyTo}\n\nスカウトメールの配信停止：\n${unsubscribeUrl(id)}\n※配信停止後も、お申し込み済みの応募・選考に必要なご連絡は継続します。`;
  const row: ScoutMessage = {
    id,
    staff_id: staff.id,
    candidate_id: candidate.id,
    candidate_name: candidate.name,
    candidate_snapshot: candidate,
    email: normalizeEmail(candidate.email),
    contact_keys: contactKeys(candidate),
    job_id: job.id,
    job_snapshot: job,
    subject: copy.subject,
    body,
    from_email: sender.from,
    reply_to: sender.replyTo,
    consent_snapshot: {
      evidence: result.evidence,
      larkConsentDate: candidate.consentDate,
      larkConsentMethod: candidate.consentMethod,
      checkedAt: new Date().toISOString(),
      conditionsConfirmed: true,
      checkedBy: staff.id,
    },
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    status: "draft",
    provider_id: null,
    sent_at: null,
    outcome: "none",
  };
  return {
    message: row,
    token: {
      token_hash: digest(tokenFor(id)),
      email_key: emailKey(candidate.email),
      email: candidate.email,
      message_id: id,
    },
  };
}

export async function createDraft(
  staff: Staff,
  input: Record<string, unknown>,
) {
  if (input.conditionsConfirmed !== true)
    throw new ScoutError(
      "求人条件・紹介可否・他担当の対応状況を確認してください",
      400,
    );
  let copy: { subject: string; body: string };
  try {
    copy = validateCopy(input.subject, input.body);
  } catch (e) {
    throw new ScoutError((e as Error).message, 400);
  }
  if (typeof input.candidateId !== "string" || typeof input.jobId !== "string")
    throw new ScoutError("候補者と求人を選択してください", 400);
  const [s, job] = await Promise.all([snapshot(), loadJob(input.jobId)]);
  const { candidate, result } = ensureEligible(
    s.candidates.find((c) => c.id === input.candidateId),
    s,
  );
  const { message: row, token } = draftRecord(
    staff,
    candidate,
    result,
    job,
    copy,
    new Date(Date.now() + 15 * 60_000).toISOString(),
  );
  const id = row.id;
  const saved = await db<ScoutMessage[]>("scout_messages", {
    method: "POST",
    body: JSON.stringify(row),
  });
  await db("scout_unsubscribe_tokens", {
    method: "POST",
    body: JSON.stringify(token),
  });
  await db("scout_audit", {
    method: "POST",
    body: JSON.stringify({
      staff_id: staff.id,
      message_id: id,
      event: "draft_confirmed",
    }),
  });
  return saved[0];
}

export async function sendDraft(staff: Staff, id: string, batchId?: string) {
  const config = scoutConfig();
  if (process.env.SCOUT_SEND_ENABLED !== "true")
    throw new ScoutError("実送信はまだ有効になっていません", 409);
  const cooldown = SCOUT_COOLDOWN_HOURS;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new ScoutError("送信IDが正しくありません", 400);
  const rows = await db<ScoutMessage[]>(
    `scout_messages?${new URLSearchParams({ id: `eq.${id}`, staff_id: `eq.${staff.id}`, limit: "1" })}`,
  );
  const m = rows[0];
  if (!m) throw new ScoutError("下書きが見つかりません", 404);
  if (m.batch_id && m.batch_id !== batchId)
    throw new ScoutError("グループの最終確認から送信してください", 409);
  if (m.status !== "draft")
    return { id, status: m.status, providerId: m.provider_id };
  if (Date.parse(m.expires_at) <= Date.now())
    throw new ScoutError(
      "確認画面の有効期限が切れました。文面を確認し直してください",
      409,
    );
  const sender = senderConfig();
  if (
    sender.from !== m.from_email ||
    sender.replyTo !== m.reply_to ||
    !config.publicUrl.startsWith("https:") ||
    !m.body.includes(unsubscribeUrl(id)) ||
    !m.body.includes(sender.address)
  )
    throw new ScoutError(
      "送信設定が変わりました。文面を確認し直してください",
      409,
    );
  const [s, job] = await Promise.all([snapshot(), loadJob(m.job_id)]);
  const { candidate, result } = ensureEligible(
    s.candidates.find((c) => c.id === m.candidate_id),
    s,
  );
  if (
    !sameSnapshot(candidate, m.candidate_snapshot) ||
    normalizeEmail(candidate.email) !== m.email ||
    JSON.stringify(contactKeys(candidate)) !== JSON.stringify(m.contact_keys) ||
    !sameSnapshot(job, m.job_snapshot)
  )
    throw new ScoutError(
      "候補者または求人が更新されました。文面を確認し直してください",
      409,
    );
  // 原本再確認の時刻を残してから、DBトランザクションで接触制限と二重送信を判定。
  await db("scout_audit", {
    method: "POST",
    body: JSON.stringify({
      staff_id: staff.id,
      message_id: id,
      event: "eligibility_rechecked",
      detail: {
        consentSource: result.evidence!.source,
        consentSubmissionId: result.evidence!.submissionId,
      },
    }),
  });
  const claim = await rpc<string>("scout_claim", {
    p_id: id,
    p_staff: staff.id,
    p_cooldown_hours: cooldown,
  });
  if (claim !== "claimed") {
    if (["accepted", "sending", "unknown"].includes(claim))
      return { id, status: claim };
    const labels: Record<string, string> = {
      cooldown: "同じ連絡先への送信間隔が空いていません",
      unresolved:
        "前回の送信結果が未確認です。再送せず管理者に確認してください",
      suppressed: "メール配信停止中です",
      expired: "確認画面の有効期限が切れました",
    };
    throw new ScoutError(labels[claim] || "送信を開始できません", 409);
  }
  // これ以降、例外でも自動再送しない。送信結果の保存に失敗した場合もsendingが接触を止める。
  let status: "accepted" | "unknown" = "unknown";
  let providerId: string | null = null;
  try {
    const stopped = await db<{ email_key: string }[]>(
      `scout_suppressions?${new URLSearchParams({ select: "email_key", email_key: `eq.${emailKey(candidate.email)}` })}`,
    );
    if (stopped.length) throw new Error("suppressed");
    const result = await sendGmailMessage({
      from: m.from_email,
      fromName: sender.name,
      replyTo: m.reply_to,
      to: m.email,
      subject: m.subject,
      textBody: m.body,
      htmlBody: `<div style="white-space:pre-wrap;font:16px/1.8 sans-serif">${escapeHtml(m.body)}</div>`,
      unsubscribeUrl: `${config.publicUrl}/api/scout/unsubscribe?token=${tokenFor(id)}`,
    });
    status = "accepted";
    providerId = result.messageId ?? null;
  } catch {
    /* 受理された可能性を除外できないためunknown。メール本文・エラー詳細はログに出さない。 */
  }
  await rpc("scout_finish", {
    p_id: id,
    p_staff: staff.id,
    p_status: status,
    p_provider: providerId,
  });
  return { id, status, providerId };
}

export async function unsubscribe(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new ScoutError("配信停止リンクを確認してください", 400);
  const key = await rpc<string | null>("scout_unsubscribe", {
    p_token_hash: digest(token),
  });
  if (!key) throw new ScoutError("配信停止リンクを確認してください", 400);
  try {
    const rows = await db<{ email: string }[]>(
      `scout_unsubscribe_tokens?${new URLSearchParams({ select: "email", token_hash: `eq.${digest(token)}`, limit: "1" })}`,
    );
    const all = await loadCandidates();
    await syncStop(rows[0].email, all);
    await db(
      `scout_suppressions?${new URLSearchParams({ email_key: `eq.${key}` })}`,
      {
        method: "PATCH",
        body: JSON.stringify({ lark_synced_at: new Date().toISOString() }),
      },
    );
  } catch {
    /* 自社の停止は保存済み。Lark反映保留を管理画面に表示し、担当者が再実行する。 */
  }
  return { stopped: true };
}
