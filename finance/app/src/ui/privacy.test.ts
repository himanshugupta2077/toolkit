import { describe, expect, it } from "vitest";
import { initialBlur, readBlurSession, writeBlurSession } from "./privacy.ts";

describe("privacy blur", () => {
  it("uses the session override when present, otherwise the default", () => {
    expect(initialBlur(true, null)).toBe(true);
    expect(initialBlur(true, false)).toBe(false);
    expect(initialBlur(false, true)).toBe(true);
  });

  it("round-trips the session flag", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    expect(readBlurSession(storage)).toBeNull();
    writeBlurSession(storage, true);
    expect(readBlurSession(storage)).toBe(true);
    writeBlurSession(storage, false);
    expect(readBlurSession(storage)).toBe(false);
  });
});
