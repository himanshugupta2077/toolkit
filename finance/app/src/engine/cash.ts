import {
  computeBalances,
  type BalanceEntry,
} from "./balances.ts";
import {
  budgetPace,
  resolveBudgetCap,
  type MonthLedgerEntry,
} from "./budget.ts";
import {
  addMonths,
  isIsoDate,
  isYearMonth,
  yearMonthFromIsoDate,
  type IsoDate,
  type YearMonth,
} from "./dates.ts";
import { isPaise, ZERO_PAISE, type Paise } from "./money.ts";
import {
  committedEmiRemaining,
  oneTimeInMonth,
  oneTimeWindow,
  recurringDue,
  recurringDueLines,
  type RecurringDueLine,
  type RecurringLinePlan,
  type OneTimeWindowPlan,
} from "./plans.ts";
import type {
  Account,
  Category,
  ExpectedInflow,
  MonthBudget,
} from "./types.ts";

const ONE_TIME_FREE_CASH_DAYS = 30;
const DEFAULT_FORECAST_MONTHS = 6;

/** Ledger fields free cash / forecast need. Extra fields are allowed. */
export type CashLedgerEntry = BalanceEntry & MonthLedgerEntry;

export type CashCategory = Pick<Category, "id" | "name">;

export type ExpectedInflowLike = Pick<
  ExpectedInflow,
  "expectedDate" | "amount" | "isLiquid" | "status"
>;

export type FreeCashBooks = {
  today: IsoDate;
  accounts: readonly Account[];
  entries: readonly CashLedgerEntry[];
  monthBudgets: readonly Pick<MonthBudget, "month" | "cap">[];
  defaultBudgetCap: Paise;
  /** Settings monthly salary — never last ledger income. */
  monthlySalary: Paise;
  recurringPlans: readonly RecurringLinePlan[];
  categories: readonly CashCategory[];
  oneTimePlans: readonly OneTimeWindowPlan[];
  inflows?: readonly ExpectedInflowLike[];
  /** Default off. Expected inflows stay out of free cash either way. */
  assumeInflows?: boolean;
};

export type FreeCashBreakdownKey =
  | "liquid"
  | "budget_reserved"
  | "cc_due"
  | "remaining_emi"
  | "one_time_30d";

export type SignedBreakdownLine<K extends string = string> = {
  key: K;
  label: string;
  /** +1 added, −1 subtracted. */
  sign: 1 | -1;
  amount: Paise;
};

export type FreeToAllocate = {
  month: YearMonth;
  today: IsoDate;
  liquid: Paise;
  budgetRemaining: Paise;
  /** max(0, budget remaining). Overspend does not create a negative reserve. */
  budgetReserved: Paise;
  ccDue: Paise;
  remainingEmi: Paise;
  oneTime30d: Paise;
  committed: Paise;
  /** Can be negative. */
  free: Paise;
  breakdown: readonly SignedBreakdownLine<FreeCashBreakdownKey>[];
  /**
   * Liquid expected inflows with date ≥ today. Shown grey on Home; not in `free`.
   */
  expectedInflowsIfReceived: Paise;
};

export type NextMonthBreakdownKey =
  | "free_today"
  | "next_emi"
  | "salary"
  | "next_cap";

export type NextMonthEstimate = {
  today: IsoDate;
  nextMonth: YearMonth;
  freeToday: Paise;
  nextEmi: Paise;
  salary: Paise;
  nextCap: Paise;
  /** Can be negative. CC is already inside `freeToday` — not subtracted again. */
  estimated: Paise;
  breakdown: readonly SignedBreakdownLine<NextMonthBreakdownKey>[];
};

export type LiquidFlow = {
  salary: Paise;
  cap: Paise;
  loanEmi: Paise;
  investment: Paise;
  oneTime: Paise;
  inflows: Paise;
};

export type ForecastMonth = {
  month: YearMonth;
  loanEmi: Paise;
  lifestyle: Paise;
  investment: Paise;
  total: Paise;
  /** Active plans with cash due this month — Forecast "which rows make up a kind". */
  lines: readonly RecurringDueLine[];
  oneTime: Paise;
  inflows: Paise;
  flow: LiquidFlow;
  projectedLiquid: Paise;
};

export type Forecast = {
  today: IsoDate;
  startMonth: YearMonth;
  assumeInflows: boolean;
  months: readonly ForecastMonth[];
  totals: {
    loanEmi: Paise;
    lifestyle: Paise;
    investment: Paise;
    total: Paise;
  };
};

function requireYearMonth(month: YearMonth): YearMonth {
  if (!isYearMonth(month)) {
    throw new Error(`invalid year-month: ${month}`);
  }
  return month;
}

function requireIsoDate(date: IsoDate, label: string): IsoDate {
  if (!isIsoDate(date)) {
    throw new Error(`invalid ${label} date: ${date}`);
  }
  return date;
}

function requirePaise(value: Paise, label: string): Paise {
  if (!isPaise(value)) {
    throw new Error(`${label} must be integer paise`);
  }
  return value;
}

