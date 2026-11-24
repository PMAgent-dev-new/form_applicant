import { NextRequest } from "next/server";
import { json, safeError } from "@/lib/scout/auth";
import { ScoutError } from "@/lib/scout/config";
import { unsubscribe } from "@/lib/scout/service";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  try {
    // 署名済みリンクの所持で解除可能。Gmailのone-click POSTにはOrigin/Cookieを求めない。
    const raw = await req.text();
    if (raw.length > 1000) throw new ScoutError("入力を確認してください", 400);
    const body = new URLSearchParams(raw);
    const token =
      req.nextUrl.searchParams.get("token") || body.get("token") || "";
    return json(await unsubscribe(token));
  } catch (e) {
    return safeError(e);
  }
}
