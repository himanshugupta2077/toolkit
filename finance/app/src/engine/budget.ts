import {
  daysInMonth,
  isIsoDate,
  isYearMonth,
  yearMonthFromIsoDate,
  type IsoDate,
  type YearMonth,
} from "./dates.ts";
import { isPaise, ZERO_PAISE, type Paise } from "./money.ts";
import {
  EMI_CATEGORY_NAME,
  RENT_CATEGORY_NAME,
  type Category,
  type LedgerEntry,
  type MonthBudget,
} from "./types.ts";

export const PACE_BANDS = ["on_track", "watch", "over"] as const;
export type PaceBand = (typeof PACE_BANDS)[number];

/** Ledger fields budget pace / month summary need. Extra fields are allowed. */
export type MonthLedgerEntry = Pick<
  LedgerEntry,
  "date" | "type" | "amount" | "inBudget" | "categoryId"
>;

export type CategoryName = Pick<Category, "id" | "name">;

export type BudgetPace = {
  month: YearMonth;
  today: IsoDate;
  cap: Paise;
  /** In-budget expenses minus in-budget refunds (Monthly Budget B8). */
  spent: Paise;
  remaining: Paise;
  daysInMonth: number;
  /** 0 when `today` is before the month. */
  dayOfMonth: number;
  /** Inclusive of today when `today` is in the month. 0 when the month is fully past. */
  daysLeft: number;
  /** max(0, remaining) / daysLeft, floored to paise. 0 when daysLeft is 0. */
  safePerDay: Paise;
  /** spent / cap. 0 when cap is 0 (sheet IF(B6=0,0,B8/B6)). */
  usedPct: number;
  elapsedPct: number;
  band: PaceBand;
};

export type MonthSummary = {
  month: YearMonth;
  income: Paise;
  budgetSpent: Paise;
  nonBudgetExp: Paise;
  investments: Paise;
  emis: Paise;
  rent: Paise;
  ccPayments: Paise;
  /** income − budgetSpent − nonBudgetExp − investments. Rent/EMIs are not subtracted again. */
  estSavings: Paise;
};

export type CategorySpend = {
  categoryId: string;
  name: string;
  spent: Paise;
};

type MonthTotals = {
  income: Paise;
  budgetSpent: Paise;
  nonBudgetExp: Paise;
  investments: Paise;
  emis: Paise;
  rent: Paise;
  ccPayments: Paise;
};

const WATCH_SLACK = 0.1;

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

function dayOfIsoDate(date: IsoDate): number {
  return Number(date.slice(8, 10));
}

function nameMatches(name: string, expected: string): boolean {
  return name.trim().toLowerCase() === expected.toLowerCase();
}

function inMonth(date: string, month: YearMonth): boolean {
  return isIsoDate(date) && yearMonthFromIsoDate(date) === month;
}

/**
 * Elapsed / days-left for a month relative to `today`.
 * Current month: day_of_month / days_in_month, days left include today.
 * Past month: fully elapsed, days left 0.
 * Future month: elapsed 0, days left = full month.
 */
function paceCalendar(
  month: YearMonth,
  today: IsoDate,
): { dayOfMonth: number; daysLeft: number; elapsedPct: number; days: number } {
  const days = daysInMonth(month);
  const todayMonth = yearMonthFromIsoDate(today);
  if (todayMonth < month) {
    return { dayOfMonth: 0, daysLeft: days, elapsedPct: 0, days };
  }
  if (todayMonth > month) {
    return { dayOfMonth: days, daysLeft: 0, elapsedPct: 1, days };
  }
  const dayOfMonth = dayOfIsoDate(today);
  return {
    dayOfMonth,
    daysLeft: days - dayOfMonth + 1,
    elapsedPct: dayOfMonth / days,
    days,
  };
}

function paceBand(usedPct: number, elapsedPct: number): PaceBand {
  if (usedPct <= elapsedPct) return "on_track";
  if (usedPct <= elapsedPct + WATCH_SLACK) return "watch";
  return "over";
}

