import { describe, expect, it } from "vitest";
import {
  budgetPace,
  budgetSpendByCategory,
  monthSummary,
  resolveBudgetCap,
  type MonthLedgerEntry,
} from "./budget.ts";
import { rupeesToPaise } from "./money.ts";
import type { Category } from "./types.ts";

function cat(
  id: string,
  name: string,
  extra: Partial<Category> = {},
): Category {
  return {
    id,
    name,
    group: "Lifestyle",
    defaultInBudget: true,
    icon: null,
    isArchived: false,
    sort: 0,
    ...extra,
  };
}

function tx(
  date: string,
  type: MonthLedgerEntry["type"],
  amountRupees: number,
  extra: Partial<MonthLedgerEntry> = {},
): MonthLedgerEntry {
  return {
    date,
    type,
    amount: rupeesToPaise(amountRupees),
    inBudget: type === "expense",
    categoryId: "cat_other",
    ...extra,
  };
}

const groceries = cat("cat_groc", "Groceries - Physical");
const rent = cat("cat_rent", "Rent", {
  group: "Housing",
  defaultInBudget: false,
});
const emis = cat("cat_emi", "EMIs", {
  group: "Loan",
  defaultInBudget: false,
});
const salary = cat("cat_sal", "Salary", {
  group: "Income",
  defaultInBudget: false,
});
const sip = cat("cat_sip", "SIP", { group: "Investment", defaultInBudget: false });
const ccPay = cat("cat_cc", "Credit Card Payment", { defaultInBudget: false });
const refund = cat("cat_ref", "Refund / Reimbursement");
const other = cat("cat_other", "Other");

const categories = [groceries, rent, emis, salary, sip, ccPay, refund, other];

const SEP = "2026-09";
const CAP = rupeesToPaise(31000);
/** 6 Sep 2026: 30-day month, day 6, elapsed 20%, 25 days left. */
const TODAY = "2026-09-06";

describe("budgetPace empty month", () => {
  it("remaining equals cap and is not an error", () => {
    const pace = budgetPace(SEP, [], CAP, TODAY);
    expect(pace.spent).toBe(0);
    expect(pace.remaining).toBe(CAP);
    expect(pace.cap).toBe(CAP);
    expect(pace.daysInMonth).toBe(30);
    expect(pace.dayOfMonth).toBe(6);
    expect(pace.daysLeft).toBe(25);
    expect(pace.safePerDay).toBe(rupeesToPaise(1240));
    expect(pace.usedPct).toBe(0);
    expect(pace.elapsedPct).toBe(0.2);
    expect(pace.band).toBe("on_track");
  });
});

describe("budgetPace remaining and safe/day", () => {
  it("matches known cap and spends by paise", () => {
    const entries = [
      tx("2026-09-01", "expense", 4000, { categoryId: groceries.id }),
      tx("2026-09-03", "expense", 2200, { categoryId: groceries.id }),
      tx("2026-08-31", "expense", 9999, { categoryId: groceries.id }),
    ];
    const pace = budgetPace(SEP, entries, CAP, TODAY);
    // 31,000 − 6,200 = 24,800; 24,800 / 25 days = 992
    expect(pace.spent).toBe(rupeesToPaise(6200));
    expect(pace.remaining).toBe(rupeesToPaise(24800));
    expect(pace.safePerDay).toBe(rupeesToPaise(992));
    expect(pace.usedPct).toBe(0.2);
    expect(pace.band).toBe("on_track");
  });

  it("nets in-budget refunds against spent (sheet B8)", () => {
    const entries = [
      tx("2026-09-01", "expense", 8000, { categoryId: groceries.id }),
      tx("2026-09-04", "refund", 500, {
        inBudget: true,
        categoryId: refund.id,
      }),
    ];
    const pace = budgetPace(SEP, entries, CAP, TODAY);
    expect(pace.spent).toBe(rupeesToPaise(7500));
    expect(pace.remaining).toBe(rupeesToPaise(23500));
  });

  it("ignores non-budget expenses and other types in spent", () => {
    const entries = [
      tx("2026-09-01", "expense", 10800, {
        inBudget: false,
        categoryId: rent.id,
      }),
      tx("2026-09-01", "income", 83167, {
        inBudget: false,
        categoryId: salary.id,
      }),
      tx("2026-09-02", "investment", 20000, {
        inBudget: false,
        categoryId: sip.id,
      }),
      tx("2026-09-03", "cc_payment", 1000, {
        inBudget: false,
        categoryId: ccPay.id,
      }),
      tx("2026-09-04", "expense", 100, { categoryId: groceries.id }),
    ];
    const pace = budgetPace(SEP, entries, CAP, TODAY);
    expect(pace.spent).toBe(rupeesToPaise(100));
    expect(pace.remaining).toBe(rupeesToPaise(30900));
  });

  it("floors leftover paise on safe/day", () => {
    // 100 paise remaining, 3 days left → 33 paise/day
    const entries = [tx("2026-09-01", "expense", 30999)];
    const pace = budgetPace(SEP, entries, CAP, "2026-09-28");
    expect(pace.remaining).toBe(100);
    expect(pace.daysLeft).toBe(3);
    expect(pace.safePerDay).toBe(33);
  });

  it("safe/day is 0 when remaining is negative", () => {
    const entries = [tx("2026-09-01", "expense", 40000)];
    const pace = budgetPace(SEP, entries, CAP, TODAY);
    expect(pace.remaining).toBe(rupeesToPaise(-9000));
    expect(pace.safePerDay).toBe(0);
  });

  it("used % is 0 when cap is 0 (sheet IF(B6=0,0,B8/B6))", () => {
    const entries = [tx("2026-09-01", "expense", 100)];
    const pace = budgetPace(SEP, entries, 0, TODAY);
    expect(pace.usedPct).toBe(0);
    expect(pace.remaining).toBe(rupeesToPaise(-100));
    expect(pace.band).toBe("on_track");
  });
});

