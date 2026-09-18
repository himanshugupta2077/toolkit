import { describe, expect, it } from "vitest";
import { DESKTOP_NAV, DESKTOP_NAV_GROUPS, DESKTOP_SETUP, isDesktopNavActive } from "./layout.ts";

describe("desktop nav", () => {
  it("promotes Budget, Ledger, Emergency, Debt, and setup pages out of More", () => {
    expect(DESKTOP_NAV.map((row) => row.label)).toEqual([
      "Dashboard",
      "Budget",
      "Ledger",
      "Emergency",
      "Debt",
      "Wealth",
      "Invest",
      "Goals",
    ]);
    expect(DESKTOP_SETUP.map((row) => row.label)).toEqual([
      "Accounts",
      "Categories",
      "Settings",
    ]);
    expect(DESKTOP_NAV_GROUPS.map((row) => row.label)).toEqual([null, "Money", "Wealth"]);
  });

  it("keeps Wealth off Invest and Goals, and matches nested setup paths", () => {
    expect(isDesktopNavActive("/wealth", "/wealth")).toBe(true);
    expect(isDesktopNavActive("/wealth/allocate", "/wealth")).toBe(true);
    expect(isDesktopNavActive("/wealth/invest", "/wealth")).toBe(false);
    expect(isDesktopNavActive("/wealth/goals/g1", "/wealth/goals")).toBe(true);
    expect(isDesktopNavActive("/ledger/abc", "/ledger")).toBe(true);
    expect(isDesktopNavActive("/plan", "/plan")).toBe(true);
    expect(isDesktopNavActive("/emergency", "/emergency")).toBe(true);
    expect(isDesktopNavActive("/wealth/emergency", "/emergency")).toBe(true);
    expect(isDesktopNavActive("/wealth/emergency", "/wealth")).toBe(false);
    expect(isDesktopNavActive("/debt", "/debt")).toBe(true);
    expect(isDesktopNavActive("/more/accounts/acc_1/reconcile", "/more/accounts")).toBe(
      true,
    );
    expect(isDesktopNavActive("/more/settings", "/more/categories")).toBe(false);
    expect(isDesktopNavActive("/home/detailed", "/home")).toBe(true);
  });
});
