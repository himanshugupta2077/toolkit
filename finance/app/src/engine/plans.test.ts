import { describe, expect, it } from "vitest";
import { type MonthLedgerEntry } from "./budget.ts";
import { rupeesToPaise } from "./money.ts";
import {
  committedEmiRemaining,
  nextRecurringDueDate,
  oneTimeInMonth,
  oneTimeWindow,
  recurringDue,
  recurringDueLines,
  recurringIsEnded,
  resolveRecurringKind,
  yearlyCommitments,
  type OneTimeWindowPlan,
  type RecurringDuePlan,
  type RecurringLinePlan,
} from "./plans.ts";
import type { Category, RecurringKind } from "./types.ts";

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

function rec(
  extra: Partial<RecurringDuePlan> & Pick<RecurringDuePlan, "amount" | "frequency">,
): RecurringDuePlan {
  return {
    categoryId: "cat_other",
    intervalMonths: null,
    startDate: "2026-08-01",
    endDate: null,
    active: true,
    kind: "lifestyle",
    ...extra,
  };
}

function oneTime(
  extra: Partial<OneTimeWindowPlan> & Pick<OneTimeWindowPlan, "expectedDate" | "amount">,
): OneTimeWindowPlan {
  return {
    status: "planned",
    ...extra,
  };
}

function tx(
  date: string,
  amountRupees: number,
  extra: Partial<MonthLedgerEntry> = {},
): MonthLedgerEntry {
  return {
    date,
    type: "expense",
    amount: rupeesToPaise(amountRupees),
    inBudget: false,
    categoryId: "cat_emi",
    ...extra,
  };
}

const rentCat = cat("cat_rent", "Rent", { group: "Housing", defaultInBudget: false });
const emiCat = cat("cat_emi", "EMIs", { group: "Loan", defaultInBudget: false });
const investCat = cat("cat_inv", "Investment", { group: "Investment", defaultInBudget: false });
const domainCat = cat("cat_domain", "Subscription - Software");
const otherCat = cat("cat_other", "Other");
const categories = [rentCat, emiCat, investCat, domainCat, otherCat];

const SEP = "2026-09";
const OCT = "2026-10";
const NOV = "2026-11";
const DEC = "2026-12";
const JAN = "2027-01";
const FEB = "2027-02";
const MAR = "2027-03";
/** Same as Phase 4: 6 Sep 2026. */
const TODAY = "2026-09-06";

/**
 * Cloned from Planned Expenses behaviour (not live xlsx numbers).
 * Yearly domain hits December only. SmartEMI runs through Feb 2027.
 * Ended/inactive rent is 0 after August.
 */
const smartEmi = rec({
  categoryId: emiCat.id,
  frequency: "monthly",
  amount: rupeesToPaise(38200),
  startDate: "2026-03-01",
  endDate: "2027-02-28",
  kind: "loan_emi",
});
const rentEnded = rec({
  categoryId: rentCat.id,
  frequency: "monthly",
  amount: rupeesToPaise(10800),
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  kind: "lifestyle",
});
const rentInactive = rec({
  categoryId: rentCat.id,
  frequency: "monthly",
  amount: rupeesToPaise(10800),
  startDate: "2026-08-01",
  endDate: null,
  active: false,
  kind: "lifestyle",
});
const domainYearly = rec({
  categoryId: domainCat.id,
  frequency: "yearly",
  amount: rupeesToPaise(1800),
  startDate: "2026-12-01",
  endDate: null,
  kind: "lifestyle",
});
const milk = rec({
  categoryId: otherCat.id,
  frequency: "monthly",
  amount: rupeesToPaise(25127),
  startDate: "2026-08-01",
  kind: "lifestyle",
});

const planned = [smartEmi, rentEnded, rentInactive, domainYearly, milk];

describe("resolveRecurringKind", () => {
  it("uses stored kind when present", () => {
    expect(resolveRecurringKind("loan_emi", "Rent")).toBe("loan_emi");
    expect(resolveRecurringKind("lifestyle", "EMIs")).toBe("lifestyle");
  });

  it("blank kind infers EMIs → loan_emi, Investment → investment, else lifestyle", () => {
    expect(resolveRecurringKind(null, "EMIs")).toBe("loan_emi");
    expect(resolveRecurringKind(null, "emis")).toBe("loan_emi");
    expect(resolveRecurringKind(null, "Investment")).toBe("investment");
    expect(resolveRecurringKind(null, "Rent")).toBe("lifestyle");
    expect(resolveRecurringKind(null, undefined)).toBe("lifestyle");
  });
});

