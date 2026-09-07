import { monthSummary, type CategoryName, type MonthLedgerEntry } from "./budget.ts";
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  isIsoDate,
  isYearMonth,
  isoDateFromParts,
  monthEnd,
  monthStart,
  parseYearMonth,
  yearMonthFromIsoDate,
  type IsoDate,
  type YearMonth,
} from "./dates.ts";
import { isPaise, ZERO_PAISE, type Paise } from "./money.ts";
import {
  EMI_CATEGORY_NAME,
  INVESTMENT_CATEGORY_NAME,
  type RecurringKind,
  type RecurringPlan,
  type OneTimePlan,
} from "./types.ts";

/** Recurring fields cash-due needs. Extra fields are allowed. */
export type RecurringDuePlan = Pick<
  RecurringPlan,
  | "categoryId"
  | "frequency"
  | "intervalMonths"
  | "amount"
  | "startDate"
  | "endDate"
  | "active"
  | "kind"
>;

/** Recurring row identity so forecast cards can list which plans make up a kind. */
export type RecurringLinePlan = RecurringDuePlan &
  Pick<RecurringPlan, "id" | "name">;

export type RecurringDueLine = {
  planId: string;
  name: string;
  kind: RecurringKind;
  amount: Paise;
};

/** One-time fields the 30/90-day window needs. Extra fields are allowed. */
export type OneTimeWindowPlan = Pick<OneTimePlan, "expectedDate" | "amount" | "status">;

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

function requireOptionalIsoDate(date: IsoDate | null, label: string): IsoDate | null {
  if (date == null) return null;
  return requireIsoDate(date, label);
}

function nameMatches(name: string, expected: string): boolean {
  return name.trim().toLowerCase() === expected.toLowerCase();
}

function monthNumber(month: YearMonth): number {
  return parseYearMonth(month).month;
}

function monthIndex(month: YearMonth): number {
  const parsed = parseYearMonth(month);
  return parsed.year * 12 + (parsed.month - 1);
}

/**
 * Start/end overlap at month grain (sheet helpers).
 * Blank start = already started. Blank end = still running.
 * End on any day of the month still counts that month.
 */
function coversMonth(start: IsoDate | null, end: IsoDate | null, month: YearMonth): boolean {
  const from = monthStart(month);
  const to = monthEnd(month);
  if (start && start > to) return false;
  if (end && end < from) return false;
  return true;
}

function categoryNameById(
  categories: readonly CategoryName[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const category of categories) names.set(category.id, category.name);
  return names;
}

/**
 * Effective Kind: stored kind, else EMIs → loan_emi, Investment → investment, else lifestyle.
 * Same as Planned Expenses helper column R.
 */
export function resolveRecurringKind(
  kind: RecurringKind | null,
  categoryName: string | undefined,
): RecurringKind {
  if (kind) return kind;
  if (categoryName && nameMatches(categoryName, EMI_CATEGORY_NAME)) return "loan_emi";
  if (categoryName && nameMatches(categoryName, INVESTMENT_CATEGORY_NAME)) {
    return "investment";
  }
  return "lifestyle";
}

function weeklyDueInMonth(
  start: IsoDate,
  end: IsoDate | null,
  amount: Paise,
  month: YearMonth,
): Paise {
  const from = monthStart(month);
  const to = monthEnd(month);
  let first: IsoDate;
  if (start >= from) {
    first = start;
  } else {
    const skip = Math.ceil(daysBetween(start, from) / 7) * 7;
    first = addDays(start, skip);
  }
  const last = end && end < to ? end : to;
  let total: Paise = ZERO_PAISE;
  let cursor = first;
  while (cursor <= last) {
    if (cursor >= from && cursor >= start) total += amount;
    cursor = addDays(cursor, 7);
  }
  return total;
}

function customMonthsHits(start: IsoDate, intervalMonths: number | null, month: YearMonth): boolean {
  if (intervalMonths == null || !Number.isInteger(intervalMonths) || intervalMonths < 1) {
    return false;
  }
  const startMonth = yearMonthFromIsoDate(start);
  const offset = monthIndex(month) - monthIndex(startMonth);
  return offset >= 0 && offset % intervalMonths === 0;
}

