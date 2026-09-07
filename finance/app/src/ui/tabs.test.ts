import { describe, expect, it } from "vitest";
import { activeTabIndex, adjacentTabPath, isTabActive, TABS } from "./tabs.ts";

describe("tabs", () => {
  it("keeps Wealth off Invest and Goals paths", () => {
    expect(isTabActive("/wealth", "/wealth")).toBe(true);
    expect(isTabActive("/wealth/allocate", "/wealth")).toBe(true);
    expect(isTabActive("/wealth/invest", "/wealth")).toBe(false);
    expect(isTabActive("/wealth/goals/g1", "/wealth")).toBe(false);
    expect(isTabActive("/ledger/abc", "/more")).toBe(true);
    expect(isTabActive("/plan", "/more")).toBe(true);
  });

  it("swipes to the next and previous tab roots", () => {
    expect(TABS.map((tab) => tab.label)).toEqual(["Home", "Wealth", "Invest", "Goals", "More"]);
    expect(activeTabIndex("/home")).toBe(0);
    expect(adjacentTabPath("/home", 1)).toBe("/wealth");
    expect(adjacentTabPath("/home", -1)).toBeNull();
    expect(adjacentTabPath("/wealth/goals", 1)).toBe("/more");
    expect(adjacentTabPath("/more/accounts", -1)).toBe("/wealth/goals");
  });
});
