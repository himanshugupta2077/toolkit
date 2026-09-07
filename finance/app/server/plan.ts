import {
  addMonths,
  budgetPace,
  budgetSpendByCategory,
  expectedInflowsIfReceived,
  forecast,
  freeToAllocate,
  monthSummary,
  oneTimeWindow,
  recurringDue,
  resolveBudgetCap,
  todayIst,
  yearMonthFromIsoDate,
  yearlyCommitments,
  type Account,
  type BudgetPace,
  type Category,
  type CategorySpend,
  type ExpectedInflow,
  type Forecast,
  type FreeToAllocate,
  type IsoDate,
  type MonthSummary,
  type OneTimePlan,
  type PaceBand,
  type Paise,
  type RecurringPlan,
  type YearMonth,
} from "../src/engine/index.ts";
import { loadBooks, toFreeCashBooks } from "./books.ts";
import type { AppDb } from "./db/client.ts";

const BUDGET_PAST_MONTHS = 11;
const BUDGET_FUTURE_MONTHS = 6;
const FORECAST_MONTHS = 6;

export type PlanBudgetMonth = {
  month: YearMonth;
  cap: Paise;
  income: Paise;
  budgetSpent: Paise;
  estSavings: Paise;
  band: PaceBand;
};

export type PlanPayload = {
  today: IsoDate;
  month: YearMonth;
  assumeInflows: boolean;
  defaultBudget: Paise;
  monthlySalary: Paise;
  pace: BudgetPace;
  summary: MonthSummary;
  paceByCategory: CategorySpend[];
  budgetMonths: PlanBudgetMonth[];
  recurring: readonly RecurringPlan[];
  recurringHeader: {
    monthlyFixed: Paise;
    activeCount: number;
    yearlyCommitments: Paise;
  };
  oneTime: readonly OneTimePlan[];
  oneTimeHeader: {
    next30: Paise;
    next90: Paise;
    totalPlanned: Paise;
  };
  inflows: readonly ExpectedInflow[];
  inflowsHeader: {
    expectedNotCounted: Paise;
  };
  forecast: Forecast;
  free: FreeToAllocate;
  accounts: readonly Account[];
  categories: readonly Category[];
};

function budgetMonthList(todayMonth: YearMonth): YearMonth[] {
  const start = addMonths(todayMonth, -BUDGET_PAST_MONTHS);
  const count = BUDGET_PAST_MONTHS + 1 + BUDGET_FUTURE_MONTHS;
  const months: YearMonth[] = [];
  for (let i = 0; i < count; i++) months.push(addMonths(start, i));
  return months;
}

export function buildPlan(
  db: AppDb,
  opts: { month?: YearMonth; assumeInflows?: boolean; today?: IsoDate } = {},
): PlanPayload {
  const today = opts.today ?? todayIst();
  const todayMonth = yearMonthFromIsoDate(today);
  const month = opts.month ?? todayMonth;
  const assumeInflows = opts.assumeInflows === true;
  const books = loadBooks(db, today);
  const cash = toFreeCashBooks(books, assumeInflows);
  const cap = resolveBudgetCap(month, books.monthBudgets, books.settings.defaultBudget);
  const pace = budgetPace(month, books.entries, cap, today);
  const summary = monthSummary(month, books.entries, books.categories);
  const free = freeToAllocate(cash);

  const budgetMonths: PlanBudgetMonth[] = budgetMonthList(todayMonth).map((ym) => {
    const monthCap = resolveBudgetCap(ym, books.monthBudgets, books.settings.defaultBudget);
    const monthPace = budgetPace(ym, books.entries, monthCap, today);
    const monthSum = monthSummary(ym, books.entries, books.categories);
    return {
      month: ym,
      cap: monthCap,
      income: monthSum.income,
      budgetSpent: monthSum.budgetSpent,
      estSavings: monthSum.estSavings,
      band: monthPace.band,
    };
  });

  const plannedOneTime = books.oneTimePlans.filter((row) => row.status === "planned");
  let totalPlanned: Paise = 0;
  for (const row of plannedOneTime) totalPlanned += row.amount;

  const activeNotEnded = books.recurringPlans.filter((row) => {
    if (!row.active) return false;
    if (row.endDate && row.endDate < today) return false;
    return true;
  });

  return {
    today,
    month,
    assumeInflows,
    defaultBudget: books.settings.defaultBudget,
    monthlySalary: books.settings.monthlySalary,
    pace,
    summary,
    paceByCategory: budgetSpendByCategory(month, books.entries, books.categories),
    budgetMonths,
    recurring: books.recurringPlans,
    recurringHeader: {
      monthlyFixed: recurringDue(todayMonth, null, books.recurringPlans, books.categories),
      activeCount: activeNotEnded.length,
      yearlyCommitments: yearlyCommitments(today, books.recurringPlans),
    },
    oneTime: books.oneTimePlans,
    oneTimeHeader: {
      next30: oneTimeWindow(30, today, books.oneTimePlans),
      next90: oneTimeWindow(90, today, books.oneTimePlans),
      totalPlanned,
    },
    inflows: books.inflows,
    inflowsHeader: {
      expectedNotCounted: expectedInflowsIfReceived(today, books.inflows),
    },
    forecast: forecast(cash, FORECAST_MONTHS),
    free,
    accounts: books.accounts,
    categories: books.categories,
  };
}

export function buildForecast(
  db: AppDb,
  opts: { months?: number; assumeInflows?: boolean; today?: IsoDate } = {},
): Forecast {
  const today = opts.today ?? todayIst();
  const books = loadBooks(db, today);
  const cash = toFreeCashBooks(books, opts.assumeInflows === true);
  return forecast(cash, opts.months ?? FORECAST_MONTHS);
}