function amountDueInMonth(plan: RecurringDuePlan, month: YearMonth): Paise {
  const start = requireOptionalIsoDate(plan.startDate, "start");
  const end = requireOptionalIsoDate(plan.endDate, "end");
  if (!coversMonth(start, end, month)) return ZERO_PAISE;

  switch (plan.frequency) {
    case "monthly":
      return plan.amount;
    case "yearly": {
      // Sheet: blank Start → 0; anniversary month only; never yearly÷12.
      if (!start) return ZERO_PAISE;
      if (monthNumber(yearMonthFromIsoDate(start)) !== monthNumber(month)) return ZERO_PAISE;
      if (yearMonthFromIsoDate(start) > month) return ZERO_PAISE;
      return plan.amount;
    }
    case "weekly":
      if (!start) return ZERO_PAISE;
      return weeklyDueInMonth(start, end, plan.amount, month);
    case "custom_months":
      if (!start) return ZERO_PAISE;
      return customMonthsHits(start, plan.intervalMonths, month) ? plan.amount : ZERO_PAISE;
    default:
      return ZERO_PAISE;
  }
}

function dueInMonth<T extends RecurringDuePlan>(
  month: YearMonth,
  kind: RecurringKind | null,
  plans: readonly T[],
  categories: readonly CategoryName[],
): { plan: T; kind: RecurringKind; amount: Paise }[] {
  const ym = requireYearMonth(month);
  const names = categoryNameById(categories);
  const rows: { plan: T; kind: RecurringKind; amount: Paise }[] = [];
  for (const plan of plans) {
    requirePaise(plan.amount, "recurring amount");
    if (!plan.active) continue;
    const effective = resolveRecurringKind(plan.kind, names.get(plan.categoryId));
    if (kind && effective !== kind) continue;
    const amount = amountDueInMonth(plan, ym);
    if (amount === ZERO_PAISE) continue;
    rows.push({ plan, kind: effective, amount });
  }
  return rows;
}

/**
 * Cash due in `month` for active plans, optionally filtered by kind.
 * Pass `kind: null` for every kind (the sheet's monthly-fixed-cost total).
 */
export function recurringDue(
  month: YearMonth,
  kind: RecurringKind | null,
  plans: readonly RecurringDuePlan[],
  categories: readonly CategoryName[],
): Paise {
  let total: Paise = ZERO_PAISE;
  for (const row of dueInMonth(month, kind, plans, categories)) total += row.amount;
  return total;
}

/** Contributing active rows for a month (amount > 0). Same due rules as `recurringDue`. */
export function recurringDueLines(
  month: YearMonth,
  kind: RecurringKind | null,
  plans: readonly RecurringLinePlan[],
  categories: readonly CategoryName[],
): RecurringDueLine[] {
  return dueInMonth(month, kind, plans, categories).map((row) => ({
    planId: row.plan.id,
    name: row.plan.name,
    kind: row.kind,
    amount: row.amount,
  }));
}

/**
 * Planned one-time amounts with expected date in `[today, today+days]` inclusive.
 * Completed and Cancelled are excluded. Past Planned rows are excluded (sheet B8/B9).
 */
export function oneTimeWindow(
  days: number,
  today: IsoDate,
  plans: readonly OneTimeWindowPlan[],
): Paise {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error("window days must be a non-negative integer");
  }
  const asOf = requireIsoDate(today, "today");
  const until = addDays(asOf, days);
  let total: Paise = ZERO_PAISE;
  for (const plan of plans) {
    requirePaise(plan.amount, "one-time amount");
    if (plan.status !== "planned") continue;
    const expected = requireIsoDate(plan.expectedDate, "expected");
    if (expected >= asOf && expected <= until) total += plan.amount;
  }
  return total;
}

/**
 * Planned one-time amounts whose expected date falls in `month`.
 * Pass `fromDate` to keep only dates on/after that day (remaining of the current month).
 */
