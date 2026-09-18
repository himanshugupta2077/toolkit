import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "./money.ts";
import { accountBalance } from "./balances.ts";
import {
  adjustmentLegs,
  canReconcileAccount,
  currentCycleStart,
  cycleSpends,
  nextStatementDate,
  findAdjustmentCounterpart,
  findReconciliationCategory,
  reconcileDifference,
  reconCheckedDate,
} from "./reconcile.ts";
import type { Account, Category, LedgerEntry } from "./types.ts";

const OPENING = "2026-08-01";

function asset(id: string, name: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    name,
    type: "asset",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: true,
    includeLiquid: true,
    group: "savings",
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
    ...extra,
  };
}

function liability(id: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    name: "HDFC Credit Card",
    type: "liability",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: rupeesToPaise(100_000),
    includeNetWorth: true,
    includeLiquid: false,
    group: "credit_card",
    bucketId: null,
    statementDay: 17,
    dueDay: 7,
    isArchived: false,
    notes: "",
    virtualKind: null,
    ...extra,
  };
}

function virtual(
  id: string,
  name: string,
  virtualKind: NonNullable<Account["virtualKind"]>,
): Account {
  return {
    id,
    name,
    type: "virtual",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: false,
    includeLiquid: false,
    group: "virtual",
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind,
  };
}

describe("reconcileDifference", () => {
  it("is actual minus calculated", () => {
    expect(reconcileDifference(rupeesToPaise(100), rupeesToPaise(100))).toBe(0);
    expect(reconcileDifference(rupeesToPaise(100), rupeesToPaise(250))).toBe(
      rupeesToPaise(150),
    );
    expect(reconcileDifference(rupeesToPaise(250), rupeesToPaise(100))).toBe(
      rupeesToPaise(-150),
    );
  });
});

describe("adjustmentLegs", () => {
  const hdfc = asset("acc_hdfc", "HDFC Savings");
  const card = liability("acc_cc");
  const ext = "acc_external";

  it("credits an asset when the bank number is higher", () => {
    const legs = adjustmentLegs(hdfc, rupeesToPaise(200), ext);
    expect(legs).toEqual({
      fromAccountId: ext,
      toAccountId: hdfc.id,
      amount: rupeesToPaise(200),
    });
    expect(
      accountBalance(hdfc, [
        { date: "2026-09-06", ...legs! },
      ]),
    ).toBe(rupeesToPaise(200));
  });

  it("debits an asset when the bank number is lower", () => {
    const hdfcOpen = asset("acc_hdfc", "HDFC Savings", {
      openingBalance: rupeesToPaise(500),
    });
    const legs = adjustmentLegs(hdfcOpen, rupeesToPaise(-200), ext);
    expect(legs).toEqual({
      fromAccountId: hdfcOpen.id,
      toAccountId: ext,
      amount: rupeesToPaise(200),
    });
    expect(
      accountBalance(hdfcOpen, [
        { date: "2026-09-06", ...legs! },
      ]),
    ).toBe(rupeesToPaise(300));
  });

  it("raises a card due when the statement due is higher", () => {
    const legs = adjustmentLegs(card, rupeesToPaise(80), ext);
    expect(legs).toEqual({
      fromAccountId: card.id,
      toAccountId: ext,
      amount: rupeesToPaise(80),
    });
    expect(
      accountBalance(card, [
        { date: "2026-09-06", ...legs! },
      ]),
    ).toBe(rupeesToPaise(80));
  });

  it("lowers a card due when the statement due is lower", () => {
    const cardOpen = liability("acc_cc", { openingBalance: rupeesToPaise(500) });
    const legs = adjustmentLegs(cardOpen, rupeesToPaise(-100), ext);
    expect(legs).toEqual({
      fromAccountId: ext,
      toAccountId: cardOpen.id,
      amount: rupeesToPaise(100),
    });
    expect(
      accountBalance(cardOpen, [
        { date: "2026-09-06", ...legs! },
      ]),
    ).toBe(rupeesToPaise(400));
  });

  it("is null when the gap is already 0", () => {
    expect(adjustmentLegs(hdfc, 0, ext)).toBeNull();
  });
});

