import { describe, expect, it } from "vitest";
import { inviteCode } from "../src/circles";
const code =
  "11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222";
describe("invitation input", () => {
  it("accepts a code or a fragment invitation link", () => {
    expect(inviteCode(` ${code} `)).toBe(code);
    expect(inviteCode(`https://example.test/#invite=${code}`)).toBe(code);
  });
  it("rejects arbitrary URLs, query tokens and unsafe protocols", () => {
    expect(inviteCode("not an invite")).toBe("");
    expect(inviteCode(`https://example.test/?invite=${code}`)).toBe("");
    expect(inviteCode(`javascript:alert(1)#invite=${code}`)).toBe("");
  });
});