export function oneTimeInMonth(
  month: YearMonth,
  plans: readonly OneTimeWindowPlan[],
  fromDate?: IsoDate,
): Paise {
  const ym = requireYearMonth(month);
  const monthFrom = monthStart(ym);
  const monthTo = monthEnd(ym);
  const start =
    fromDate && requireIsoDate(fromDate, "from") > monthFrom ? fromDate : monthFrom;
  let total: Paise = ZERO_PAISE;
  for (const plan of plans) {
    requirePaise(plan.amount, "one-time amount");
    if (plan.status !== "planned") continue;
    const expected = requireIsoDate(plan.expectedDate, "expected");
    if (expected >= start && expected <= monthTo) total += plan.amount;
  }
  return total;
}

/**
 * Remaining Loan/EMI this month: planned loan_emi due − ledger category EMIs, floored at 0.
 * Same as MAX(0, Planned Expenses!M6 − Monthly Budget!B12).
 */
export function committedEmiRemaining(
  month: YearMonth,
  plans: readonly RecurringDuePlan[],
  categories: readonly CategoryName[],
  entries: readonly MonthLedgerEntry[],
): Paise {
  const due = recurringDue(month, "loan_emi", plans, categories);
  const paid = monthSummary(month, entries, categories).emis;
  return Math.max(0, due - paid);
}

/** True when `end` is a calendar day before `today` (still due in the end month). */
export function recurringIsEnded(endDate: IsoDate | null, today: IsoDate): boolean {
  if (endDate == null) return false;
  return requireIsoDate(endDate, "end") < requireIsoDate(today, "today");
}

/**
 * Sum of active yearly plan amounts that have not ended. Header "Yearly
 * commitments" — not smeared across months.
 */
export function yearlyCommitments(
  today: IsoDate,
  plans: readonly RecurringDuePlan[],
): Paise {
  const asOf = requireIsoDate(today, "today");
  let total: Paise = ZERO_PAISE;
  for (const plan of plans) {
    requirePaise(plan.amount, "recurring amount");
    if (!plan.active) continue;
    if (plan.frequency !== "yearly") continue;
    if (recurringIsEnded(plan.endDate, asOf)) continue;
    total += plan.amount;
  }
  return total;
}

function dayOfIsoDate(date: IsoDate): number {
  return Number(date.slice(8, 10));
}

function dateOnDay(month: YearMonth, day: number): IsoDate {
  const { year, month: m } = parseYearMonth(month);
  return isoDateFromParts(year, m, Math.min(Math.max(1, day), daysInMonth(month)));
}

function occurrenceInMonth(plan: RecurringDuePlan, month: YearMonth): IsoDate | null {
  if (amountDueInMonth(plan, month) === ZERO_PAISE) return null;
  const start = plan.startDate;
  const day = start ? dayOfIsoDate(start) : 1;
  return dateOnDay(month, day);
}

/**
 * Next calendar due on or after `today`. Inactive and ended plans return null.
 * Yearly uses the anniversary date only (never ÷12).
 */
export function nextRecurringDueDate(plan: RecurringDuePlan, today: IsoDate): IsoDate | null {
  const asOf = requireIsoDate(today, "today");
  if (!plan.active) return null;
  const start = requireOptionalIsoDate(plan.startDate, "start");
  const end = requireOptionalIsoDate(plan.endDate, "end");
  if (end && end < asOf) return null;

  if (plan.frequency === "weekly") {
    if (!start) return null;
    let cursor = start;
    if (cursor < asOf) {
      const skip = Math.ceil(daysBetween(start, asOf) / 7) * 7;
      cursor = addDays(start, skip);
      if (cursor < asOf) cursor = addDays(cursor, 7);
    }
    if (end && cursor > end) return null;
    return cursor;
  }

  let month = yearMonthFromIsoDate(asOf);
  if (start) {
    const startMonth = yearMonthFromIsoDate(start);
    if (startMonth > month) month = startMonth;
  }

  for (let i = 0; i < 36; i++) {
    const m = addMonths(month, i);
    if (end && monthStart(m) > end) break;
    const candidate = occurrenceInMonth(plan, m);
    if (!candidate) continue;
    let due = candidate;
    if (start && due < start) due = start;
    if (end && due > end) due = end;
    if (due >= asOf && (!end || due <= end)) return due;
  }
  return null;
}
