import { NextRequest } from "next/server";
import { json, protectedHandler } from "@/lib/scout/auth";
import { loadJob } from "@/lib/scout/sources";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  return protectedHandler(req, async () =>
    json({ job: await loadJob(req.nextUrl.searchParams.get("id") || "") }),
  );
}