describe("currentCycleStart", () => {
  it("falls back to the calendar month with no statement day", () => {
    expect(currentCycleStart("2026-09-06", null)).toBe("2026-09-01");
  });

  it("uses the previous statement date when today is before the day", () => {
    expect(currentCycleStart("2026-09-06", 17)).toBe("2026-08-17");
  });

  it("uses this month's statement date on and after that day", () => {
    expect(currentCycleStart("2026-09-17", 17)).toBe("2026-09-17");
    expect(currentCycleStart("2026-09-18", 17)).toBe("2026-09-17");
  });

  it("clamps day 31 in February", () => {
    expect(currentCycleStart("2026-03-02", 31)).toBe("2026-02-28");
  });
});

describe("nextStatementDate", () => {
  it("is null when there is no statement day", () => {
    expect(nextStatementDate("2026-09-07", null)).toBeNull();
    expect(nextStatementDate("2026-09-07", 0)).toBeNull();
  });

  it("uses this month when today is before the statement day", () => {
    expect(nextStatementDate("2026-09-07", 12)).toBe("2026-09-12");
    expect(nextStatementDate("2026-09-11", 12)).toBe("2026-09-12");
  });

  it("rolls to next month on and after the statement day", () => {
    expect(nextStatementDate("2026-09-12", 12)).toBe("2026-10-12");
    expect(nextStatementDate("2026-09-13", 12)).toBe("2026-10-12");
  });

  it("clamps day 31 in February", () => {
    expect(nextStatementDate("2026-01-20", 31)).toBe("2026-01-31");
    expect(nextStatementDate("2026-01-31", 31)).toBe("2026-02-28");
  });
});

describe("cycleSpends", () => {
  const rows: Pick<
    LedgerEntry,
    "date" | "amount" | "fromAccountId" | "toAccountId" | "type"
  >[] = [
    {
      date: "2026-08-16",
      amount: rupeesToPaise(10),
      fromAccountId: "acc_cc",
      toAccountId: "acc_exp",
      type: "expense",
    },
    {
      date: "2026-08-17",
      amount: rupeesToPaise(40),
      fromAccountId: "acc_cc",
      toAccountId: "acc_exp",
      type: "expense",
    },
    {
      date: "2026-09-01",
      amount: rupeesToPaise(25),
      fromAccountId: "acc_cc",
      toAccountId: "acc_exp",
      type: "expense",
    },
    {
      date: "2026-09-02",
      amount: rupeesToPaise(5),
      fromAccountId: "acc_exp",
      toAccountId: "acc_cc",
      type: "refund",
    },
  ];

  it("sums expenses from the account minus refunds, inside the cycle", () => {
    expect(cycleSpends("acc_cc", rows, "2026-08-17", "2026-09-06")).toBe(
      rupeesToPaise(60),
    );
  });
});

describe("catalog helpers", () => {
  it("finds live External and Reconciliation", () => {
    const accounts = [
      virtual("acc_expense", "Expense", "expense"),
      virtual("acc_external", "External", "external"),
    ];
    const categories: Category[] = [
      {
        id: "cat_recon",
        name: "Reconciliation",
        group: "system",
        defaultInBudget: false,
        icon: null,
        isArchived: false,
        sort: 1,
      },
    ];
    expect(findAdjustmentCounterpart(accounts)?.id).toBe("acc_external");
    expect(findReconciliationCategory(categories)?.id).toBe("cat_recon");
    expect(canReconcileAccount(accounts[1]!)).toBe(false);
    expect(canReconcileAccount(asset("acc_hdfc", "HDFC Savings"))).toBe(true);
  });

  it("reads YYYY-MM-DD from a datetime stamp", () => {
    expect(reconCheckedDate("2026-09-06T12:00:00.000Z")).toBe("2026-09-06");
  });
});
