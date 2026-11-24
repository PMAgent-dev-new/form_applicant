import { randomUUID } from "node:crypto";
import { db, dbAll, rpc } from "./db";
import { SCOUT_BATCH_LIMIT, ScoutError } from "./config";
import { generatePlan } from "./ai";
import { groupCandidates, type ContactState, type Proposal } from "./groups";
import { contactKeys, eligibility, sameSnapshot, validateCopy } from "./policy";
import { draftRecord, sendDraft, snapshot } from "./service";
import { loadJob } from "./sources";
import type { ScoutMessage, ScoutMessageView, Staff } from "./types";

export type ScoutBatch = {
  id: string;
  staff_id: string;
  proposal_id: string;
  status: "prepared" | "approved" | "paused" | "completed";
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  send_until: string | null;
  total: number;
  active_message: string | null;
  last_error: string | null;
};
const uuid = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
async function proposalById(staff: Staff, id: unknown) {
  if (!uuid(id)) throw new ScoutError("提案を選択してください", 400);
  const rows = await db<Proposal[]>(
    `scout_proposals?${new URLSearchParams({ id: `eq.${id}`, staff_id: `eq.${staff.id}`, limit: "1" })}`,
  );
  if (!rows[0] || Date.parse(rows[0].expires_at) <= Date.now())
    throw new ScoutError("提案の有効期限が切れました。作り直してください", 409);
  return rows[0];
}
async function groupSnapshot(proposal: Proposal) {
  const [data, locks, currentJob] = await Promise.all([
    snapshot(),
    dbAll<ContactState>(
      "scout_contact_locks",
      new URLSearchParams({
        select: "contact_key,last_sent_at,message:scout_messages(status)",
        order: "contact_key.asc",
      }),
    ),
    loadJob(proposal.job_snapshot.id),
  ]);
  if (!sameSnapshot(currentJob, proposal.job_snapshot))
    throw new ScoutError(
      "求人が更新されました。AI提案から作り直してください",
      409,
    );
  return { data, ...groupCandidates(proposal.plan, currentJob, data, locks) };
}
export async function createProposal(
  staff: Staff,
  input: Record<string, unknown>,
) {
  if (typeof input.jobId !== "string")
    throw new ScoutError("求人を選択してください", 400);
  const job = await loadJob(input.jobId);
  const ai = await generatePlan(staff, job);
  const rows = await db<Proposal[]>("scout_proposals", {
    method: "POST",
    body: JSON.stringify({
      id: randomUUID(),
      staff_id: staff.id,
      job_snapshot: job,
      plan: ai.plan,
      model: ai.model,
      provenance: {
        inputHash: ai.inputHash,
        promptVersion: ai.promptVersion,
        usage: ai.usage,
        provider: "anthropic",
        candidateDataSent: false,
      },
      expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
    }),
  });
  return readProposal(staff, rows[0].id);
}
export async function readProposal(staff: Staff, id: unknown) {
  const proposal = await proposalById(staff, id);
  const { groups, excluded } = await groupSnapshot(proposal);
  await db("scout_audit", {
    method: "POST",
    body: JSON.stringify({
      staff_id: staff.id,
      event: "group_candidates_viewed",
      detail: {
        proposalId: proposal.id,
        count: groups.reduce((n, g) => n + g.candidates.length, 0),
      },
    }),
  });
  return { proposal, groups, excluded, maxRecipients: SCOUT_BATCH_LIMIT };
}

type Selection = {
  groupId: string;
  candidateIds: string[];
  subject: string;
  body: string;
};
export function validateSelections(value: unknown): Selection[] {
  if (!Array.isArray(value) || !value.length || value.length > 20)
    throw new ScoutError("送信するグループを選択してください", 400);
  const seen = new Set<string>();
  const groups = new Set<string>();
  return value.map((v) => {
    if (
      !v ||
      typeof v.groupId !== "string" ||
      groups.has(v.groupId) ||
      !Array.isArray(v.candidateIds) ||
      !v.candidateIds.length
    )
      throw new ScoutError("グループの選択を確認してください", 400);
    groups.add(v.groupId);
    for (const id of v.candidateIds) {
      if (typeof id !== "string" || id.length > 150 || seen.has(id))
        throw new ScoutError("対象者が重複しているか選択が不正です", 400);
      seen.add(id);
    }
    if (seen.size > SCOUT_BATCH_LIMIT)
      throw new ScoutError(`1回の送信は${SCOUT_BATCH_LIMIT}人までです`, 400);
    try {
      return {
        groupId: v.groupId,
        candidateIds: v.candidateIds,
        ...validateCopy(v.subject, v.body),
      };
    } catch (e) {
      throw new ScoutError((e as Error).message, 400);
    }
  });
}

