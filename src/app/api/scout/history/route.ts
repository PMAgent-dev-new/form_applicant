import { NextRequest } from "next/server";
import { json, protectedHandler, readInput } from "@/lib/scout/auth";
import { db } from "@/lib/scout/db";
import { ScoutError } from "@/lib/scout/config";
import type { ScoutMessage } from "@/lib/scout/types";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  return protectedHandler(req, async () => {
    const [messages, pending] = await Promise.all([
      db<ScoutMessage[]>(
        "scout_messages?select=id,candidate_id,candidate_name,job_id,subject,status,provider_id,created_at,sent_at,outcome,staff_id&order=created_at.desc&limit=100",
      ),
      db<{ email_key: string }[]>(
        "scout_suppressions?select=email_key&lark_synced_at=is.null",
      ),
    ]);
    return json({ messages, pendingStopSync: pending.length });
  });
}
export async function PATCH(req: NextRequest) {
  return protectedHandler(req, async (staff) => {
    const input = await readInput(req);
    if (
      typeof input.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(input.id) ||
      !["none", "replied", "meeting", "declined"].includes(
        String(input.outcome),
      )
    )
      throw new ScoutError("更新内容を確認してください", 400);
    const updated = await db<ScoutMessage[]>(
      `scout_messages?${new URLSearchParams({ id: `eq.${input.id}`, status: "eq.accepted" })}`,
      { method: "PATCH", body: JSON.stringify({ outcome: input.outcome }) },
    );
    if (updated.length !== 1)
      throw new ScoutError("送信履歴を確認してください", 409);
    await db("scout_audit", {
      method: "POST",
      body: JSON.stringify({
        staff_id: staff.id,
        message_id: input.id,
        event: "outcome_updated",
        detail: { outcome: input.outcome },
      }),
    });
    return json({ updated: true });
  });
}