function requireMonthCount(months: number): number {
  if (!Number.isInteger(months) || months < 1) {
    throw new Error("forecast months must be a positive integer");
  }
  return months;
}

/**
 * Expected inflows that would hit liquid if they arrived.
 * Received / dropped / non-liquid / past dates are excluded.
 */
export function expectedInflowsIfReceived(
  today: IsoDate,
  inflows: readonly ExpectedInflowLike[],
): Paise {
  const asOf = requireIsoDate(today, "today");
  let total: Paise = ZERO_PAISE;
  for (const row of inflows) {
    requirePaise(row.amount, "inflow amount");
    if (row.status !== "expected") continue;
    if (!row.isLiquid) continue;
    const expected = requireIsoDate(row.expectedDate, "expected");
    if (expected >= asOf) total += row.amount;
  }
  return total;
}

function inflowsInMonth(
  month: YearMonth,
  today: IsoDate,
  inflows: readonly ExpectedInflowLike[],
  assume: boolean,
): Paise {
  if (!assume) return ZERO_PAISE;
  const ym = requireYearMonth(month);
  const current = yearMonthFromIsoDate(today);
  const fromDate = ym === current ? today : undefined;
  const startHint = fromDate;
  let total: Paise = ZERO_PAISE;
  for (const row of inflows) {
    requirePaise(row.amount, "inflow amount");
    if (row.status !== "expected") continue;
    if (!row.isLiquid) continue;
    const expected = requireIsoDate(row.expectedDate, "expected");
    if (yearMonthFromIsoDate(expected) !== ym) continue;
    if (startHint && expected < startHint) continue;
    total += row.amount;
  }
  return total;
}

/**
 * Running projected liquid. Lifestyle recurring is not subtracted — it sits
 * inside the budget cap (same double-count rule as free cash).
 */
export function projectedLiquid(previous: Paise, flow: LiquidFlow): Paise {
  requirePaise(previous, "previous liquid");
  requirePaise(flow.salary, "salary");
  requirePaise(flow.cap, "cap");
  requirePaise(flow.loanEmi, "loan/emi");
  requirePaise(flow.investment, "investment");
  requirePaise(flow.oneTime, "one-time");
  requirePaise(flow.inflows, "inflows");
  return (
    previous + flow.salary - flow.cap - flow.loanEmi - flow.investment - flow.oneTime + flow.inflows
  );
}

function freeFromParts(
  month: YearMonth,
  today: IsoDate,
  parts: {
    liquid: Paise;
    budgetRemaining: Paise;
    ccDue: Paise;
    remainingEmi: Paise;
    oneTime30d: Paise;
    expectedInflowsIfReceived: Paise;
  },
): FreeToAllocate {
  const liquid = requirePaise(parts.liquid, "liquid");
  const budgetRemaining = requirePaise(parts.budgetRemaining, "budget remaining");
  const ccDue = requirePaise(parts.ccDue, "cc due");
  const remainingEmi = requirePaise(parts.remainingEmi, "remaining emi");
  const oneTime30d = requirePaise(parts.oneTime30d, "one-time 30d");
  const expected = requirePaise(
    parts.expectedInflowsIfReceived,
    "expected inflows",
  );
  const budgetReserved = Math.max(0, budgetRemaining);
  const committed = ccDue + remainingEmi + oneTime30d;
  const free = liquid - budgetReserved - committed;
  return {
    month,
    today,
    liquid,
    budgetRemaining,
    budgetReserved,
    ccDue,
    remainingEmi,
    oneTime30d,
    committed,
    free,
    expectedInflowsIfReceived: expected,
    breakdown: [
      { key: "liquid", label: "Liquid savings", sign: 1, amount: liquid },
      {
        key: "budget_reserved",
        label: "Budget still reserved",
        sign: -1,
        amount: budgetReserved,
      },
      { key: "cc_due", label: "CC due", sign: -1, amount: ccDue },
      {
        key: "remaining_emi",
        label: "EMI remaining this month",
        sign: -1,
        amount: remainingEmi,
      },
      {
        key: "one_time_30d",
        label: "One-time next 30 d",
        sign: -1,
        amount: oneTime30d,
      },
    ],
  };
}

/**
 * Free to allocate: liquid − budget reserved − committed cash.
 * Committed = CC due + remaining Loan/EMI this month + Planned one-time (30 d).
 * Lifestyle recurring inside the cap is not subtracted again. Expected inflows
 * are listed, not added.
 */
export function freeToAllocate(books: FreeCashBooks): FreeToAllocate {
  const today = requireIsoDate(books.today, "today");
  const month = yearMonthFromIsoDate(today);
  const balances = computeBalances(books.accounts, books.entries, today);
  const cap = resolveBudgetCap(month, books.monthBudgets, books.defaultBudgetCap);
  const pace = budgetPace(month, books.entries, cap, today);
  const remainingEmi = committedEmiRemaining(
    month,
    books.recurringPlans,
    books.categories,
    books.entries,
  );
  const oneTime30d = oneTimeWindow(
    ONE_TIME_FREE_CASH_DAYS,
    today,
    books.oneTimePlans,
  );
  return freeFromParts(month, today, {
    liquid: balances.liquid,
    budgetRemaining: pace.remaining,
    ccDue: balances.ccDue,
    remainingEmi,
    oneTime30d,
    expectedInflowsIfReceived: expectedInflowsIfReceived(today, books.inflows ?? []),
  });
}

