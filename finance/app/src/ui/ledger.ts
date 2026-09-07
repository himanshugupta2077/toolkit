import {
  formatInr,
  isIsoDate,
  isLedgerSource,
  isLedgerType,
  isYearMonth,
  parseYearMonth,
  type IsoDate,
  type LedgerSource,
  type LedgerType,
  type Paise,
  type YearMonth,
} from "../engine/index.ts";
import type { Account, Category, LedgerEntry } from "../engine/types.ts";
import { EMPTY_AMOUNT, type AmountDraft } from "./quickAdd.ts";

export type FlowKind = "in" | "out" | "through";

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  cc_payment: "CC pay",
  refund: "Refund",
  investment: "Invest",
  adjustment: "Adjust",
};

export const LEDGER_SOURCE_LABELS: Record<LedgerSource, string> = {
  manual: "Manual",
  excel: "Excel",
  statement: "Statement",
  recurring_auto: "Recurring",
  allocation: "Allocation",
  ai: "AI",
};

export type LedgerFilters = {
  q: string;
  type: LedgerType | null;
  accountId: string | null;
  categoryId: string | null;
  inBudget: boolean | null;
  source: LedgerSource | null;
};

export const EMPTY_LEDGER_FILTERS: LedgerFilters = {
  q: "",
  type: null,
  accountId: null,
  categoryId: null,
  inBudget: null,
  source: null,
};

export type LedgerStrip = {
  inflow: Paise;
  outflow: Paise;
  budgetSpent: Paise;
};

export type DayGroup = {
  date: IsoDate;
  label: string;
  inflow: Paise;
  outflow: Paise;
  entries: LedgerEntry[];
};

export function flowKind(type: LedgerType): FlowKind {
  switch (type) {
    case "income":
    case "refund":
      return "in";
    case "expense":
    case "investment":
    case "cc_payment":
      return "out";
    default:
      return "through";
  }
}

export function ledgerStrip(entries: readonly LedgerEntry[]): LedgerStrip {
  let inflow: Paise = 0;
  let outflow: Paise = 0;
  let budgetSpent: Paise = 0;
  for (const entry of entries) {
    const flow = flowKind(entry.type);
    if (flow === "in") inflow += entry.amount;
    if (flow === "out") outflow += entry.amount;
    if (entry.type === "expense" && entry.inBudget) budgetSpent += entry.amount;
    if (entry.type === "refund" && entry.inBudget) budgetSpent -= entry.amount;
  }
  return { inflow, outflow, budgetSpent };
}

export function activeFilterCount(filters: LedgerFilters): number {
  let n = 0;
  if (filters.type) n += 1;
  if (filters.accountId) n += 1;
  if (filters.categoryId) n += 1;
  if (filters.inBudget != null) n += 1;
  if (filters.source) n += 1;
  return n;
}