export async function prepareBatch(
  staff: Staff,
  input: Record<string, unknown>,
) {
  if (input.conditionsConfirmed !== true)
    throw new ScoutError(
      "募集・紹介可否と対象者全員の条件・他担当の対応状況を確認してください",
      400,
    );
  const selections = validateSelections(input.selections);
  const proposal = await proposalById(staff, input.proposalId);
  const { data, groups } = await groupSnapshot(proposal);
  const id = randomUUID(),
    expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const messages: ScoutMessage[] = [],
    tokens: ReturnType<typeof draftRecord>["token"][] = [];
  const contacts = new Set<string>();
  for (const selection of selections) {
    const group = groups.find((g) => g.id === selection.groupId);
    for (const candidateId of selection.candidateIds) {
      if (!group?.candidates.some((c) => c.id === candidateId))
        throw new ScoutError(
          "対象者の同意・停止・登録内容が変わりました。候補を再確認してください",
          409,
        );
      const candidate = data.candidates.find((c) => c.id === candidateId)!;
      const keys = contactKeys(candidate);
      if (keys.some((k) => contacts.has(k)))
        throw new ScoutError("同一連絡先が複数含まれています", 409);
      keys.forEach((k) => contacts.add(k));
      const e = eligibility(
        candidate,
        data.candidates,
        data.evidence,
        data.suppressed,
      );
      if (!e.allowed)
        throw new ScoutError("送信できない対象者が含まれています", 409);
      const draft = draftRecord(
        staff,
        candidate,
        e,
        proposal.job_snapshot,
        selection,
        expiresAt,
      );
      messages.push({
        ...draft.message,
        batch_id: id,
        batch_index: messages.length,
      });
      tokens.push(draft.token);
    }
  }
  await rpc("scout_prepare_batch", {
    p_batch: {
      id,
      staff_id: staff.id,
      proposal_id: proposal.id,
      total: messages.length,
      expires_at: expiresAt,
    },
    p_messages: messages,
    p_tokens: tokens,
  });
  return readBatch(staff, id);
}
async function ownedBatch(staff: Staff, id: unknown) {
  if (!uuid(id)) throw new ScoutError("送信グループを選択してください", 400);
  const batches = await db<ScoutBatch[]>(
    `scout_batches?${new URLSearchParams({ id: `eq.${id}`, staff_id: `eq.${staff.id}`, limit: "1" })}`,
  );
  if (!batches[0]) throw new ScoutError("送信グループが見つかりません", 404);
  return batches[0];
}
const displayColumns =
  "id,candidate_name,email,subject,from_email,reply_to,status,provider_id,created_at,sent_at,outcome,batch_index";
export async function readBatchMessage(
  staff: Staff,
  batchId: unknown,
  messageId: unknown,
) {
  const batch = await ownedBatch(staff, batchId);
  if (!uuid(messageId)) throw new ScoutError("文面を選択してください", 400);
  const rows = await db<ScoutMessageView[]>(
    `scout_messages?${new URLSearchParams({ select: displayColumns + ",body", id: `eq.${messageId}`, batch_id: `eq.${batch.id}`, staff_id: `eq.${staff.id}`, limit: "1" })}`,
  );
  if (!rows[0]) throw new ScoutError("文面が見つかりません", 404);
  return rows[0];
}
export async function readBatch(staff: Staff, id: unknown) {
  const batch = await ownedBatch(staff, id);
  const messages = await dbAll<ScoutMessageView>(
    "scout_messages",
    new URLSearchParams({
      select: displayColumns,
      batch_id: `eq.${batch.id}`,
      staff_id: `eq.${staff.id}`,
      order: "batch_index.asc",
    }),
  );
  const first = messages.find((m) => m.status === "draft") || messages[0];
  if (first)
    Object.assign(first, await readBatchMessage(staff, batch.id, first.id));
  return { batch, messages };
}
// 配送のたびに300人分の本文・同意原本をブラウザーへ再送しない。
async function batchProgress(staff: Staff, id: string, messageId?: string) {
  const batch = await ownedBatch(staff, id);
  const messages = messageId
    ? await db<ScoutMessageView[]>(
        `scout_messages?${new URLSearchParams({ select: displayColumns, id: `eq.${messageId}`, batch_id: `eq.${id}`, staff_id: `eq.${staff.id}`, limit: "1" })}`,
      )
    : [];
  return { batch, messages, partial: true as const };
}
export async function recentBatches(staff: Staff) {
  return db<ScoutBatch[]>(
    `scout_batches?${new URLSearchParams({ staff_id: `eq.${staff.id}`, order: "created_at.desc", limit: "30" })}`,
  );
}
export async function batchAction(
  staff: Staff,
  input: Record<string, unknown>,
) {
  if (!uuid(input.batchId))
    throw new ScoutError("送信グループを選択してください", 400);
  const id = input.batchId;
  if (
    ["approve", "resume"].includes(String(input.action)) &&
    input.confirmed !== true
  )
    throw new ScoutError("対象者と最終文面を確認してください", 400);
  if (["approve", "resume", "pause"].includes(String(input.action))) {
    const result = await rpc<string>("scout_batch_action", {
      p_id: id,
      p_staff: staff.id,
      p_action: input.action,
    });
    if (result !== "ok")
      throw new ScoutError(
        result === "unresolved"
          ? "処理中の結果を確認できません。再送せず管理者に確認してください"
          : "期限・状態が変わりました。送信一覧を確認してください",
        409,
      );
    return readBatch(staff, id);
  }
  if (input.action !== "next")
    throw new ScoutError("操作を確認してください", 400);
  if (process.env.SCOUT_SEND_ENABLED !== "true")
    throw new ScoutError("実送信はまだ有効になっていません", 409);
  const reserve = await rpc<{ status: string; messageId?: string }>(
    "scout_batch_reserve",
    { p_id: id, p_staff: staff.id },
  );
  if (reserve.status !== "reserved" || !reserve.messageId)
    return { ...(await batchProgress(staff, id)), step: reserve.status };
  try {
    const result = await sendDraft(staff, reserve.messageId, id);
    await rpc("scout_batch_finish_step", {
      p_id: id,
      p_staff: staff.id,
      p_message: reserve.messageId,
      p_error:
        result.status === "accepted"
          ? null
          : "送信結果が未確認のため中断しました",
    });
  } catch (e) {
    await rpc("scout_batch_finish_step", {
      p_id: id,
      p_staff: staff.id,
      p_message: reserve.messageId,
      p_error:
        e instanceof ScoutError
          ? e.code
          : "処理結果を確認できないため中断しました",
    });
  }
  return {
    ...(await batchProgress(staff, id, reserve.messageId)),
    step: "processed",
  };
}
