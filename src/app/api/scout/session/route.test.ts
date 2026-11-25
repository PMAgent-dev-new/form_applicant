import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {NextRequest,NextResponse} from "next/server";
vi.mock("@/lib/scout/readiness",()=>({scoutSenderReady:vi.fn()}));
vi.mock("@/lib/scout/auth",()=>({
  protectedHandler:vi.fn(), json:(body:unknown)=>NextResponse.json(body),
  login:vi.fn(),checkOrigin:vi.fn(),safeError:vi.fn(),SESSION_COOKIE:"unused-test",
}));
import {scoutSenderReady} from "@/lib/scout/readiness";
import {protectedHandler} from "@/lib/scout/auth";
import {GET} from "./route";
const staff={id:"11111111-1111-4111-8111-111111111111",email:"staff@example.invalid",display_name:"確認担当"};
const request=()=>new NextRequest("https://example.invalid/entry/api/scout/session");
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("SCOUT_SEND_ENABLED","true");vi.mocked(protectedHandler).mockImplementation((_req,fn)=>fn(staff));});
afterEach(()=>vi.unstubAllEnvs());
test("enabled sending also requires live sender authentication",async()=>{
  vi.mocked(scoutSenderReady).mockResolvedValue(false);
  expect(await (await GET(request())).json()).toMatchObject({senderReady:false,sendingEnabled:false});
  vi.mocked(scoutSenderReady).mockResolvedValue(true);
  expect(await (await GET(request())).json()).toMatchObject({senderReady:true,sendingEnabled:true});
  vi.stubEnv("SCOUT_SEND_ENABLED","false");
  expect(await (await GET(request())).json()).toMatchObject({senderReady:true,sendingEnabled:false});
});
test("unauthenticated requests do not reach the provider probe",async()=>{
  vi.mocked(protectedHandler).mockResolvedValue(NextResponse.json({error:"unauthorized"},{status:401}));
  expect((await GET(request())).status).toBe(401);
  expect(scoutSenderReady).not.toHaveBeenCalled();
});