export function filterLedgerEntries(
  entries: readonly LedgerEntry[],
  filters: LedgerFilters,
  accounts: readonly Account[],
  categories: readonly Category[],
): LedgerEntry[] {
  const q = filters.q.trim().toLowerCase();
  const accountNames = new Map(accounts.map((row) => [row.id, row.name.toLowerCase()]));
  const categoryNames = new Map(categories.map((row) => [row.id, row.name.toLowerCase()]));
  return entries.filter((entry) => {
    if (filters.type && entry.type !== filters.type) return false;
    if (
      filters.accountId &&
      entry.fromAccountId !== filters.accountId &&
      entry.toAccountId !== filters.accountId
    ) {
      return false;
    }
    if (filters.categoryId && entry.categoryId !== filters.categoryId) return false;
    if (filters.inBudget != null && entry.inBudget !== filters.inBudget) return false;
    if (filters.source && entry.source !== filters.source) return false;
    if (!q) return true;
    const hay = [
      entry.notes,
      categoryNames.get(entry.categoryId) ?? "",
      accountNames.get(entry.fromAccountId) ?? "",
      accountNames.get(entry.toAccountId) ?? "",
      String(entry.amount / 100),
      formatInr(entry.amount),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatMonthTitle(month: YearMonth): string {
  const { year, month: m } = parseYearMonth(month);
  return `${MONTHS_LONG[m - 1]} ${year}`;
}

export function formatMonthShort(month: YearMonth): string {
  const { month: m } = parseYearMonth(month);
  return MONTHS_SHORT[m - 1] ?? month;
}

export function formatDayHeader(date: IsoDate): string {
  if (!isIsoDate(date)) return date;
  const utc = new Date(`${date}T00:00:00Z`);
  const weekday = WEEKDAYS[utc.getUTCDay()] ?? "";
  const month = MONTHS_SHORT[utc.getUTCMonth()] ?? "";
  return `${weekday} ${utc.getUTCDate()} ${month}`;
}

export function dayHeaderText(group: DayGroup): string {
  const bits = [group.label];
  if (group.outflow > 0) bits.push(`${formatInr(group.outflow)} out`);
  if (group.inflow > 0) bits.push(`${formatInr(group.inflow)} in`);
  return bits.join(" · ");
}

export function groupLedgerByDay(entries: readonly LedgerEntry[]): DayGroup[] {
  const byDate = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1));
  return dates.map((date) => {
    const rows = (byDate.get(date) ?? []).slice().sort((a, b) => {
      const ta = a.time ?? "";
      const tb = b.time ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    const strip = ledgerStrip(rows);
    return {
      date,
      label: formatDayHeader(date),
      inflow: strip.inflow,
      outflow: strip.outflow,
      entries: rows,
    };
  });
}

export function accountChip(
  entry: LedgerEntry,
  accounts: readonly Account[],
): string {
  const from = accounts.find((row) => row.id === entry.fromAccountId)?.name ?? "From";
  const to = accounts.find((row) => row.id === entry.toAccountId)?.name ?? "To";
  switch (entry.type) {
    case "expense":
    case "investment":
    case "cc_payment":
      return from;
    case "income":
    case "refund":
      return to;
    default:
      return `${from} → ${to}`;
  }
}

export function rowTitle(
  entry: LedgerEntry,
  categories: readonly Category[],
): string {
  const note = entry.notes.trim();
  if (note) return note;
  return categories.find((row) => row.id === entry.categoryId)?.name ?? LEDGER_TYPE_LABELS[entry.type];
}

export function categoryInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  return trimmed.slice(0, 1).toUpperCase();
}

export function amountClass(kind: FlowKind): string {
  if (kind === "in") return "text-ok";
  if (kind === "out") return "text-ink";
  return "text-muted";
}

export function amountDraftFromPaise(paise: Paise): AmountDraft {
  if (!Number.isSafeInteger(paise) || paise <= 0) return EMPTY_AMOUNT;
  const rupees = Math.floor(paise / 100);
  const frac = paise % 100;
  if (frac === 0) return { parts: [], buffer: String(rupees) };
  return { parts: [], buffer: `${rupees}.${String(frac).padStart(2, "0")}` };
}

export function inBudgetExplainer(
  entry: Pick<LedgerEntry, "inBudget">,
  category: Category | undefined,
): string {
  if (entry.inBudget) return "Counts against this month's budget cap.";
  if (category?.defaultInBudget) {
    return "This row is marked out of budget, even though the category usually counts.";
  }
  return "This category does not count against the monthly budget cap.";
}

export function parseLedgerSearchParams(
  params: URLSearchParams,
  fallbackMonth: YearMonth,
): { month: YearMonth; filters: LedgerFilters } {
  const monthRaw = params.get("month");
  const month = isYearMonth(monthRaw ?? "") ? (monthRaw as YearMonth) : fallbackMonth;
  const typeRaw = params.get("type");
  const sourceRaw = params.get("source");
  const inBudgetRaw = params.get("inBudget");
  return {
    month,
    filters: {
      q: params.get("q") ?? "",
      type: typeRaw && isLedgerType(typeRaw) ? typeRaw : null,
      accountId: params.get("account") || null,
      categoryId: params.get("category") || null,
      inBudget: inBudgetRaw === "1" ? true : inBudgetRaw === "0" ? false : null,
      source: sourceRaw && isLedgerSource(sourceRaw) ? sourceRaw : null,
    },
  };
}

export function ledgerSearchParams(
  month: YearMonth,
  filters: LedgerFilters,
): URLSearchParams {
  const next = new URLSearchParams();
  next.set("month", month);
  const q = filters.q.trim();
  if (q) next.set("q", q);
  if (filters.type) next.set("type", filters.type);
  if (filters.accountId) next.set("account", filters.accountId);
  if (filters.categoryId) next.set("category", filters.categoryId);
  if (filters.inBudget != null) next.set("inBudget", filters.inBudget ? "1" : "0");
  if (filters.source) next.set("source", filters.source);
  return next;
}