describe("budgetPace bands", () => {
  it("used % <= elapsed % is on track", () => {
    // elapsed 20%; 6,200 / 31,000 = 20%
    const entries = [tx("2026-09-01", "expense", 6200)];
    expect(budgetPace(SEP, entries, CAP, TODAY).band).toBe("on_track");
  });

  it("one paise over elapsed % is watch", () => {
    const entries = [tx("2026-09-01", "expense", 6200, { amount: rupeesToPaise(6200) + 1 })];
    const pace = budgetPace(SEP, entries, CAP, TODAY);
    expect(pace.usedPct).toBeGreaterThan(0.2);
    expect(pace.usedPct).toBeLessThanOrEqual(0.3);
    expect(pace.band).toBe("watch");
  });

  it("used % exactly elapsed % + 10pp is watch", () => {
    // 30% used, elapsed 20%
    const entries = [tx("2026-09-01", "expense", 9300)];
    const pace = budgetPace(SEP, entries, CAP, TODAY);
    expect(pace.usedPct).toBe(0.3);
    expect(pace.band).toBe("watch");
  });

  it("used % beyond elapsed % + 10pp is over", () => {
    const entries = [
      tx("2026-09-01", "expense", 9300, { amount: rupeesToPaise(9300) + 1 }),
    ];
    const pace = budgetPace(SEP, entries, CAP, TODAY);
    expect(pace.usedPct).toBeGreaterThan(0.3);
    expect(pace.band).toBe("over");
  });
});

describe("budgetPace calendar", () => {
  it("last day of the month has 1 day left and 100% elapsed", () => {
    const pace = budgetPace(SEP, [], CAP, "2026-09-30");
    expect(pace.dayOfMonth).toBe(30);
    expect(pace.daysLeft).toBe(1);
    expect(pace.elapsedPct).toBe(1);
    expect(pace.safePerDay).toBe(CAP);
  });

  it("past month is fully elapsed with 0 days left", () => {
    const pace = budgetPace(SEP, [tx("2026-09-01", "expense", 1000)], CAP, "2026-10-01");
    expect(pace.dayOfMonth).toBe(30);
    expect(pace.daysLeft).toBe(0);
    expect(pace.elapsedPct).toBe(1);
    expect(pace.safePerDay).toBe(0);
    expect(pace.spent).toBe(rupeesToPaise(1000));
    expect(pace.remaining).toBe(rupeesToPaise(30000));
  });

  it("future month has 0 elapsed and a full month of days left", () => {
    const pace = budgetPace("2026-10", [], CAP, TODAY);
    expect(pace.dayOfMonth).toBe(0);
    expect(pace.daysInMonth).toBe(31);
    expect(pace.daysLeft).toBe(31);
    expect(pace.elapsedPct).toBe(0);
    expect(pace.band).toBe("on_track");
  });

  it("uses the real length of February", () => {
    const pace = budgetPace("2024-02", [], CAP, "2024-02-29");
    expect(pace.daysInMonth).toBe(29);
    expect(pace.daysLeft).toBe(1);
    expect(pace.elapsedPct).toBe(1);
  });

  it("rejects an invalid month or today", () => {
    expect(() => budgetPace("2026-13", [], CAP, TODAY)).toThrow(/year-month/);
    expect(() => budgetPace(SEP, [], CAP, "2026-09-31")).toThrow(/today/);
  });
});

describe("resolveBudgetCap", () => {
  it("uses the month row when present, otherwise the default", () => {
    const budgets = [
      { month: "2026-08", cap: rupeesToPaise(10000) },
      { month: "2026-09", cap: rupeesToPaise(31000) },
    ];
    expect(resolveBudgetCap("2026-09", budgets, rupeesToPaise(5000))).toBe(
      rupeesToPaise(31000),
    );
    expect(resolveBudgetCap("2026-10", budgets, rupeesToPaise(5000))).toBe(
      rupeesToPaise(5000),
    );
  });
});

