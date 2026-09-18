import {
  addMonths,
  budgetPace,
  budgetSpendByCategory,
  computeBalances,
  forecast,
  freeToAllocate,
  monthSummary,
  nextMonthEstimate,
  resolveBudgetCap,
  todayIst,
  upcomingBills,
  yearMonthFromIsoDate,
  type Account,
  type Category,
  type CategorySpend,
  type Forecast,
  type FreeToAllocate,
  type IsoDate,
  type LedgerEntry,
  type NextMonthEstimate,
  type Paise,
  type UpcomingBill,
  type YearMonth,
} from "../src/engine/index.ts";
import { loadBooks, toFreeCashBooks } from "./books.ts";
import type { AppDb } from "./db/client.ts";
import { listAccountBalanceRows, type AccountBalanceRow } from "./repo/accounts.ts";
import { getMeta, listRecentLedgerEntries } from "./repo/store.ts";

const PACE_CATEGORY_LIMIT = 5;
const RECENT_LIMIT = 5;
const FORECAST_MONTHS = 6;
const SAVINGS_MONTHS = 6;

export type HomeCard = {
  accountId: string;
  name: string;
  due: Paise;
  creditLimit: Paise | null;
  available: Paise | null;
  utilisation: number | null;
  dueDay: number | null;
};

export type HomeForecastMonth = {
  month: string;
  loanEmi: Paise;
  lifestyle: Paise;
  investment: Paise;
  total: Paise;
};

export type HomeForecast = {
  months: HomeForecastMonth[];
  totals: Forecast["totals"];
};

export type HomeSavingsMonth = {
  month: YearMonth;
  savings: Paise;
};

export type HomePayload = {
  today: IsoDate;
  month: string;
  lastImport: string | null;
  pace: ReturnType<typeof budgetPace>;
  summary: ReturnType<typeof monthSummary>;
  free: FreeToAllocate;
  nextMonth: NextMonthEstimate;
  forecast: HomeForecast;
  savingsMonths: HomeSavingsMonth[];
  cards: HomeCard[];
  upcomingBills: UpcomingBill[];
  recent: LedgerEntry[];
  accounts: readonly Account[];
  categories: readonly Category[];
  recon: Pick<
    AccountBalanceRow,
    "id" | "name" | "type" | "group" | "isArchived" | "lastReconciledAt" | "daysSinceReconcile"
  >[];
  paceByCategory: CategorySpend[];
};

function compactForecast(full: Forecast): HomeForecast {
  return {
    months: full.months.map((row) => ({
      month: row.month,
      loanEmi: row.loanEmi,
      lifestyle: row.lifestyle,
      investment: row.investment,
      total: row.total,
    })),
    totals: full.totals,
  };
}

export function buildHome(db: AppDb, today: IsoDate = todayIst()): HomePayload {
  const books = loadBooks(db, today);
  const month = yearMonthFromIsoDate(today);
  const cash = toFreeCashBooks(books);
  const cap = resolveBudgetCap(month, books.monthBudgets, books.settings.defaultBudget);
  const pace = budgetPace(month, books.entries, cap, today);
  const summary = monthSummary(month, books.entries, books.categories);
  const free = freeToAllocate(cash);
  const next = nextMonthEstimate(cash, free);
  const snap = computeBalances(books.accounts, books.entries, today);
  const { rows } = listAccountBalanceRows(db, today);
  const dueById = new Map(snap.cards.map((row) => [row.accountId, row]));
  const savingsMonths: HomeSavingsMonth[] = [];
  for (let i = SAVINGS_MONTHS - 1; i >= 0; i--) {
    const ym = addMonths(month, -i);
    savingsMonths.push({
      month: ym,
      savings: monthSummary(ym, books.entries, books.categories).estSavings,
    });
  }

  const cards: HomeCard[] = books.accounts
    .filter((account) => account.group === "credit_card" && !account.isArchived)
    .map((account) => {
      const card = dueById.get(account.id);
      return {
        accountId: account.id,
        name: account.name,
        due: card?.due ?? 0,
        creditLimit: card?.creditLimit ?? account.creditLimit,
        available: card?.available ?? null,
        utilisation: card?.utilisation ?? null,
        dueDay: account.dueDay,
      };
    });

  return {
    today,
    month,
    lastImport: getMeta(db, "last_import_at"),
    pace,
    summary,
    free,
    nextMonth: next,
    forecast: compactForecast(forecast(cash, FORECAST_MONTHS)),
    savingsMonths,
    cards,
    upcomingBills: upcomingBills(
      today,
      books.recurringPlans,
      books.oneTimePlans,
      books.categories,
    ),
    recent: listRecentLedgerEntries(db, RECENT_LIMIT),
    accounts: books.accounts,
    categories: books.categories,
    recon: rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      group: row.group,
      isArchived: row.isArchived,
      lastReconciledAt: row.lastReconciledAt,
      daysSinceReconcile: row.daysSinceReconcile,
    })),
    paceByCategory: budgetSpendByCategory(month, books.entries, books.categories).slice(
      0,
      PACE_CATEGORY_LIMIT,
    ),
  };
}