function monthTotals(
  month: YearMonth,
  entries: readonly MonthLedgerEntry[],
  categories: readonly CategoryName[],
): MonthTotals {
  const names = new Map<string, string>();
  for (const category of categories) names.set(category.id, category.name);

  let income: Paise = ZERO_PAISE;
  let budgetSpent: Paise = ZERO_PAISE;
  let nonBudgetExp: Paise = ZERO_PAISE;
  let investments: Paise = ZERO_PAISE;
  let emis: Paise = ZERO_PAISE;
  let rent: Paise = ZERO_PAISE;
  let ccPayments: Paise = ZERO_PAISE;

  for (const entry of entries) {
    if (!inMonth(entry.date, month)) continue;

    switch (entry.type) {
      case "income":
        income += entry.amount;
        break;
      case "expense":
        if (entry.inBudget) budgetSpent += entry.amount;
        else nonBudgetExp += entry.amount;
        break;
      case "refund":
        // Same as Monthly Budget: in-budget refunds net against budget expenses.
        if (entry.inBudget) budgetSpent -= entry.amount;
        break;
      case "investment":
        investments += entry.amount;
        break;
      case "cc_payment":
        ccPayments += entry.amount;
        break;
      default:
        break;
    }

    const categoryName = names.get(entry.categoryId);
    if (!categoryName) continue;
    if (nameMatches(categoryName, EMI_CATEGORY_NAME)) emis += entry.amount;
    if (nameMatches(categoryName, RENT_CATEGORY_NAME)) rent += entry.amount;
  }

  return {
    income,
    budgetSpent,
    nonBudgetExp,
    investments,
    emis,
    rent,
    ccPayments,
  };
}

/** Cap for `month`: that month's row if present, otherwise `defaultCap`. */
export function resolveBudgetCap(
  month: YearMonth,
  budgets: readonly Pick<MonthBudget, "month" | "cap">[],
  defaultCap: Paise,
): Paise {
  requireYearMonth(month);
  requirePaise(defaultCap, "default cap");
  const row = budgets.find((budget) => budget.month === month);
  if (!row) return defaultCap;
  return requirePaise(row.cap, "budget cap");
}

export function budgetPace(
  month: YearMonth,
  entries: readonly MonthLedgerEntry[],
  cap: Paise,
  today: IsoDate,
): BudgetPace {
  const ym = requireYearMonth(month);
  const asOf = requireIsoDate(today, "today");
  const budgetCap = requirePaise(cap, "budget cap");
  const spent = monthTotals(ym, entries, []).budgetSpent;
  const remaining = budgetCap - spent;
  const cal = paceCalendar(ym, asOf);
  const usedPct = budgetCap === 0 ? 0 : spent / budgetCap;
  const safePerDay =
    cal.daysLeft > 0 ? Math.floor(Math.max(0, remaining) / cal.daysLeft) : ZERO_PAISE;

  return {
    month: ym,
    today: asOf,
    cap: budgetCap,
    spent,
    remaining,
    daysInMonth: cal.days,
    dayOfMonth: cal.dayOfMonth,
    daysLeft: cal.daysLeft,
    safePerDay,
    usedPct,
    elapsedPct: cal.elapsedPct,
    band: paceBand(usedPct, cal.elapsedPct),
  };
}

export function monthSummary(
  month: YearMonth,
  entries: readonly MonthLedgerEntry[],
  categories: readonly CategoryName[],
): MonthSummary {
  const ym = requireYearMonth(month);
  const totals = monthTotals(ym, entries, categories);
  return {
    month: ym,
    income: totals.income,
    budgetSpent: totals.budgetSpent,
    nonBudgetExp: totals.nonBudgetExp,
    investments: totals.investments,
    emis: totals.emis,
    rent: totals.rent,
    ccPayments: totals.ccPayments,
    estSavings:
      totals.income - totals.budgetSpent - totals.nonBudgetExp - totals.investments,
  };
}

/** In-budget expenses minus in-budget refunds, grouped by category, largest first. */
export function budgetSpendByCategory(
  month: YearMonth,
  entries: readonly MonthLedgerEntry[],
  categories: readonly CategoryName[],
): CategorySpend[] {
  const ym = requireYearMonth(month);
  const names = new Map<string, string>();
  for (const category of categories) names.set(category.id, category.name);

  const spent = new Map<string, Paise>();
  for (const entry of entries) {
    if (!inMonth(entry.date, ym)) continue;
    if (entry.type === "expense" && entry.inBudget) {
      spent.set(entry.categoryId, (spent.get(entry.categoryId) ?? ZERO_PAISE) + entry.amount);
    } else if (entry.type === "refund" && entry.inBudget) {
      spent.set(entry.categoryId, (spent.get(entry.categoryId) ?? ZERO_PAISE) - entry.amount);
    }
  }

  return [...spent.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      name: names.get(categoryId) ?? categoryId,
      spent: amount,
    }))
    .filter((row) => row.spent !== 0)
    .sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));
}
