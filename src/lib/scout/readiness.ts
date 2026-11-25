import { senderConfig } from "./config";
import { checkGmailSender } from "@/lib/email/gmail-client";

export async function scoutSenderReady(): Promise<boolean> {
  try { return await checkGmailSender(senderConfig().from); }
  catch { console.warn('scout_sender_auth_failed', 'sender_configuration'); return false; }
}
