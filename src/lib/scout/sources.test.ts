import { describe, expect, it } from "vitest";
import { fieldText } from "./sources";
describe("Lark field shapes", () => {
  it("joins rich-text fragments without corrupting contact addresses", () => {
    expect(fieldText([{ text: "sample" }, { text: "@example.com" }])).toBe(
      "sample@example.com",
    );
    expect(fieldText(["大型免許", "フォークリフト"])).toBe(
      "大型免許 / フォークリフト",
    );
    expect(
      fieldText({ type: 1, value: [{ text: "埼玉" }, { text: "県" }] }),
    ).toBe("埼玉県");
  });
  it("does not invent labels for linked-record IDs or unknown objects", () => {
    expect(fieldText({ link_record_ids: ["rec123"] })).toBe("");
    expect(fieldText({ unknown: "data" })).toBe("");
  });
});
