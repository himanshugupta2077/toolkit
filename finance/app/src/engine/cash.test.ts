import { describe, expect, it } from "vitest";
import {
  expectedInflowsIfReceived,
  forecast,
  freeToAllocate,
  nextMonthEstimate,
  projectedLiquid,
  type CashLedgerEntry,
  type ExpectedInflowLike,
  type FreeCashBooks,
} from "./cash.ts";
import { rupeesToPaise } from "./money.ts";
import type { RecurringLinePlan } from "./plans.ts";
import type { Account, Category, RecurringKind } from "./types.ts";

const OPENING = "2026-08-01";
const SEP = "2026-09";
const OCT = "2026-10";
const DEC = "2026-12";
const FEB = "2027-02";
/** Same as Phases 4–5. Snapshot recipe is the frozen early-Sep 2026 sheet. */
const TODAY = "2026-09-06";

const CAP = rupeesToPaise(31000);
const LIQUID = rupeesToPaise(25031.25);
const BUDGET_SPENT = rupeesToPaise(26401.04);
const BUDGET_REMAINING = rupeesToPaise(4598.96);
const HDFC_CC = rupeesToPaise(702.16);
const ICICI_CC = rupeesToPaise(328.04);
const CC_DUE = rupeesToPaise(1030.2);
const SMART_EMI = rupeesToPaise(38200);
const ONE_TIME_30D = rupeesToPaise(7500);
const COMMITTED = rupeesToPaise(46730.2);
const FREE = rupeesToPaise(-26297.91);
const SHEET_SALARY = rupeesToPaise(83000);
const SETTINGS_SALARY = rupeesToPaise(140000);
const LEDGER_INCOME = rupeesToPaise(83167);
const LIFESTYLE = rupeesToPaise(25127);
const DOMAIN = rupeesToPaise(1800);
const EST_SHEET_SALARY = rupeesToPaise(-12497.91);

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

function asset(
  id: string,
  name: string,
  group: Account["group"],
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name,
    type: "asset",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: true,
    includeLiquid: group === "savings" || group === "cash",
    group,
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
    ...extra,
  };
}

