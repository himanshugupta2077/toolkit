import type { HomeForecastMonth, HomeReconRow } from "../api/store.ts";
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
  type YearMonth,
} from "../engine/index.ts";
import { RECONCILE_STALE_DAYS } from "./accounts.ts";
import {
  EMPTY_LEDGER_FILTERS,
  ledgerSearchParams,
  type LedgerFilters,
} from "./ledger.ts";

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
  if (pace.spent === 0) return `No spending yet — ${perDay}`;
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
  kind: "unverified_import" | "unreconciled" | "negative_free" | "allocate";
  title: string;
  body: string;
  href: string | null;
  disabled: boolean;
};

function reconcilable(row: HomeReconRow): boolean {
  if (row.isArchived) return false;
  return row.type !== "virtual";
}

export function homeActionCards(input: {
  lastImport: string | null;
  recon: readonly HomeReconRow[];
  free: Paise;
}): HomeActionCard[] {
  const cards: HomeActionCard[] = [];
  const live = input.recon.filter(reconcilable);
  const never = live.filter((row) => row.lastReconciledAt == null);
  const unverified = input.lastImport != null && never.length > 0;

  if (unverified) {
    cards.push({
      kind: "unverified_import",
      title: "Unverified import",
      body: "Reconcile each account against the bank once.",
      href: "/more/accounts",
      disabled: false,
    });
  }

  const stalePool = unverified
    ? live.filter((row) => row.lastReconciledAt != null)
    : live;
  const worst = stalePool
    .slice()
    .sort((a, b) => {
      const da = a.daysSinceReconcile ?? Number.POSITIVE_INFINITY;
      const db = b.daysSinceReconcile ?? Number.POSITIVE_INFINITY;
      return db - da;
    })[0];
  if (worst) {
    const days = worst.daysSinceReconcile;
    const isNever = worst.lastReconciledAt == null;
    const isStale = isNever || (days != null && days > RECONCILE_STALE_DAYS);
    if (isStale) {
      cards.push({
        kind: "unreconciled",
        title: isNever
          ? `${worst.name} not reconciled yet`
          : `${worst.name} not reconciled in ${days} days`,
        body: "Open Reconcile and stamp or add an adjustment.",
        href: `/more/accounts/${worst.id}/reconcile`,
        disabled: false,
      });
    }
  }

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
      title: `Allocate this month — ${formatInr(input.free)} free`,
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
