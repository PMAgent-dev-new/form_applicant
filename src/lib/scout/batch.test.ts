import { beforeEach, afterEach, it, expect, vi } from "vitest";
vi.mock("./db", () => ({ db: vi.fn(), dbAll: vi.fn(), rpc: vi.fn() }));
vi.mock("./service", () => ({
  sendDraft: vi.fn(),
  snapshot: vi.fn(),
  draftRecord: vi.fn(),
}));
import { db, dbAll, rpc } from "./db";
import { sendDraft } from "./service";
import { validateSelections, batchAction } from "./batch";
const staff = {
  id: "10000000-0000-0000-0000-000000000001",
  email: "staff@example.com",
  display_name: "見本",
};
const bid = "20000000-0000-0000-0000-000000000001",
  mid = "30000000-0000-0000-0000-000000000001";
const copy = {
  groupId: "group",
  subject: "お仕事のご案内",
  body: "配送のお仕事をご案内します。ご興味がありましたらご確認ください。",
};
beforeEach(() => {
  vi.stubEnv("SCOUT_SEND_ENABLED", "true");
  vi.mocked(db).mockResolvedValue([
    { id: bid, staff_id: staff.id, status: "approved" },
  ]);
  vi.mocked(dbAll).mockResolvedValue([]);
  vi.mocked(rpc).mockImplementation(async (name) =>
    name === "scout_batch_reserve"
      ? { status: "reserved", messageId: mid }
      : "ok",
  );
  vi.mocked(sendDraft).mockResolvedValue({ id: mid, status: "accepted" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("allows 300 and rejects 301, duplicated recipients or arbitrary content", () => {
  expect(
    validateSelections([
      {
        ...copy,
        candidateIds: Array.from({ length: 300 }, (_, i) => String(i)),
      },
    ])[0].candidateIds,
  ).toHaveLength(300);
  expect(() =>
    validateSelections([
      {
        ...copy,
        candidateIds: Array.from({ length: 301 }, (_, i) => String(i)),
      },
    ]),
  ).toThrow();
  expect(() =>
    validateSelections([{ ...copy, candidateIds: ["1", "1"] }]),
  ).toThrow();
  expect(() =>
    validateSelections([
      {
        ...copy,
        candidateIds: ["1"],
        body: copy.body + "https://other.example",
      },
    ]),
  ).toThrow();
});
it("requires final approval and never sends from approve action itself", async () => {
  await expect(
    batchAction(staff, { batchId: bid, action: "approve" }),
  ).rejects.toMatchObject({ status: 400 });
  await batchAction(staff, {
    batchId: bid,
    action: "approve",
    confirmed: true,
  });
  expect(sendDraft).not.toHaveBeenCalled();
});
it("sends only the server-reserved member and passes the batch boundary", async () => {
  await batchAction(staff, {
    batchId: bid,
    action: "next",
    draftId: "injected",
    email: "evil@example.com",
  });
  expect(sendDraft).toHaveBeenCalledExactlyOnceWith(staff, mid, bid);
  expect(dbAll).not.toHaveBeenCalled();
  expect(
    vi
      .mocked(db)
      .mock.calls.some(
        ([path]) =>
          path.startsWith("scout_messages?") && path.includes("limit=1"),
      ),
  ).toBe(true);
  expect(rpc).toHaveBeenLastCalledWith("scout_batch_finish_step", {
    p_id: bid,
    p_staff: staff.id,
    p_message: mid,
    p_error: null,
  });
});
it("busy, unapproved, expired and paused cannot initiate a provider send", async () => {
  for (const status of ["busy", "prepared", "expired", "paused"]) {
    vi.mocked(rpc).mockResolvedValueOnce({ status });
    await batchAction(staff, { batchId: bid, action: "next" });
  }
  expect(sendDraft).not.toHaveBeenCalled();
});
it("pauses on unknown or error without retrying the message", async () => {
  vi.mocked(sendDraft).mockResolvedValue({ id: mid, status: "unknown" });
  await batchAction(staff, { batchId: bid, action: "next" });
  expect(rpc).toHaveBeenLastCalledWith(
    "scout_batch_finish_step",
    expect.objectContaining({ p_error: "送信結果が未確認のため中断しました" }),
  );
  vi.mocked(sendDraft).mockRejectedValue(new Error("provider private payload"));
  await batchAction(staff, { batchId: bid, action: "next" });
  expect(rpc).toHaveBeenLastCalledWith(
    "scout_batch_finish_step",
    expect.objectContaining({
      p_error: "処理結果を確認できないため中断しました",
    }),
  );
  expect(sendDraft).toHaveBeenCalledTimes(2);
});
it("global send switch prevents reservation", async () => {
  vi.stubEnv("SCOUT_SEND_ENABLED", "false");
  await expect(
    batchAction(staff, { batchId: bid, action: "next" }),
  ).rejects.toMatchObject({ status: 409 });
  expect(rpc).not.toHaveBeenCalled();
});

it("returns 300 summaries and just one full body without internal snapshots", async () => {
  const { readBatch } = await import("./batch");
  const messages = Array.from({ length: 300 }, (_, i) => ({
    id: `30000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    candidate_name: "架空の候補者",
    email: `sample${i}@example.com`,
    subject: "件".repeat(120),
    from_email: "ridejob@pmagent.jp",
    reply_to: "reply@example.com",
    status: "draft",
    provider_id: null,
    batch_index: i,
    created_at: "2026-11-24",
    sent_at: null,
    outcome: "none",
  }));
  vi.mocked(dbAll).mockResolvedValue(messages);
  vi.mocked(db).mockImplementation(async (path) =>
    path.startsWith("scout_batches?")
      ? [{ id: bid }]
      : [{ ...messages[0], body: "文".repeat(5000) }],
  );
  const result = await readBatch(staff, bid);
  expect(result.messages.filter((m) => m.body)).toHaveLength(1);
  expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
    400000,
  );
  const params = vi.mocked(dbAll).mock.calls[0][1];
  expect(params.get("select")).not.toMatch(/body|snapshot|contact_keys/);
  expect(
    vi
      .mocked(db)
      .mock.calls.filter(([path]) => path.startsWith("scout_messages?"))
      .every(
        ([path]) => path.includes("limit=1") && !path.includes("snapshot"),
      ),
  ).toBe(true);
});