describe("recurringDue from Planned Expenses behaviour", () => {
  it("yearly domain in December is 0 in September", () => {
    expect(recurringDue(SEP, "lifestyle", [domainYearly], categories)).toBe(0);
    expect(recurringDue(SEP, null, [domainYearly], categories)).toBe(0);
  });

  it("yearly domain counts the full amount in the anniversary month, never ÷12", () => {
    expect(recurringDue(DEC, "lifestyle", [domainYearly], categories)).toBe(
      rupeesToPaise(1800),
    );
    expect(recurringDue(DEC, "lifestyle", [domainYearly], categories)).not.toBe(
      rupeesToPaise(150),
    );
  });

  it("SmartEMI with end Feb 2027 is due Sep–Feb and 0 in March", () => {
    for (const month of [SEP, OCT, NOV, DEC, JAN, FEB]) {
      expect(recurringDue(month, "loan_emi", [smartEmi], categories)).toBe(
        rupeesToPaise(38200),
      );
    }
    expect(recurringDue(MAR, "loan_emi", [smartEmi], categories)).toBe(0);
  });

  it("inactive or ended rent is 0 after end", () => {
    expect(recurringDue(SEP, "lifestyle", [rentEnded], categories)).toBe(0);
    expect(recurringDue(SEP, "lifestyle", [rentInactive], categories)).toBe(0);
    expect(recurringDue("2026-08", "lifestyle", [rentEnded], categories)).toBe(
      rupeesToPaise(10800),
    );
  });

  it("sums this-month cash due by kind", () => {
    expect(recurringDue(SEP, "loan_emi", planned, categories)).toBe(rupeesToPaise(38200));
    expect(recurringDue(SEP, "lifestyle", planned, categories)).toBe(rupeesToPaise(25127));
    expect(recurringDue(SEP, "investment", planned, categories)).toBe(0);
    expect(recurringDue(SEP, null, planned, categories)).toBe(rupeesToPaise(63327));
  });

  it("December adds the yearly domain on top of monthly rows still running", () => {
    expect(recurringDue(DEC, null, planned, categories)).toBe(
      rupeesToPaise(38200 + 25127 + 1800),
    );
  });
});

describe("recurringDue start/end and kind", () => {
  it("monthly with blank start is due (sheet treats blank Start as already started)", () => {
    const spotify = rec({
      frequency: "monthly",
      amount: rupeesToPaise(119),
      startDate: null,
      kind: "lifestyle",
    });
    expect(recurringDue(SEP, "lifestyle", [spotify], categories)).toBe(rupeesToPaise(119));
  });

  it("yearly with blank start is 0", () => {
    const noStart = rec({
      frequency: "yearly",
      amount: rupeesToPaise(1800),
      startDate: null,
      kind: "lifestyle",
    });
    expect(recurringDue(DEC, "lifestyle", [noStart], categories)).toBe(0);
  });

  it("yearly does not count before the start year", () => {
    expect(recurringDue("2025-12", "lifestyle", [domainYearly], categories)).toBe(0);
  });

  it("blank kind on EMIs counts as loan_emi", () => {
    const inferred = rec({
      categoryId: emiCat.id,
      frequency: "monthly",
      amount: rupeesToPaise(5000),
      kind: null,
    });
    expect(recurringDue(SEP, "loan_emi", [inferred], categories)).toBe(rupeesToPaise(5000));
    expect(recurringDue(SEP, "lifestyle", [inferred], categories)).toBe(0);
  });

  it("end on any day of the month still counts that month", () => {
    const midMonthEnd = rec({
      frequency: "monthly",
      amount: rupeesToPaise(1000),
      startDate: "2026-09-01",
      endDate: "2026-09-06",
      kind: "lifestyle",
    });
    expect(recurringDue(SEP, "lifestyle", [midMonthEnd], categories)).toBe(
      rupeesToPaise(1000),
    );
    expect(recurringDue(OCT, "lifestyle", [midMonthEnd], categories)).toBe(0);
  });

  it("weekly counts occurrences in the month, not a smear", () => {
    // 2026-09-01 is a Tuesday; Tuesdays: 1, 8, 15, 22, 29 → 5 × ₹100.
    const weekly = rec({
      frequency: "weekly",
      amount: rupeesToPaise(100),
      startDate: "2026-09-01",
      kind: "lifestyle",
    });
    expect(recurringDue(SEP, "lifestyle", [weekly], categories)).toBe(rupeesToPaise(500));
  });

  it("custom_months hits every N months from start", () => {
    const everyThree = rec({
      frequency: "custom_months",
      intervalMonths: 3,
      amount: rupeesToPaise(900),
      startDate: "2026-09-01",
      kind: "lifestyle",
    });
    expect(recurringDue(SEP, "lifestyle", [everyThree], categories)).toBe(rupeesToPaise(900));
    expect(recurringDue(OCT, "lifestyle", [everyThree], categories)).toBe(0);
    expect(recurringDue(DEC, "lifestyle", [everyThree], categories)).toBe(rupeesToPaise(900));
  });

  it("rejects an invalid month", () => {
    expect(() => recurringDue("2026-13", null, [], categories)).toThrow(/year-month/);
  });
});

