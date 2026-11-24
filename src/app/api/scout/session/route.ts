import { NextRequest } from "next/server";
import {
  checkOrigin,
  json,
  login,
  protectedHandler,
  safeError,
  SESSION_COOKIE,
} from "@/lib/scout/auth";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  return protectedHandler(req, async (staff) =>
    json({ staff, sendingEnabled: process.env.SCOUT_SEND_ENABLED === "true" }),
  );
}
export async function POST(req: NextRequest) {
  try {
    return await login(req);
  } catch (e) {
    return safeError(e);
  }
}
export async function DELETE(req: NextRequest) {
  try {
    checkOrigin(req);
    const response = json({ loggedOut: true });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (e) {
    return safeError(e);
  }
}
