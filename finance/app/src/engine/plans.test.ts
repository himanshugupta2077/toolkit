import { describe, expect, it } from "vitest";
import { accountBalance } from "./balances.ts";
import { type MonthLedgerEntry } from "./budget.ts";
import { rupeesToPaise } from "./money.ts";
import {
  committedEmiRemaining,
  estimatedNextStatement,
  nextRecurringDueDate,
  oneTimeInMonth,
  oneTimeWindow,
  recurringDue,
  recurringDueLines,
  recurringIsEnded,
  resolveRecurringKind,
  upcomingBills,
  yearlyCommitments,
  type CardEmiLedgerEntry,
  type OneTimeWindowPlan,
  type RecurringDuePlan,
  type RecurringLinePlan,
  type UpcomingOneTimePlan,
} from "./plans.ts";
import type { Account, Category, RecurringKind } from "./types.ts";

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
    payFromAccountId: null,
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

function recLine(
  extra: Partial<RecurringLinePlan> &
    Pick<RecurringDuePlan, "amount" | "frequency"> & { name: string },
): RecurringLinePlan {
  return {
    id: extra.id ?? extra.name,
    categoryId: extra.categoryId ?? "cat_other",
    intervalMonths: extra.intervalMonths ?? null,
    startDate: extra.startDate ?? "2026-08-01",
    endDate: extra.endDate ?? null,
    active: extra.active ?? true,
    kind: extra.kind ?? "lifestyle",
    payFromAccountId: extra.payFromAccountId ?? null,
    ...extra,
  };
}

