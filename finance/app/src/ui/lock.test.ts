import { describe, expect, it } from "vitest";
import { autoLockLabel, isPinDigits, isUnlockValid } from "./lock.ts";

describe("lock session", () => {
  it("accepts 4–6 digit PINs only", () => {
    expect(isPinDigits("1234")).toBe(true);
    expect(isPinDigits("123456")).toBe(true);
    expect(isPinDigits("123")).toBe(false);
    expect(isPinDigits("1234567")).toBe(false);
    expect(isPinDigits("12ab")).toBe(false);
  });

  it("expires after auto-lock seconds, never if interval is 0", () => {
    expect(isUnlockValid(1000, 120, 1000 + 119_000)).toBe(true);
    expect(isUnlockValid(1000, 120, 1000 + 121_000)).toBe(false);
    expect(isUnlockValid(1000, 0, 1000 + 10_000_000)).toBe(true);
    expect(isUnlockValid(null, 120, 1000)).toBe(false);
  });

  it("labels auto-lock intervals", () => {
    expect(autoLockLabel(0)).toBe("Until you close the tab");
    expect(autoLockLabel(30)).toBe("30 seconds");
    expect(autoLockLabel(60)).toBe("1 minute");
    expect(autoLockLabel(120)).toBe("2 minutes");
  });
});
