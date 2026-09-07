import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import type { Account } from "../engine/types.ts";
import {
  accountFlags,
  differenceHint,
  formatBalanceHero,
  formatUtilisation,
  groupAccountRows,
  lastReconciledLabel,
  searchAmountQuery,
  type AccountBalanceRow,
} from "./accounts.ts";

const OPENING = "2026-08-01";

function row(
  id: string,
  name: string,
  group: Account["group"],
  extra: Partial<AccountBalanceRow> = {},
): AccountBalanceRow {
  const type: Account["type"] =
    group === "credit_card" ? "liability" : group === "virtual" ? "virtual" : "asset";
  return {
    id,
    name,
    type,
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: type !== "virtual",
    includeLiquid: group === "savings" || group === "cash",
    group,
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: group === "virtual" ? "external" : null,
    balance: 0,
    available: null,
    utilisation: null,
    lastReconciledAt: null,
    daysSinceReconcile: null,
    ...extra,
  };
}

describe("groupAccountRows", () => {
  it("orders Savings then Cash then Credit card, Virtual last", () => {
    const sections = groupAccountRows([
      row("v", "External", "virtual"),
      row("cc", "HDFC Credit Card", "credit_card"),
      row("s2", "ICICI Savings", "savings"),
      row("s1", "HDFC Savings", "savings"),
      row("c", "Cash", "cash"),
    ]);
    expect(sections.map((s) => s.group)).toEqual([
      "savings",
      "cash",
      "credit_card",
      "virtual",
    ]);
    expect(sections[0]?.accounts.map((a) => a.name)).toEqual([
      "HDFC Savings",
      "ICICI Savings",
    ]);
  });

  it("puts archived rows after live ones in the same group", () => {
    const sections = groupAccountRows([
      row("old", "Old Wallet", "cash", { isArchived: true }),
      row("new", "Cash", "cash"),
    ]);
    expect(sections[0]?.accounts.map((a) => a.id)).toEqual(["new", "old"]);
  });
});

describe("lastReconciledLabel", () => {
  it("is stale when never checked or older than 14 days", () => {
    expect(lastReconciledLabel(null, "2026-09-06")).toEqual({
      text: "Never reconciled",
      stale: true,
    });
    expect(lastReconciledLabel("2026-08-16", "2026-09-06")).toEqual({
      text: "21 d ago",
      stale: true,
    });
    expect(lastReconciledLabel("2026-09-01", "2026-09-06")).toEqual({
      text: "5 d ago",
      stale: false,
    });
    expect(lastReconciledLabel("2026-09-06", "2026-09-06")).toEqual({
      text: "Today",
      stale: false,
    });
  });
});

describe("display helpers", () => {
  it("labels liability as Due and formats utilisation", () => {
    expect(formatBalanceHero({ type: "liability", group: "credit_card" }, rupeesToPaise(702.16)).label).toBe(
      "Due",
    );
    expect(formatUtilisation(0.023)).toBe("2%");
    expect(accountFlags({ includeNetWorth: true, includeLiquid: true })).toEqual([
      "NW",
      "Liquid",
    ]);
  });

  it("explains the live difference", () => {
    expect(differenceHint(0)).toMatch(/stamp today/i);
    expect(differenceHint(rupeesToPaise(200))).toContain("₹200.00");
    expect(searchAmountQuery(rupeesToPaise(200))).toBe("200");
    expect(searchAmountQuery(rupeesToPaise(12.5))).toBe("12.50");
  });
});
