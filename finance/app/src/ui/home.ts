import type { HomeForecastMonth } from "../api/store.ts";
import {
  addMonths,
  daysBetween,
  daysInMonth,
  formatInr,
  isoDateFromParts,
  parseYearMonth,
  yearMonthFromIsoDate,
  type BudgetPace,
  type IsoDate,
  type MonthSummary,
  type PaceBand,
  type Paise,
  type UpcomingBill,
  type YearMonth,
} from "../engine/index.ts";
import {
  EMPTY_LEDGER_FILTERS,
  formatMonthShort,
  ledgerSearchParams,
  type LedgerFilters,
} from "./ledger.ts";
import { RECURRING_KIND_LABELS } from "./plan.ts";

export const PACE_BAND_LABELS: Record<PaceBand, string> = {
  on_track: "On track",
  watch: "Watch",
  over: "Over pace",
};

export function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0%";
  return `${Math.round(ratio * 100)}%`;
}

export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft <= 0) return "Month ended";
  if (daysLeft === 1) return "1 day left";
  return `${daysLeft} days left`;
}

export function calendarDaysLeft(today: IsoDate): number {
  const month = yearMonthFromIsoDate(today);
  const day = Number(today.slice(8, 10));
  return daysInMonth(month) - day + 1;
}

export function paceHeadline(pace: Pick<BudgetPace, "spent" | "safePerDay">): string {
  const perDay = `${formatInr(pace.safePerDay)} / day`;
  if (pace.spent === 0) return `No spending yet: ${perDay}`;
  return `Safe to spend today ${perDay}`;
}

export function nextDueDate(today: IsoDate, dueDay: number | null): IsoDate | null {
  if (dueDay == null || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return null;
  }
  const month = yearMonthFromIsoDate(today);
  const thisDays = daysInMonth(month);
  const { year, month: m } = parseYearMonth(month);
  const thisMonthDue = isoDateFromParts(year, m, Math.min(dueDay, thisDays));
  if (thisMonthDue >= today) return thisMonthDue;
  const next = addMonths(month, 1);
  const nextDays = daysInMonth(next);
  const parsed = parseYearMonth(next);
  return isoDateFromParts(parsed.year, parsed.month, Math.min(dueDay, nextDays));
}

export function dueInLabel(today: IsoDate, dueDay: number | null): string | null {
  const next = nextDueDate(today, dueDay);
  if (!next) return null;
  const days = daysBetween(today, next);
  if (days <= 0) return "due today";
  if (days === 1) return "due in 1 day";
  return `due in ${days} days`;
}

export type MonthTile = {
  key: string;
  label: string;
  amount: Paise;
  href: string;
};

function ledgerHref(month: YearMonth, patch: Partial<LedgerFilters>): string {
  const params = ledgerSearchParams(month, { ...EMPTY_LEDGER_FILTERS, ...patch });
  return `/ledger?${params.toString()}`;
}

export function monthTiles(month: YearMonth, summary: MonthSummary): MonthTile[] {
  const monthOnly = ledgerHref(month, {});
  return [
    { key: "income", label: "Income", amount: summary.income, href: ledgerHref(month, { type: "income" }) },
    {
      key: "budget",
      label: "Budget exp",
      amount: summary.budgetSpent,
      href: ledgerHref(month, { type: "expense", inBudget: true }),
    },
    {
      key: "nonbudget",
      label: "Non-budget exp",
      amount: summary.nonBudgetExp,
      href: ledgerHref(month, { type: "expense", inBudget: false }),
    },
    {
      key: "invest",
      label: "Investments",
      amount: summary.investments,
      href: ledgerHref(month, { type: "investment" }),
    },
    {
      key: "emi_rent",
      label: "EMIs + rent",
      amount: summary.emis + summary.rent,
      href: monthOnly,
    },
    {
      key: "savings",
      label: "Est. savings",
      amount: summary.estSavings,
      href: monthOnly,
    },
  ];
}