function upcomingOne(
  extra: Partial<UpcomingOneTimePlan> &
    Pick<UpcomingOneTimePlan, "expectedDate" | "amount"> & { name: string },
): UpcomingOneTimePlan {
  return {
    id: extra.id ?? extra.name,
    status: extra.status ?? "planned",
    kind: extra.kind === undefined ? "bill" : extra.kind,
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

  it("bill counts as lifestyle for forecast", () => {
    expect(resolveRecurringKind("bill", "Rent")).toBe("lifestyle");
    expect(resolveRecurringKind("bill", "EMIs")).toBe("lifestyle");
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
    expect(
      recurringDue(
        SEP,
        "lifestyle",
        [rec({ amount: rupeesToPaise(10800), frequency: "monthly", kind: "bill" })],
        categories,
      ),
    ).toBe(rupeesToPaise(10800));
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

describe("upcomingBills first instance", () => {
  it("lists each live recurring plan once, on the next due on or after today", () => {
    const rent = recLine({
      name: "Rent",
      frequency: "monthly",
      amount: rupeesToPaise(10800),
      startDate: "2026-08-01",
      kind: "bill",
    });
    const milkBill = recLine({
      name: "Milk",
      frequency: "monthly",
      amount: rupeesToPaise(2500),
      startDate: "2026-08-10",
      kind: "bill",
    });
    const bills = upcomingBills(TODAY, [rent, milkBill], [], categories);
    expect(bills.map((row) => `${row.name}:${row.dueDate}`)).toEqual([
      "Milk:2026-09-10",
      "Rent:2026-10-01",
    ]);
    expect(bills.filter((row) => row.name === "Rent")).toHaveLength(1);
  });

  it("keeps a monthly due that is still today", () => {
    const rent = recLine({
      name: "Rent",
      frequency: "monthly",
      amount: rupeesToPaise(10800),
      startDate: "2026-08-06",
      kind: "bill",
    });
    const bills = upcomingBills(TODAY, [rent], [], categories);
    expect(bills).toEqual([
      expect.objectContaining({
        name: "Rent",
        dueDate: TODAY,
        source: "recurring",
        frequency: "monthly",
        kind: "bill",
        amount: rupeesToPaise(10800),
      }),
    ]);
  });

  it("includes a yearly bill months away, not smeared into this month", () => {
    const insurance = recLine({
      id: "rec_domain",
      name: "Scooty insurance",
      categoryId: domainCat.id,
      frequency: "yearly",
      amount: rupeesToPaise(1800),
      startDate: "2026-12-01",
      kind: "bill",
    });
    const bills = upcomingBills(TODAY, [insurance], [], categories);
    expect(bills).toEqual([
      expect.objectContaining({
        name: "Scooty insurance",
        dueDate: "2026-12-01",
        frequency: "yearly",
        kind: "bill",
        amount: rupeesToPaise(1800),
      }),
    ]);
  });

  it("includes planned one-time bills from today onward and skips completed or past", () => {
    const bills = upcomingBills(
      TODAY,
      [],
      [
        upcomingOne({
          name: "Flights",
          expectedDate: "2026-09-20",
          amount: rupeesToPaise(7500),
        }),
        upcomingOne({
          name: "Past dentist",
          expectedDate: "2026-09-01",
          amount: rupeesToPaise(500),
        }),
        upcomingOne({
          name: "Done",
          expectedDate: "2026-10-01",
          amount: rupeesToPaise(100),
          status: "completed",
        }),
      ],
      categories,
    );
    expect(bills.map((row) => row.name)).toEqual(["Flights"]);
    expect(bills[0]?.source).toBe("one_time");
    expect(bills[0]?.frequency).toBeNull();
  });

  it("includes every live plan kind, not only Bill", () => {
    const bills = upcomingBills(
      TODAY,
      [
        recLine({
          name: "SIP",
          frequency: "monthly",
          amount: rupeesToPaise(5000),
          kind: "investment",
        }),
        recLine({
          name: "Milk",
          frequency: "monthly",
          amount: rupeesToPaise(2500),
          kind: "lifestyle",
        }),
        recLine({
          name: "Rent",
          frequency: "monthly",
          amount: rupeesToPaise(10800),
          kind: "bill",
        }),
        recLine({
          id: "rec_emi",
          name: "SmartEMI",
          categoryId: emiCat.id,
          frequency: "monthly",
          amount: rupeesToPaise(38200),
          kind: "loan_emi",
        }),
        recLine({
          id: "rec_auto_sip",
          name: "Auto SIP",
          categoryId: investCat.id,
          frequency: "monthly",
          amount: rupeesToPaise(2000),
          kind: null,
        }),
      ],
      [
        upcomingOne({
          name: "Flights",
          expectedDate: "2026-09-20",
          amount: rupeesToPaise(7500),
          kind: null,
        }),
        upcomingOne({
          name: "Passport",
          expectedDate: "2026-09-15",
          amount: rupeesToPaise(1500),
          kind: "bill",
        }),
      ],
      categories,
    );
    expect(bills.map((row) => `${row.name}:${row.kind}:${row.dueDate}`)).toEqual([
      "Passport:bill:2026-09-15",
      "Flights:null:2026-09-20",
      "Auto SIP:investment:2026-10-01",
      "Milk:lifestyle:2026-10-01",
      "Rent:bill:2026-10-01",
      "SIP:investment:2026-10-01",
      "SmartEMI:loan_emi:2026-10-01",
    ]);
  });

  it("drops inactive and ended recurring rows", () => {
    const bills = upcomingBills(
      TODAY,
      [
        recLine({
          name: "Ended rent",
          frequency: "monthly",
          amount: rupeesToPaise(10800),
          startDate: "2026-08-01",
          endDate: "2026-08-31",
          kind: "bill",
        }),
        recLine({
          name: "Off",
          frequency: "monthly",
          amount: rupeesToPaise(100),
          active: false,
          kind: "bill",
        }),
      ],
      [],
      categories,
    );
    expect(bills).toEqual([]);
  });
});

describe("estimatedNextStatement", () => {
  const CARD = "acc_hdfc_credit_card";
  const OTHER = "acc_other_card";
  const AS_OF = "2026-09-07";
  const DUE = rupeesToPaise(8840.29);
  const EMI = rupeesToPaise(38200);

  const card: Account = {
    id: CARD,
    name: "HDFC Credit Card",
    type: "liability",
    openingBalance: DUE,
    openingDate: "2026-08-01",
    creditLimit: rupeesToPaise(150000),
    includeNetWorth: true,
    includeLiquid: false,
    group: "credit_card",
    bucketId: null,
    statementDay: 12,
    dueDay: 7,
    isArchived: false,
    notes: "",
    virtualKind: null,
  };

  const onCard = rec({
    categoryId: emiCat.id,
    frequency: "monthly",
    amount: EMI,
    startDate: "2026-09-01",
    kind: "loan_emi",
    payFromAccountId: CARD,
  });

  function emiRow(
    date: string,
    fromAccountId: string,
    amountRupees = 38200,
  ): CardEmiLedgerEntry {
    return {
      date,
      amount: rupeesToPaise(amountRupees),
      fromAccountId,
      categoryId: emiCat.id,
    };
  }

  it("adds unposted this-card EMI in the statement window without folding it into due", () => {
    const result = estimatedNextStatement(AS_OF, 12, CARD, DUE, [onCard], categories, []);
    expect(result.due).toBe(DUE);
    expect(result.due).toBe(accountBalance(card, []));
    expect(result.unpostedEmi).toBe(EMI);
    expect(result.estimated).toBe(DUE + EMI);
    expect(result.nextStatementDate).toBe("2026-09-12");
  });

  it("equals due after this-card EMI posts in the window", () => {
    const result = estimatedNextStatement(AS_OF, 12, CARD, DUE, [onCard], categories, [
      emiRow("2026-09-01", CARD),
    ]);
    expect(result.due).toBe(DUE);
    expect(result.unpostedEmi).toBe(0);
    expect(result.estimated).toBe(DUE);
  });

  it("uses this calendar month on this card when statementDay is null", () => {
    const open = estimatedNextStatement(AS_OF, null, CARD, DUE, [onCard], categories, []);
    expect(open.nextStatementDate).toBeNull();
    expect(open.unpostedEmi).toBe(EMI);
    expect(open.estimated).toBe(DUE + EMI);

    const postedThisMonth = estimatedNextStatement(AS_OF, null, CARD, DUE, [onCard], categories, [
      emiRow("2026-09-01", CARD),
    ]);
    expect(postedThisMonth.unpostedEmi).toBe(0);
    expect(postedThisMonth.estimated).toBe(DUE);

    const postedLastMonth = estimatedNextStatement(AS_OF, null, CARD, DUE, [onCard], categories, [
      emiRow("2026-08-01", CARD),
    ]);
    expect(postedLastMonth.unpostedEmi).toBe(EMI);
  });

  it("does not net a statement-day posting against the following cycle's EMI", () => {
    const onStmt = estimatedNextStatement("2026-09-12", 12, CARD, DUE, [onCard], categories, [
      emiRow("2026-09-12", CARD),
    ]);
    expect(onStmt.nextStatementDate).toBe("2026-10-12");
    expect(onStmt.unpostedEmi).toBe(EMI);
    expect(onStmt.estimated).toBe(DUE + EMI);

    const afterStmt = estimatedNextStatement(
      "2026-09-13",
      12,
      CARD,
      DUE,
      [onCard],
      categories,
      [emiRow("2026-09-12", CARD)],
    );
    expect(afterStmt.nextStatementDate).toBe("2026-10-12");
    expect(afterStmt.unpostedEmi).toBe(EMI);
    expect(afterStmt.estimated).toBe(DUE + EMI);
  });

  it("does not treat last statement's EMI posting as this window's payment", () => {
    const result = estimatedNextStatement(AS_OF, 12, CARD, DUE, [onCard], categories, [
      emiRow("2026-08-12", CARD),
    ]);
    expect(result.unpostedEmi).toBe(EMI);
    expect(result.estimated).toBe(DUE + EMI);
  });

  it("includes an EMI that falls on the next statement date", () => {
    const onTwelfth = rec({
      categoryId: emiCat.id,
      frequency: "monthly",
      amount: EMI,
      startDate: "2026-08-12",
      kind: "loan_emi",
      payFromAccountId: CARD,
    });
    const result = estimatedNextStatement(AS_OF, 12, CARD, DUE, [onTwelfth], categories, []);
    expect(result.unpostedEmi).toBe(EMI);
  });

  it("excludes an occurrence after the next statement date", () => {
    const late = rec({
      categoryId: emiCat.id,
      frequency: "monthly",
      amount: EMI,
      startDate: "2026-09-15",
      kind: "loan_emi",
      payFromAccountId: CARD,
    });
    const beforeStmt = estimatedNextStatement(AS_OF, 12, CARD, DUE, [late], categories, []);
    expect(beforeStmt.unpostedEmi).toBe(0);

    const afterStmt = estimatedNextStatement(
      "2026-09-12",
      12,
      CARD,
      DUE,
      [late],
      categories,
      [],
    );
    expect(afterStmt.unpostedEmi).toBe(EMI);
    expect(afterStmt.nextStatementDate).toBe("2026-10-12");
  });

  it("excludes loan_emi paid from another account", () => {
    const other = rec({
      categoryId: emiCat.id,
      frequency: "monthly",
      amount: EMI,
      startDate: "2026-09-01",
      kind: "loan_emi",
      payFromAccountId: OTHER,
    });
    const unassigned = rec({
      categoryId: emiCat.id,
      frequency: "monthly",
      amount: EMI,
      startDate: "2026-09-01",
      kind: "loan_emi",
      payFromAccountId: null,
    });
    const result = estimatedNextStatement(
      AS_OF,
      12,
      CARD,
      DUE,
      [other, unassigned],
      categories,
      [emiRow("2026-09-01", OTHER)],
    );
    expect(result.due).toBe(DUE);
    expect(result.unpostedEmi).toBe(0);
    expect(result.estimated).toBe(DUE);
  });
});