describe("oneTimeWindow", () => {
  const inWindow = oneTime({ expectedDate: "2026-09-20", amount: rupeesToPaise(7500) });
  const onToday = oneTime({ expectedDate: TODAY, amount: rupeesToPaise(100) });
  const onPlus30 = oneTime({ expectedDate: "2026-10-06", amount: rupeesToPaise(3000) });
  const plus31 = oneTime({ expectedDate: "2026-10-07", amount: rupeesToPaise(4000) });
  const past = oneTime({ expectedDate: "2026-08-01", amount: rupeesToPaise(5000) });
  const completed = oneTime({
    expectedDate: "2026-09-10",
    amount: rupeesToPaise(2000),
    status: "completed",
  });
  const cancelled = oneTime({
    expectedDate: "2026-09-12",
    amount: rupeesToPaise(1000),
    status: "cancelled",
  });
  const later90 = oneTime({ expectedDate: "2026-11-01", amount: rupeesToPaise(12000) });

  const rows = [inWindow, onToday, onPlus30, plus31, past, completed, cancelled, later90];

  it("includes Planned rows from today through today+days, inclusive", () => {
    expect(oneTimeWindow(30, TODAY, rows)).toBe(rupeesToPaise(7500 + 100 + 3000));
  });

  it("excludes Completed and Cancelled", () => {
    expect(oneTimeWindow(30, TODAY, [completed, cancelled, inWindow])).toBe(
      rupeesToPaise(7500),
    );
  });

  it("excludes past Planned and dates after the window", () => {
    expect(oneTimeWindow(30, TODAY, [past, plus31])).toBe(0);
  });

  it("90-day window includes later Planned rows still inside 90 days", () => {
    // 6 Sep + 90 = 5 Dec, so 1 Nov is in.
    expect(oneTimeWindow(90, TODAY, rows)).toBe(
      rupeesToPaise(7500 + 100 + 3000 + 4000 + 12000),
    );
  });

  it("rejects a negative window", () => {
    expect(() => oneTimeWindow(-1, TODAY, [])).toThrow(/non-negative/);
  });
});

describe("committedEmiRemaining", () => {
  it("is planned Loan/EMI minus ledger EMIs, floored at 0", () => {
    expect(committedEmiRemaining(SEP, planned, categories, [])).toBe(rupeesToPaise(38200));
    expect(
      committedEmiRemaining(SEP, planned, categories, [tx("2026-09-01", 20000)]),
    ).toBe(rupeesToPaise(18200));
    expect(
      committedEmiRemaining(SEP, planned, categories, [tx("2026-09-01", 38200)]),
    ).toBe(0);
    expect(
      committedEmiRemaining(SEP, planned, categories, [tx("2026-09-01", 40000)]),
    ).toBe(0);
  });

  it("ignores EMI ledger rows in other months", () => {
    expect(
      committedEmiRemaining(SEP, planned, categories, [tx("2026-08-31", 38200)]),
    ).toBe(rupeesToPaise(38200));
  });

  it("is 0 in March after SmartEMI ends, even with no ledger EMIs", () => {
    expect(committedEmiRemaining(MAR, planned, categories, [])).toBe(0);
  });
});

describe("recurringDueLines", () => {
  const named: RecurringLinePlan[] = [
    { ...smartEmi, id: "rec_smartemi", name: "MacBook SmartEMI" },
    { ...domainYearly, id: "rec_domain", name: "himanshu-gupta.com" },
    { ...milk, id: "rec_milk", name: "Lifestyle bundle" },
    { ...rentEnded, id: "rec_rent", name: "Rent (ended)" },
  ];

  it("lists which rows make up a kind in a month", () => {
    const loan = recurringDueLines(SEP, "loan_emi", named, categories);
    expect(loan).toEqual([
      {
        planId: "rec_smartemi",
        name: "MacBook SmartEMI",
        kind: "loan_emi",
        amount: rupeesToPaise(38200),
      },
    ]);
    const decLifestyle = recurringDueLines(DEC, "lifestyle", named, categories);
    expect(decLifestyle.map((row) => row.planId).sort()).toEqual(
      ["rec_domain", "rec_milk"].sort(),
    );
  });

  it("omits rows that are not due", () => {
    const sepLifestyle = recurringDueLines(SEP, "lifestyle", named, categories);
    expect(sepLifestyle.map((row) => row.planId)).toEqual(["rec_milk"]);
  });
});

