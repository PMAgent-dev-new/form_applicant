import { NextRequest } from "next/server";
import { json, protectedHandler, readInput } from "@/lib/scout/auth";
import { createDraft } from "@/lib/scout/service";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  return protectedHandler(req, async (staff) =>
    json({ draft: await createDraft(staff, await readInput(req)) }),
  );
}
