import { describe, expect, it } from "vitest";
import {
  allocationLedgerType,
  destinationGroupsForBucket,
  findInvestmentCategory,
  suggestFromAccount,
  suggestToAccount,
} from "./allocate.ts";
import { DEFAULT_BUCKET_IDS } from "./waterfall.ts";
import { rupeesToPaise } from "./money.ts";
import type { Account, Category } from "./types.ts";

const OPENING = "2026-08-01";

function account(
  id: string,
  name: string,
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name,
    type: extra.type ?? "asset",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: true,
    includeLiquid: extra.includeLiquid ?? extra.group === "savings",
    group: extra.group ?? "savings",
    bucketId: extra.bucketId ?? null,
    statementDay: null,
    dueDay: null,
    isArchived: extra.isArchived ?? false,
    notes: "",
    virtualKind: extra.virtualKind ?? null,
    ...extra,
  };
}

describe("allocationLedgerType", () => {
  it("uses investment for FD and investment destinations, else transfer", () => {
    expect(allocationLedgerType({ group: "fd" })).toBe("investment");
    expect(allocationLedgerType({ group: "investment" })).toBe("investment");
    expect(allocationLedgerType({ group: "savings" })).toBe("transfer");
    expect(allocationLedgerType({ group: "cash" })).toBe("transfer");
  });
});

describe("destinationGroupsForBucket", () => {
  it("maps the default three buckets", () => {
    expect(destinationGroupsForBucket({ id: DEFAULT_BUCKET_IDS.emergencyFund, name: "Emergency Fund" })).toEqual([
      "fd",
    ]);
    expect(destinationGroupsForBucket({ id: DEFAULT_BUCKET_IDS.savingsBuffer, name: "Savings buffer" })).toEqual([
      "savings",
      "cash",
    ]);
    expect(destinationGroupsForBucket({ id: DEFAULT_BUCKET_IDS.investment, name: "Investment" })).toEqual([
      "investment",
      "fd",
    ]);
  });
});

describe("suggestFromAccount / suggestToAccount", () => {
  const hdfc = account("acc_hdfc", "HDFC Savings", { group: "savings", includeLiquid: true });
  const cash = account("acc_cash", "Cash", { group: "cash", includeLiquid: true });
  const fd = account("acc_fd", "FD", {
    group: "fd",
    includeLiquid: false,
    bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
  });
  const expense = account("acc_exp", "Expense", {
    type: "virtual",
    group: "virtual",
    includeLiquid: false,
    virtualKind: "expense",
  });

  it("prefers liquid HDFC as From and tagged FD as To for EF", () => {
    const balances = {
      acc_hdfc: rupeesToPaise(43_400),
      acc_cash: rupeesToPaise(100),
      acc_fd: 0,
    };
    const from = suggestFromAccount([hdfc, cash, fd, expense], balances, fd.id);
    const to = suggestToAccount(
      { id: DEFAULT_BUCKET_IDS.emergencyFund, name: "Emergency Fund" },
      [hdfc, cash, fd, expense],
      from?.id,
    );
    expect(from?.id).toBe("acc_hdfc");
    expect(to?.id).toBe("acc_fd");
  });

  it("skips archived and virtual accounts", () => {
    const archived = account("acc_old", "Old HDFC", {
      group: "savings",
      includeLiquid: true,
      isArchived: true,
    });
    const from = suggestFromAccount([archived, expense], { acc_old: rupeesToPaise(9_000) });
    expect(from).toBeNull();
  });
});

describe("findInvestmentCategory", () => {
  it("matches the Investment name and skips archived", () => {
    const cats: Category[] = [
      {
        id: "cat_g",
        name: "Groceries",
        group: "lifestyle",
        defaultInBudget: true,
        icon: null,
        isArchived: false,
        sort: 1,
      },
      {
        id: "cat_inv",
        name: "Investment",
        group: "investment",
        defaultInBudget: false,
        icon: null,
        isArchived: false,
        sort: 2,
      },
    ];
    expect(findInvestmentCategory(cats)?.id).toBe("cat_inv");
  });
});
