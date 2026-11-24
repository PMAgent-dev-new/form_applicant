import { NextRequest } from "next/server";
import { json, protectedHandler, readInput } from "@/lib/scout/auth";
import { sendDraft } from "@/lib/scout/service";
import { ScoutError } from "@/lib/scout/config";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  return protectedHandler(req, async (staff) => {
    const input = await readInput(req);
    if (input.confirmed !== true || typeof input.draftId !== "string")
      throw new ScoutError("宛先・文面を確認してください", 400);
    return json(await sendDraft(staff, input.draftId));
  });
}