export type SavingsMonthBar = {
  month: YearMonth;
  savings: Paise;
  height: number;
};

export function savingsMonthBars(
  months: readonly { month: YearMonth; savings: Paise }[],
): SavingsMonthBar[] {
  const max = Math.max(0, ...months.map((row) => Math.abs(row.savings)));
  return months.map((row) => ({
    month: row.month,
    savings: row.savings,
    height: max === 0 || row.savings === 0 ? 0 : Math.abs(row.savings) / max,
  }));
}

export type StackedMonthBar = {
  month: YearMonth;
  loanEmi: Paise;
  lifestyle: Paise;
  investment: Paise;
  total: Paise;
  /** 0–1 relative to the largest month total. */
  height: number;
  shares: { loanEmi: number; lifestyle: number; investment: number };
};

export function stackedMonthBars(
  months: readonly HomeForecastMonth[],
): StackedMonthBar[] {
  const max = Math.max(0, ...months.map((row) => row.total));
  return months.map((row) => {
    const total = row.total;
    return {
      month: row.month,
      loanEmi: row.loanEmi,
      lifestyle: row.lifestyle,
      investment: row.investment,
      total,
      height: max === 0 || total === 0 ? 0 : total / max,
      shares: {
        loanEmi: total === 0 ? 0 : row.loanEmi / total,
        lifestyle: total === 0 ? 0 : row.lifestyle / total,
        investment: total === 0 ? 0 : row.investment / total,
      },
    };
  });
}

export type HomeActionCard = {
  kind: "negative_free" | "allocate";
  title: string;
  body: string;
  href: string | null;
  disabled: boolean;
};

export function homeActionCards(input: { free: Paise }): HomeActionCard[] {
  const cards: HomeActionCard[] = [];

  if (input.free < 0) {
    cards.push({
      kind: "negative_free",
      title: "Committed beyond liquid",
      body: "Free to allocate is negative. The breakdown on this screen shows why.",
      href: null,
      disabled: false,
    });
  }

  if (input.free > 0) {
    cards.push({
      kind: "allocate",
      title: `Allocate this month: ${formatInr(input.free)} free`,
      body: "Preview the waterfall, then confirm transfers.",
      href: "/wealth/allocate",
      disabled: false,
    });
  }

  return cards;
}

export function signedLineAmount(sign: 1 | -1, amount: Paise): string {
  const body = formatInr(amount);
  return sign < 0 ? `− ${body}` : body;
}

export function upcomingBillHref(bill: Pick<UpcomingBill, "source">): string {
  return bill.source === "one_time" ? "/plan?tab=one-time" : "/plan?tab=recurring";
}

export function upcomingBillsTotal(bills: readonly Pick<UpcomingBill, "amount">[]): Paise {
  return bills.reduce((sum, row) => sum + row.amount, 0);
}

export function upcomingDueCaption(today: IsoDate, due: IsoDate): string {
  const days = daysBetween(today, due);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function upcomingKindLabel(
  bill: Pick<UpcomingBill, "source" | "frequency"> & Partial<Pick<UpcomingBill, "kind">>,
): string {
  if (bill.kind) return RECURRING_KIND_LABELS[bill.kind];
  if (bill.source === "one_time") return "One-time";
  if (bill.frequency === "yearly") return "Yearly";
  if (bill.frequency === "weekly") return "Weekly";
  if (bill.frequency === "custom_months") return "Repeating";
  return "Monthly";
}

export function upcomingBillSubline(
  bill: Pick<UpcomingBill, "source" | "frequency" | "dueDate"> &
    Partial<Pick<UpcomingBill, "kind">>,
  today: IsoDate,
): string {
  const day = Number(bill.dueDate.slice(8, 10));
  const month = formatMonthShort(bill.dueDate.slice(0, 7) as YearMonth);
  return `${day} ${month} · ${upcomingKindLabel(bill)} · ${upcomingDueCaption(today, bill.dueDate)}`;
}