/**
 * Est. free next month = free today − next month Loan/EMI + settings salary − next cap.
 * Does not subtract CC again (already inside today's free).
 */
export function nextMonthEstimate(
  books: FreeCashBooks,
  free: FreeToAllocate = freeToAllocate(books),
): NextMonthEstimate {
  const today = requireIsoDate(books.today, "today");
  const salary = requirePaise(books.monthlySalary, "monthly salary");
  const nextMonth = addMonths(yearMonthFromIsoDate(today), 1);
  const nextEmi = recurringDue(
    nextMonth,
    "loan_emi",
    books.recurringPlans,
    books.categories,
  );
  const nextCap = resolveBudgetCap(
    nextMonth,
    books.monthBudgets,
    books.defaultBudgetCap,
  );
  const estimated = free.free - nextEmi + salary - nextCap;
  return {
    today,
    nextMonth,
    freeToday: free.free,
    nextEmi,
    salary,
    nextCap,
    estimated,
    breakdown: [
      {
        key: "free_today",
        label: "Free to allocate (today)",
        sign: 1,
        amount: free.free,
      },
      {
        key: "next_emi",
        label: "Next month Loan / EMI",
        sign: -1,
        amount: nextEmi,
      },
      { key: "salary", label: "Monthly salary", sign: 1, amount: salary },
      {
        key: "next_cap",
        label: "Next month budget",
        sign: -1,
        amount: nextCap,
      },
    ],
  };
}

function currentMonthFlow(
  books: FreeCashBooks,
  today: IsoDate,
  month: YearMonth,
  free: FreeToAllocate,
  assumeInflows: boolean,
): LiquidFlow {
  return {
    salary: ZERO_PAISE,
    cap: free.budgetReserved,
    loanEmi: free.remainingEmi,
    investment: recurringDue(month, "investment", books.recurringPlans, books.categories),
    oneTime: oneTimeInMonth(month, books.oneTimePlans, today),
    inflows: inflowsInMonth(month, today, books.inflows ?? [], assumeInflows),
  };
}

function futureMonthFlow(
  books: FreeCashBooks,
  today: IsoDate,
  month: YearMonth,
  assumeInflows: boolean,
): LiquidFlow {
  return {
    salary: requirePaise(books.monthlySalary, "monthly salary"),
    cap: resolveBudgetCap(month, books.monthBudgets, books.defaultBudgetCap),
    loanEmi: recurringDue(month, "loan_emi", books.recurringPlans, books.categories),
    investment: recurringDue(
      month,
      "investment",
      books.recurringPlans,
      books.categories,
    ),
    oneTime: oneTimeInMonth(month, books.oneTimePlans),
    inflows: inflowsInMonth(month, today, books.inflows ?? [], assumeInflows),
  };
}

/**
 * Next `monthCount` months starting at the current month (sheet L6 = this month).
 * Month cards split recurring by kind; projected liquid uses salary − cap −
 * Loan/EMI − investment − one-time (+ inflows if the toggle is on).
 */
export function forecast(
  books: FreeCashBooks,
  monthCount: number = DEFAULT_FORECAST_MONTHS,
): Forecast {
  const today = requireIsoDate(books.today, "today");
  const count = requireMonthCount(monthCount);
  const startMonth = yearMonthFromIsoDate(today);
  const assumeInflows = books.assumeInflows === true;
  const free = freeToAllocate(books);

  const months: ForecastMonth[] = [];
  let running = free.liquid;
  let totLoan: Paise = ZERO_PAISE;
  let totLife: Paise = ZERO_PAISE;
  let totInv: Paise = ZERO_PAISE;

  for (let i = 0; i < count; i++) {
    const month = addMonths(startMonth, i);
    const loanEmi = recurringDue(month, "loan_emi", books.recurringPlans, books.categories);
    const lifestyle = recurringDue(
      month,
      "lifestyle",
      books.recurringPlans,
      books.categories,
    );
    const investment = recurringDue(
      month,
      "investment",
      books.recurringPlans,
      books.categories,
    );
    const lines = recurringDueLines(month, null, books.recurringPlans, books.categories);
    const flow =
      i === 0
        ? currentMonthFlow(books, today, month, free, assumeInflows)
        : futureMonthFlow(books, today, month, assumeInflows);
    running = projectedLiquid(running, flow);
    totLoan += loanEmi;
    totLife += lifestyle;
    totInv += investment;
    months.push({
      month,
      loanEmi,
      lifestyle,
      investment,
      total: loanEmi + lifestyle + investment,
      lines,
      oneTime: flow.oneTime,
      inflows: flow.inflows,
      flow,
      projectedLiquid: running,
    });
  }

  return {
    today,
    startMonth,
    assumeInflows,
    months,
    totals: {
      loanEmi: totLoan,
      lifestyle: totLife,
      investment: totInv,
      total: totLoan + totLife + totInv,
    },
  };
}
