import { describe, expect, it } from "vitest";
import {
  bumpVisitCount,
  isIosSafari,
  isStandaloneDisplay,
  shouldOfferInstall,
} from "./install.ts";

describe("PWA install offer", () => {
  it("shows on the second visit, not when already standalone or dismissed", () => {
    expect(shouldOfferInstall({ standalone: false, visitCount: 1, dismissed: false })).toBe(false);
    expect(shouldOfferInstall({ standalone: false, visitCount: 2, dismissed: false })).toBe(true);
    expect(shouldOfferInstall({ standalone: true, visitCount: 5, dismissed: false })).toBe(false);
    expect(shouldOfferInstall({ standalone: false, visitCount: 5, dismissed: true })).toBe(false);
  });

  it("counts visits and detects iOS / standalone", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    expect(bumpVisitCount(storage)).toBe(1);
    expect(bumpVisitCount(storage)).toBe(2);
    expect(isStandaloneDisplay({ navigatorStandalone: true })).toBe(true);
    expect(
      isStandaloneDisplay({ matchMedia: (q) => ({ matches: q.includes("standalone") }) }),
    ).toBe(true);
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(true);
  });
});