function card(id: string, name: string, due: number): Account {
  return {
    id,
    name,
    type: "liability",
    openingBalance: due,
    openingDate: OPENING,
    creditLimit: rupeesToPaise(150000),
    includeNetWorth: true,
    includeLiquid: false,
    group: "credit_card",
    bucketId: null,
    statementDay: 1,
    dueDay: 15,
    isArchived: false,
    notes: "",
    virtualKind: null,
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

function rec(
  extra: Partial<RecurringLinePlan> &
    Pick<RecurringLinePlan, "id" | "name" | "amount" | "frequency">,
): RecurringLinePlan {
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

function tx(
  extra: Partial<CashLedgerEntry> & Pick<CashLedgerEntry, "date" | "amount">,
): CashLedgerEntry {
  return {
    type: "expense",
    inBudget: true,
    categoryId: "cat_other",
    fromAccountId: "hdfc_sav",
    toAccountId: "expense",
    ...extra,
  };
}

const rentCat = cat("cat_rent", "Rent", { group: "Housing", defaultInBudget: false });
const emiCat = cat("cat_emi", "EMIs", { group: "Loan", defaultInBudget: false });
const investCat = cat("cat_inv", "Investment", { group: "Investment", defaultInBudget: false });
const domainCat = cat("cat_domain", "Subscription - Software");
const otherCat = cat("cat_other", "Other");
const salaryCat = cat("cat_sal", "Salary", { group: "Income", defaultInBudget: false });
const categories = [rentCat, emiCat, investCat, domainCat, otherCat, salaryCat];

const smartEmi = rec({
  id: "rec_smartemi",
  name: "MacBook SmartEMI",
  categoryId: emiCat.id,
  frequency: "monthly",
  amount: SMART_EMI,
  startDate: "2026-03-01",
  endDate: "2027-02-28",
  kind: "loan_emi",
});
const rentEnded = rec({
  id: "rec_rent_ended",
  name: "Rent (ended)",
  categoryId: rentCat.id,
  frequency: "monthly",
  amount: rupeesToPaise(10800),
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  kind: "lifestyle",
});
const domainYearly = rec({
  id: "rec_domain",
  name: "himanshu-gupta.com",
  categoryId: domainCat.id,
  frequency: "yearly",
  amount: DOMAIN,
  startDate: "2026-12-01",
  kind: "lifestyle",
});
const milk = rec({
  id: "rec_milk",
  name: "Lifestyle bundle",
  categoryId: otherCat.id,
  frequency: "monthly",
  amount: LIFESTYLE,
  kind: "lifestyle",
});

const hdfcSav = asset("hdfc_sav", "HDFC Savings", "savings", {
  // Spend is already in the snapshot liquid; opening is pre-spend so the
  // in-budget expense can exist for remaining without double-counting cash.
  openingBalance: LIQUID + BUDGET_SPENT,
});
const hdfcCc = card("hdfc_cc", "HDFC Credit Card", HDFC_CC);
const iciciCc = card("icici_cc", "ICICI Credit Card", ICICI_CC);
const expenseAcct = virtual("expense", "Expense", "expense");
const employer = virtual("employer", "Employer", "employer");

const snapshotExpense = tx({
  date: "2026-09-02",
  amount: BUDGET_SPENT,
});

const hydToDeh = {
  expectedDate: "2026-09-20" as const,
  amount: ONE_TIME_30D,
  status: "planned" as const,
};

function books(extra: Partial<FreeCashBooks> = {}): FreeCashBooks {
  return {
    today: TODAY,
    accounts: [hdfcSav, hdfcCc, iciciCc, expenseAcct, employer],
    entries: [snapshotExpense],
    monthBudgets: [{ month: SEP, cap: CAP }],
    defaultBudgetCap: CAP,
    monthlySalary: SETTINGS_SALARY,
    recurringPlans: [smartEmi, rentEnded, domainYearly, milk],
    categories,
    oneTimePlans: [hydToDeh],
    inflows: [],
    assumeInflows: false,
    ...extra,
  };
}

describe("freeToAllocate frozen Sep-2026 fixture", () => {
  it("matches the committed-cash recipe and is negative", () => {
    const result = freeToAllocate(books());
    expect(result.liquid).toBe(LIQUID);
    expect(result.budgetRemaining).toBe(BUDGET_REMAINING);
    expect(result.budgetReserved).toBe(BUDGET_REMAINING);
    expect(result.ccDue).toBe(CC_DUE);
    expect(result.remainingEmi).toBe(SMART_EMI);
    expect(result.oneTime30d).toBe(ONE_TIME_30D);
    expect(result.committed).toBe(COMMITTED);
    expect(result.committed).toBe(CC_DUE + SMART_EMI + ONE_TIME_30D);
    expect(result.free).toBe(FREE);
    expect(result.free).toBeLessThan(0);
    expect(result.free).toBe(LIQUID - BUDGET_REMAINING - COMMITTED);
  });

  it("does not subtract lifestyle recurring that sits inside the cap", () => {
    const withLifestyle = freeToAllocate(books());
    const withoutLifestyle = freeToAllocate(
      books({ recurringPlans: [smartEmi, rentEnded, domainYearly] }),
    );
    expect(withLifestyle.free).toBe(withoutLifestyle.free);
    expect(withLifestyle.committed).toBe(withoutLifestyle.committed);
  });

  it("excludes Completed one-time and past Planned from the 30d window", () => {
    const result = freeToAllocate(
      books({
        oneTimePlans: [
          hydToDeh,
          { expectedDate: "2026-09-10", amount: rupeesToPaise(2000), status: "completed" },
          { expectedDate: "2026-08-01", amount: rupeesToPaise(9000), status: "planned" },
        ],
      }),
    );
    expect(result.oneTime30d).toBe(ONE_TIME_30D);
  });

  it("lists expected inflows but does not add them to free", () => {
    const inflow: ExpectedInflowLike = {
      expectedDate: "2026-09-15",
      amount: rupeesToPaise(31600),
      isLiquid: true,
      status: "expected",
    };
    const result = freeToAllocate(books({ inflows: [inflow] }));
    expect(result.expectedInflowsIfReceived).toBe(rupeesToPaise(31600));
    expect(result.free).toBe(FREE);
  });

  it("breakdown lines are liquid minus the four reserves", () => {
    const { breakdown, free } = freeToAllocate(books());
    const signed = breakdown.reduce((sum, line) => sum + line.sign * line.amount, 0);
    expect(signed).toBe(free);
    expect(breakdown.map((line) => line.key)).toEqual([
      "liquid",
      "budget_reserved",
      "cc_due",
      "remaining_emi",
      "one_time_30d",
    ]);
  });
});

describe("freeToAllocate reserved budget", () => {
  it("floors reserved at 0 when the month is overspent", () => {
    const overspend = tx({
      date: "2026-09-03",
      amount: rupeesToPaise(10000),
      fromAccountId: "hdfc_cc",
    });
    const result = freeToAllocate(books({ entries: [snapshotExpense, overspend] }));
    expect(result.budgetRemaining).toBe(BUDGET_REMAINING - rupeesToPaise(10000));
    expect(result.budgetRemaining).toBeLessThan(0);
    expect(result.budgetReserved).toBe(0);
    expect(result.free).toBe(result.liquid - result.committed);
  });
});

describe("nextMonthEstimate", () => {
  it("matches the sheet when salary is the Sep-2026 Configuration value", () => {
    const est = nextMonthEstimate(books({ monthlySalary: SHEET_SALARY }));
    expect(est.nextMonth).toBe(OCT);
    expect(est.nextEmi).toBe(SMART_EMI);
    expect(est.nextCap).toBe(CAP);
    expect(est.salary).toBe(SHEET_SALARY);
    expect(est.estimated).toBe(EST_SHEET_SALARY);
    expect(est.estimated).toBe(FREE - SMART_EMI + SHEET_SALARY - CAP);
  });

  it("uses settings salary, not last ledger income", () => {
    const income = tx({
      date: "2026-09-01",
      type: "income",
      amount: LEDGER_INCOME,
      inBudget: false,
      categoryId: salaryCat.id,
      fromAccountId: "employer",
      toAccountId: "hdfc_sav",
    });
    // Income would inflate liquid; offset by spending it from savings on a
    // non-budget transfer so free cash stays the snapshot recipe.
    const offset = tx({
      date: "2026-09-01",
      type: "transfer",
      amount: LEDGER_INCOME,
      inBudget: false,
      fromAccountId: "hdfc_sav",
      toAccountId: "expense",
    });
    const est = nextMonthEstimate(
      books({ monthlySalary: SETTINGS_SALARY, entries: [snapshotExpense, income, offset] }),
    );
    const ifLedgerIncome = FREE - SMART_EMI + LEDGER_INCOME - CAP;
    expect(est.salary).toBe(SETTINGS_SALARY);
    expect(est.estimated).toBe(FREE - SMART_EMI + SETTINGS_SALARY - CAP);
    expect(est.estimated).not.toBe(ifLedgerIncome);
    expect(est.freeToday).toBe(FREE);
  });

  it("does not subtract CC due again", () => {
    const est = nextMonthEstimate(books());
    expect(est.breakdown.map((line) => line.key)).toEqual([
      "free_today",
      "next_emi",
      "salary",
      "next_cap",
    ]);
    expect(est.breakdown.some((line) => line.key === "next_emi")).toBe(true);
    expect(est.estimated).toBe(est.freeToday - est.nextEmi + est.salary - est.nextCap);
  });
});

describe("forecast", () => {
  it("starts at the current month and covers six months through Feb 2027", () => {
    const result = forecast(books());
    expect(result.startMonth).toBe(SEP);
    expect(result.months.map((m) => m.month)).toEqual([
      SEP,
      OCT,
      "2026-11",
      DEC,
      "2027-01",
      FEB,
    ]);
    expect(result.assumeInflows).toBe(false);
  });

  it("splits cash due by kind and lists the contributing rows", () => {
    const result = forecast(books());
    const sep = result.months[0];
    expect(sep.loanEmi).toBe(SMART_EMI);
    expect(sep.lifestyle).toBe(LIFESTYLE);
    expect(sep.investment).toBe(0);
    expect(sep.total).toBe(SMART_EMI + LIFESTYLE);
    expect(sep.lines.map((line) => line.name).sort()).toEqual(
      ["Lifestyle bundle", "MacBook SmartEMI"].sort(),
    );
    expect(sep.lines.find((line) => line.kind === "loan_emi")?.planId).toBe("rec_smartemi");

    const dec = result.months.find((m) => m.month === DEC);
    if (!dec) throw new Error("missing December");
    expect(dec.lifestyle).toBe(LIFESTYLE + DOMAIN);
    expect(dec.lines.some((line) => line.planId === "rec_domain")).toBe(true);
    expect(dec.lines.some((line) => line.name === "himanshu-gupta.com")).toBe(true);

    expect(result.totals.loanEmi).toBe(SMART_EMI * 6);
    expect(result.totals.lifestyle).toBe(LIFESTYLE * 6 + DOMAIN);
  });

  it("omits inactive or ended rows from the month card lines", () => {
    const sep = forecast(books()).months[0];
    expect(sep.lines.some((line) => line.planId === "rec_rent_ended")).toBe(false);
  });

  it("does not add salary in the current month and uses remaining budget + EMI", () => {
    const sep = forecast(books()).months[0];
    expect(sep.flow.salary).toBe(0);
    expect(sep.flow.cap).toBe(BUDGET_REMAINING);
    expect(sep.flow.loanEmi).toBe(SMART_EMI);
    expect(sep.oneTime).toBe(ONE_TIME_30D);
    expect(sep.projectedLiquid).toBe(LIQUID - BUDGET_REMAINING - SMART_EMI - ONE_TIME_30D);
  });

  it("does not subtract lifestyle from projected liquid (cap already covers it)", () => {
    const sep = forecast(books()).months[0];
    const ifLifestyleSubtracted =
      LIQUID - BUDGET_REMAINING - SMART_EMI - ONE_TIME_30D - LIFESTYLE;
    expect(sep.projectedLiquid).not.toBe(ifLifestyleSubtracted);
    expect(sep.lifestyle).toBe(LIFESTYLE);
  });

  it("adds settings salary and full next-month cap from October on", () => {
    const result = forecast(books());
    const sep = result.months[0];
    const oct = result.months[1];
    expect(oct.flow.salary).toBe(SETTINGS_SALARY);
    expect(oct.flow.cap).toBe(CAP);
    expect(oct.flow.loanEmi).toBe(SMART_EMI);
    expect(oct.projectedLiquid).toBe(
      projectedLiquid(sep.projectedLiquid, oct.flow),
    );
    expect(oct.projectedLiquid).toBe(
      sep.projectedLiquid + SETTINGS_SALARY - CAP - SMART_EMI,
    );
  });

  it("keeps expected inflows out of projected liquid unless the toggle is on", () => {
    const inflow: ExpectedInflowLike = {
      expectedDate: "2026-10-10",
      amount: rupeesToPaise(50000),
      isLiquid: true,
      status: "expected",
    };
    const off = forecast(books({ inflows: [inflow], assumeInflows: false }));
    const on = forecast(books({ inflows: [inflow], assumeInflows: true }));
    expect(off.months[1].inflows).toBe(0);
    expect(on.months[1].inflows).toBe(rupeesToPaise(50000));
    expect(on.months[1].projectedLiquid).toBe(
      off.months[1].projectedLiquid + rupeesToPaise(50000),
    );
  });

  it("ignores non-liquid and received inflows even when the toggle is on", () => {
    const rows: ExpectedInflowLike[] = [
      {
        expectedDate: "2026-10-10",
        amount: rupeesToPaise(50000),
        isLiquid: false,
        status: "expected",
      },
      {
        expectedDate: "2026-10-12",
        amount: rupeesToPaise(10000),
        isLiquid: true,
        status: "received",
      },
    ];
    const result = forecast(books({ inflows: rows, assumeInflows: true }));
    expect(result.months[1].inflows).toBe(0);
  });

  it("rejects a non-positive month count", () => {
    expect(() => forecast(books(), 0)).toThrow(/positive integer/);
  });
});

describe("expectedInflowsIfReceived", () => {
  it("sums upcoming liquid expected rows only", () => {
    const rows: ExpectedInflowLike[] = [
      {
        expectedDate: "2026-09-06",
        amount: rupeesToPaise(100),
        isLiquid: true,
        status: "expected",
      },
      {
        expectedDate: "2026-09-05",
        amount: rupeesToPaise(50),
        isLiquid: true,
        status: "expected",
      },
      {
        expectedDate: "2026-10-01",
        amount: rupeesToPaise(200),
        isLiquid: false,
        status: "expected",
      },
      {
        expectedDate: "2026-10-01",
        amount: rupeesToPaise(300),
        isLiquid: true,
        status: "dropped",
      },
    ];
    expect(expectedInflowsIfReceived(TODAY, rows)).toBe(rupeesToPaise(100));
  });
});

describe("projectedLiquid", () => {
  it("is previous + salary − cap − loan − investment − one-time + inflows", () => {
    expect(
      projectedLiquid(rupeesToPaise(10000), {
        salary: rupeesToPaise(140000),
        cap: rupeesToPaise(31000),
        loanEmi: rupeesToPaise(38200),
        investment: rupeesToPaise(0),
        oneTime: rupeesToPaise(7500),
        inflows: rupeesToPaise(0),
      }),
    ).toBe(rupeesToPaise(10000 + 140000 - 31000 - 38200 - 7500));
  });
});

describe("kind isolation in forecast lines", () => {
  it("does not tag a lifestyle row as loan_emi", () => {
    const kinds: RecurringKind[] = ["loan_emi", "lifestyle", "investment"];
    const sep = forecast(books()).months[0];
    for (const kind of kinds) {
      for (const line of sep.lines.filter((row) => row.kind === kind)) {
        if (kind === "loan_emi") expect(line.planId).toBe("rec_smartemi");
        if (kind === "lifestyle") expect(line.planId).not.toBe("rec_smartemi");
      }
    }
  });
});
