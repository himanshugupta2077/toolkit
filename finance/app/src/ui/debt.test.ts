import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import type { AccountBalanceRow } from "../api/store.ts";
import type { RecurringPlan } from "../engine/types.ts";
import {
  creditCardRows,
  creditDueTotal,
  loanAccountRows,
  loanEmiPlans,
  monthlyEmiTotal,
  totalDebt,
} from "./debt.ts";

const TODAY = "2026-09-06";

function account(
  partial: Pick<AccountBalanceRow, "id" | "name" | "group"> & Partial<AccountBalanceRow>,
): AccountBalanceRow {
  return {
    type: partial.group === "credit_card" || partial.group === "loan" ? "liability" : "asset",
    openingBalance: 0,
    openingDate: "2026-01-01",
    creditLimit: null,
    includeNetWorth: true,
    includeLiquid: false,
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
    balance: 0,
    available: null,
    utilisation: null,
    lastReconciledAt: null,
    daysSinceReconcile: null,
    ...partial,
  };
}

function plan(partial: Pick<RecurringPlan, "id" | "name" | "kind"> & Partial<RecurringPlan>): RecurringPlan {
  return {
    categoryId: "cat_emi",
    frequency: "monthly",
    intervalMonths: null,
    amount: rupeesToPaise(10_000),
    startDate: "2026-01-01",
    endDate: null,
    active: true,
    payFromAccountId: null,
    notes: "",
    autoPost: false,
    lastPostedMonth: null,
    ...partial,
  };
}

describe("debt lists", () => {
  it("sums credit due and loan balances, and keeps live EMIs", () => {
    const cards = creditCardRows([
      account({
        id: "cc1",
        name: "HDFC Credit Card",
        group: "credit_card",
        balance: rupeesToPaise(700),
      }),
      account({
        id: "cc_old",
        name: "Old card",
        group: "credit_card",
        isArchived: true,
        balance: rupeesToPaise(9_000),
      }),
      account({ id: "sav", name: "Savings", group: "savings", balance: rupeesToPaise(1_000) }),
    ]);
    const loans = loanAccountRows([
      account({
        id: "loan1",
        name: "Car loan",
        group: "loan",
        balance: rupeesToPaise(50_000),
      }),
    ]);
    expect(cards.map((row) => row.id)).toEqual(["cc1"]);
    expect(creditDueTotal(cards)).toBe(rupeesToPaise(700));
    expect(totalDebt(cards, loans)).toBe(rupeesToPaise(50_700));

    const emis = loanEmiPlans(
      [
        plan({ id: "emi1", name: "MacBook", kind: "loan_emi", amount: rupeesToPaise(38_200) }),
        plan({ id: "rent", name: "Rent", kind: "lifestyle" }),
        plan({ id: "old", name: "Ended EMI", kind: "loan_emi", endDate: "2026-08-01" }),
        plan({ id: "off", name: "Paused EMI", kind: "loan_emi", active: false }),
        plan({ id: "auto", name: "Auto EMI", kind: null, categoryId: "cat_emi" }),
      ],
      [{ id: "cat_emi", name: "EMIs" }],
      TODAY,
    );
    expect(emis.map((row) => row.name)).toEqual(["Auto EMI", "MacBook"]);
    expect(monthlyEmiTotal(emis)).toBe(rupeesToPaise(48_200));
  });
});
