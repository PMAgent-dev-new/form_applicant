import { NextRequest } from "next/server";
import { json, protectedHandler, readInput } from "@/lib/scout/auth";
import { createProposal, readProposal } from "@/lib/scout/batch";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  return protectedHandler(req, async (staff) =>
    json(await createProposal(staff, await readInput(req))),
  );
}
export async function GET(req: NextRequest) {
  return protectedHandler(req, async (staff) =>
    json(await readProposal(staff, req.nextUrl.searchParams.get("id"))),
  );
}