describe("oneTimeInMonth", () => {
  it("sums Planned rows whose expected date falls in the month", () => {
    const rows = [
      oneTime({ expectedDate: "2026-09-20", amount: rupeesToPaise(7500) }),
      oneTime({ expectedDate: "2026-10-04", amount: rupeesToPaise(1000) }),
      oneTime({
        expectedDate: "2026-09-10",
        amount: rupeesToPaise(2000),
        status: "completed",
      }),
    ];
    expect(oneTimeInMonth(SEP, rows)).toBe(rupeesToPaise(7500));
    expect(oneTimeInMonth(OCT, rows)).toBe(rupeesToPaise(1000));
  });

  it("fromDate keeps only the remaining days of the current month", () => {
    const rows = [
      oneTime({ expectedDate: "2026-09-01", amount: rupeesToPaise(100) }),
      oneTime({ expectedDate: "2026-09-06", amount: rupeesToPaise(200) }),
      oneTime({ expectedDate: "2026-09-30", amount: rupeesToPaise(300) }),
    ];
    expect(oneTimeInMonth(SEP, rows, TODAY)).toBe(rupeesToPaise(500));
  });
});

describe("recurringDue kind filter isolation", () => {
  it("does not mix loan_emi into lifestyle", () => {
    const kinds: RecurringKind[] = ["loan_emi", "lifestyle", "investment"];
    for (const kind of kinds) {
      const only = rec({
        frequency: "monthly",
        amount: rupeesToPaise(1),
        kind,
        categoryId: otherCat.id,
      });
      expect(recurringDue(SEP, kind, [only], categories)).toBe(rupeesToPaise(1));
      for (const other of kinds.filter((k) => k !== kind)) {
        expect(recurringDue(SEP, other, [only], categories)).toBe(0);
      }
    }
  });
});

describe("next due, ended, yearly commitments", () => {
  it("treats end before today as ended, still due in the end month", () => {
    expect(recurringIsEnded("2026-08-31", TODAY)).toBe(true);
    expect(recurringIsEnded("2026-09-06", TODAY)).toBe(false);
    expect(recurringIsEnded(null, TODAY)).toBe(false);
  });

  it("next monthly due is this month's start day when it is still ahead", () => {
    const rent = rec({
      frequency: "monthly",
      amount: rupeesToPaise(10800),
      startDate: "2026-08-15",
      kind: "lifestyle",
    });
    expect(nextRecurringDueDate(rent, TODAY)).toBe("2026-09-15");
  });

  it("next monthly due rolls to next month when the day has passed", () => {
    const first = rec({
      frequency: "monthly",
      amount: rupeesToPaise(100),
      startDate: "2026-08-01",
      kind: "lifestyle",
    });
    expect(nextRecurringDueDate(first, TODAY)).toBe("2026-10-01");
  });

  it("yearly next due is the anniversary, not a smear", () => {
    expect(nextRecurringDueDate(domainYearly, TODAY)).toBe("2026-12-01");
    expect(nextRecurringDueDate(domainYearly, "2026-12-02")).toBe("2027-12-01");
  });

  it("inactive and ended plans have no next due", () => {
    expect(nextRecurringDueDate(rentInactive, TODAY)).toBeNull();
    expect(nextRecurringDueDate(rentEnded, TODAY)).toBeNull();
  });

  it("weekly next due is the next occurrence on or after today", () => {
    const weekly = rec({
      frequency: "weekly",
      amount: rupeesToPaise(100),
      startDate: "2026-09-01",
      kind: "lifestyle",
    });
    expect(nextRecurringDueDate(weekly, TODAY)).toBe("2026-09-08");
  });

  it("yearly commitments sum active yearly amounts, not ÷12", () => {
    expect(yearlyCommitments(TODAY, planned)).toBe(rupeesToPaise(1800));
    expect(yearlyCommitments(TODAY, [rentInactive, milk])).toBe(0);
  });
});
