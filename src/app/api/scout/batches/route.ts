import { NextRequest } from "next/server";
import { json, protectedHandler, readInput } from "@/lib/scout/auth";
import {
  batchAction,
  prepareBatch,
  readBatch,
  readBatchMessage,
  recentBatches,
} from "@/lib/scout/batch";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  return protectedHandler(req, async (staff) => {
    const input = await readInput(req, 100000);
    return json(
      input.action === "prepare"
        ? await prepareBatch(staff, input)
        : await batchAction(staff, input),
    );
  });
}
export async function GET(req: NextRequest) {
  return protectedHandler(req, async (staff) => {
    const id = req.nextUrl.searchParams.get("id");
    const messageId = req.nextUrl.searchParams.get("messageId");
    if (messageId)
      return json({ message: await readBatchMessage(staff, id, messageId) });
    return json(
      id ? await readBatch(staff, id) : { batches: await recentBatches(staff) },
    );
  });
}
