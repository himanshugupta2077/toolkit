import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import {
  defaultHoldingName,
  emergencyHoldings,
  emergencyIncludeLiquid,
  emergencyTotal,
  groupEmergencyHoldings,
  isEmergencyKind,
  kindForGroup,
} from "./emergency.ts";

describe("emergency holdings", () => {
  it("joins bucket rows with account groups and totals them", () => {
    const rows = emergencyHoldings(
      {
        accounts: [
          { id: "acc_sav", name: "HDFC Savings", balance: rupeesToPaise(12_000) },
          { id: "acc_fd", name: "FD1", balance: rupeesToPaise(20_000) },
          { id: "acc_liq", name: "Liquid fund", balance: rupeesToPaise(8_000) },
        ],
      },
      [
        { id: "acc_sav", group: "savings" },
        { id: "acc_fd", group: "fd" },
        { id: "acc_liq", group: "investment" },
      ],
    );
    expect(emergencyTotal(rows)).toBe(rupeesToPaise(40_000));
    expect(groupEmergencyHoldings(rows).map((section) => section.label)).toEqual([
      "Savings",
      "FD",
      "Invested",
    ]);
  });

  it("puts unknown groups in Other and suggests FD names", () => {
    expect(kindForGroup("cash")).toBe("other");
    expect(isEmergencyKind("investment")).toBe(true);
    expect(isEmergencyKind("loan")).toBe(false);
    expect(defaultHoldingName("fd", [{ name: "FD" }])).toBe("FD1");
    expect(defaultHoldingName("savings", [])).toBe("");
    expect(emergencyIncludeLiquid("savings")).toBe(true);
    expect(emergencyIncludeLiquid("fd")).toBe(false);
    const rows = emergencyHoldings(
      { accounts: [{ id: "acc_cash", name: "Cash tin", balance: 100 }] },
      [{ id: "acc_cash", group: "cash" }],
    );
    expect(groupEmergencyHoldings(rows)[0]?.kind).toBe("other");
  });
});
