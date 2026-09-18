import {
  addMonths,
  daysInMonth,
  isIsoDate,
  isoDateFromParts,
  monthStart,
  parseYearMonth,
  yearMonthFromIsoDate,
  yearMonthFromParts,
  type IsoDate,
} from "./dates.ts";
import { ZERO_PAISE, type Paise } from "./money.ts";
import {
  RECONCILIATION_CATEGORY_NAME,
  type Account,
  type Category,
  type LedgerEntry,
  type LedgerType,
} from "./types.ts";

export const RECONCILE_RESOLUTIONS = ["none", "added_txn", "adjustment"] as const;
export type ReconcileResolution = (typeof RECONCILE_RESOLUTIONS)[number];

export function isReconcileResolution(value: string): value is ReconcileResolution {
  return (RECONCILE_RESOLUTIONS as readonly string[]).includes(value);
}

/** `actual − calculated`. Positive means the bank/app number is higher. */
export function reconcileDifference(calculated: Paise, actual: Paise): Paise {
  return actual - calculated;
}

export type AdjustmentLegs = {
  fromAccountId: string;
  toAccountId: string;
  amount: Paise;
};

/**
 * From → To that closes `actual − calculated` on this account.
 * Asset: higher actual credits the account. Liability due: higher actual
 * debits the account (due = opening + from − to).
 */
export function adjustmentLegs(
  account: Account,
  difference: Paise,
  counterpartId: string,
): AdjustmentLegs | null {
  if (difference === 0) return null;
  if (counterpartId === account.id) return null;
  const amount = Math.abs(difference);
  const actualHigher = difference > 0;
  const creditAccount = account.type === "liability" ? !actualHigher : actualHigher;
  if (creditAccount) {
    return { fromAccountId: counterpartId, toAccountId: account.id, amount };
  }
  return { fromAccountId: account.id, toAccountId: counterpartId, amount };
}

export function findAdjustmentCounterpart(
  accounts: readonly Account[],
): Account | undefined {
  return accounts.find(
    (row) =>
      !row.isArchived && row.type === "virtual" && row.virtualKind === "external",
  );
}

export function findReconciliationCategory(
  categories: readonly Category[],
): Category | undefined {
  return categories.find(
    (row) =>
      !row.isArchived &&
      row.name.trim().toLowerCase() === RECONCILIATION_CATEGORY_NAME.toLowerCase(),
  );
}

function clampDayOfMonth(year: number, month: number, day: number): number {
  const ym = yearMonthFromParts(year, month);
  return Math.min(Math.max(1, day), daysInMonth(ym));
}

/**
 * Open cycle start: last statement date on or before today (inclusive).
 * No statement day → first of the calendar month (sheet fallback).
 */
export function currentCycleStart(
  today: IsoDate,
  statementDay: number | null,
): IsoDate {
  if (!isIsoDate(today)) {
    throw new Error(`invalid cycle today: ${today}`);
  }
  if (statementDay == null || statementDay < 1) {
    return monthStart(yearMonthFromIsoDate(today));
  }
  const ym = yearMonthFromIsoDate(today);
  const { year, month } = parseYearMonth(ym);
  const todayDay = Number(today.slice(8, 10));
  const thisMonthDay = clampDayOfMonth(year, month, statementDay);
  if (todayDay >= thisMonthDay) {
    return isoDateFromParts(year, month, thisMonthDay);
  }
  const prev = addMonths(ym, -1);
  const prior = parseYearMonth(prev);
  return isoDateFromParts(
    prior.year,
    prior.month,
    clampDayOfMonth(prior.year, prior.month, statementDay),
  );
}

/**
 * Next statement date after today. Today on the statement day rolls forward.
 * No statement day → null (do not invent a cycle).
 */
export function nextStatementDate(
  today: IsoDate,
  statementDay: number | null,
): IsoDate | null {
  if (!isIsoDate(today)) {
    throw new Error(`invalid cycle today: ${today}`);
  }
  if (statementDay == null || statementDay < 1) {
    return null;
  }
  const ym = yearMonthFromIsoDate(today);
  const { year, month } = parseYearMonth(ym);
  const todayDay = Number(today.slice(8, 10));
  const thisMonthDay = clampDayOfMonth(year, month, statementDay);
  if (todayDay < thisMonthDay) {
    return isoDateFromParts(year, month, thisMonthDay);
  }
  const next = addMonths(ym, 1);
  const following = parseYearMonth(next);
  return isoDateFromParts(
    following.year,
    following.month,
    clampDayOfMonth(following.year, following.month, statementDay),
  );
}

export type CycleSpendEntry = Pick<
  LedgerEntry,
  "date" | "amount" | "fromAccountId" | "toAccountId" | "type"
>;

/** Expenses from this account minus refunds to it, in [start, today]. */
export function cycleSpends(
  accountId: string,
  entries: readonly CycleSpendEntry[],
  start: IsoDate,
  today: IsoDate,
): Paise {
  let spent: Paise = ZERO_PAISE;
  for (const entry of entries) {
    if (entry.date < start || entry.date > today) continue;
    if (entry.type === "expense" && entry.fromAccountId === accountId) {
      spent += entry.amount;
    } else if (entry.type === "refund" && entry.toAccountId === accountId) {
      spent -= entry.amount;
    }
  }
  return spent;
}

export function reconCheckedDate(checkedAt: string): IsoDate | null {
  const day = checkedAt.slice(0, 10);
  return isIsoDate(day) ? day : null;
}

export function canReconcileAccount(account: Account): boolean {
  return account.type !== "virtual";
}

export const ADJUSTMENT_LEDGER_TYPE: LedgerType = "adjustment";
