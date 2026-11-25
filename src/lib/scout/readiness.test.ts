import {afterEach,beforeEach,expect,test,vi} from "vitest";
vi.mock("@/lib/email/gmail-client",()=>({checkGmailSender:vi.fn()}));
import {checkGmailSender} from "@/lib/email/gmail-client";
import {scoutSenderReady} from "./readiness";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("SCOUT_REPLY_TO","ridejob@pmagent.jp");vi.stubEnv("SCOUT_SENDER_POSTAL_ADDRESS","テスト住所");});
afterEach(()=>vi.unstubAllEnvs());
test("checks only the fixed approved sender",async()=>{
  vi.mocked(checkGmailSender).mockResolvedValue(true);
  await expect(scoutSenderReady()).resolves.toBe(true);
  expect(checkGmailSender).toHaveBeenCalledWith("ridejob@pmagent.jp");
});
test("missing settings and authentication errors fail closed",async()=>{
  vi.stubEnv("SCOUT_REPLY_TO","");
  await expect(scoutSenderReady()).resolves.toBe(false);
  expect(checkGmailSender).not.toHaveBeenCalled();
  vi.stubEnv("SCOUT_REPLY_TO","ridejob@pmagent.jp");
  vi.mocked(checkGmailSender).mockRejectedValue(new Error("provider-secret"));
  await expect(scoutSenderReady()).resolves.toBe(false);
});
