/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { hashPin, isPin, verifyPin } from "./lock.ts";

describe("PIN hash", () => {
  it("hashes and verifies a 4–6 digit PIN", () => {
    expect(isPin("1234")).toBe(true);
    const stored = hashPin("2468");
    expect(verifyPin("2468", stored)).toBe(true);
    expect(verifyPin("2469", stored)).toBe(false);
    expect(verifyPin("246", stored)).toBe(false);
  });
});