describe("monthSummary", () => {
  /**
   * Income 50,000
   * Budget groceries 8,000
   * Non-budget rent 10,800 + EMI 2,000
   * Investment 5,000
   * CC payment 3,000 (not in est. savings)
   * est. savings = 50,000 − 8,000 − 12,800 − 5,000 = 24,200
   */
  const entries: MonthLedgerEntry[] = [
    tx("2026-09-01", "income", 50000, {
      inBudget: false,
      categoryId: salary.id,
    }),
    tx("2026-09-02", "expense", 8000, { categoryId: groceries.id }),
    tx("2026-09-03", "expense", 10800, {
      inBudget: false,
      categoryId: rent.id,
    }),
    tx("2026-09-04", "expense", 2000, {
      inBudget: false,
      categoryId: emis.id,
    }),
    tx("2026-09-05", "investment", 5000, {
      inBudget: false,
      categoryId: sip.id,
    }),
    tx("2026-09-06", "cc_payment", 3000, {
      inBudget: false,
      categoryId: ccPay.id,
    }),
    tx("2026-08-15", "income", 99999, {
      inBudget: false,
      categoryId: salary.id,
    }),
  ];

  it("sums income, non-budget, investments, EMIs, rent, CC payments", () => {
    const summary = monthSummary(SEP, entries, categories);
    expect(summary.income).toBe(rupeesToPaise(50000));
    expect(summary.budgetSpent).toBe(rupeesToPaise(8000));
    expect(summary.nonBudgetExp).toBe(rupeesToPaise(12800));
    expect(summary.investments).toBe(rupeesToPaise(5000));
    expect(summary.emis).toBe(rupeesToPaise(2000));
    expect(summary.rent).toBe(rupeesToPaise(10800));
    expect(summary.ccPayments).toBe(rupeesToPaise(3000));
  });

  it("does not subtract rent or EMIs twice from est. savings", () => {
    const summary = monthSummary(SEP, entries, categories);
    expect(summary.estSavings).toBe(rupeesToPaise(24200));
  });

  it("still displays rent/EMIs when they already sit inside budget spent", () => {
    const inBudgetHousing = [
      tx("2026-09-01", "income", 50000, {
        inBudget: false,
        categoryId: salary.id,
      }),
      tx("2026-09-03", "expense", 10800, {
        inBudget: true,
        categoryId: rent.id,
      }),
      tx("2026-09-04", "expense", 2000, {
        inBudget: true,
        categoryId: emis.id,
      }),
    ];
    const summary = monthSummary(SEP, inBudgetHousing, categories);
    expect(summary.budgetSpent).toBe(rupeesToPaise(12800));
    expect(summary.nonBudgetExp).toBe(0);
    expect(summary.rent).toBe(rupeesToPaise(10800));
    expect(summary.emis).toBe(rupeesToPaise(2000));
    expect(summary.estSavings).toBe(rupeesToPaise(37200));
  });

  it("empty month is zeros, not an error", () => {
    const summary = monthSummary(SEP, [], categories);
    expect(summary).toEqual({
      month: SEP,
      income: 0,
      budgetSpent: 0,
      nonBudgetExp: 0,
      investments: 0,
      emis: 0,
      rent: 0,
      ccPayments: 0,
      estSavings: 0,
    });
  });

  it("matches EMI/Rent by category name, case-insensitive", () => {
    const alt = [cat("cat_emi2", "emis"), cat("cat_rent2", "RENT")];
    const rows = [
      tx("2026-09-01", "expense", 100, {
        inBudget: false,
        categoryId: "cat_emi2",
      }),
      tx("2026-09-01", "expense", 200, {
        inBudget: false,
        categoryId: "cat_rent2",
      }),
    ];
    const summary = monthSummary(SEP, rows, alt);
    expect(summary.emis).toBe(rupeesToPaise(100));
    expect(summary.rent).toBe(rupeesToPaise(200));
  });
});

describe("budgetSpendByCategory", () => {
  it("nets in-budget refunds and sorts largest first", () => {
    const eating = cat("cat_eat", "Eating outside");
    const rows = budgetSpendByCategory(
      SEP,
      [
        tx("2026-09-01", "expense", 800, { categoryId: groceries.id }),
        tx("2026-09-02", "expense", 400, { categoryId: eating.id }),
        tx("2026-09-03", "refund", 100, {
          inBudget: true,
          categoryId: eating.id,
        }),
        tx("2026-09-04", "expense", 50, {
          inBudget: false,
          categoryId: rent.id,
        }),
        tx("2026-08-01", "expense", 999, { categoryId: groceries.id }),
      ],
      [...categories, eating],
    );
    expect(rows).toEqual([
      { categoryId: groceries.id, name: groceries.name, spent: rupeesToPaise(800) },
      { categoryId: eating.id, name: eating.name, spent: rupeesToPaise(300) },
    ]);
  });
});

