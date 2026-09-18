import {
  addMonths,
  isYearMonth,
  nextRecurringDueDate,
  recurringIsEnded,
  resolveRecurringKind,
  type Category,
  type ExpectedInflow,
  type IsoDate,
  type OneTimePlan,
  type OneTimeStatus,
  type PaceBand,
  type Paise,
  type RecurringKind,
  type RecurringPlan,
  type YearMonth,
} from "../engine/index.ts";
import type { Account } from "../engine/types.ts";
import { formatMonthShort } from "./ledger.ts";

export const PLAN_TABS = [
  "budget",
  "recurring",
  "one-time",
  "inflows",
  "forecast",
] as const;
export type PlanTab = (typeof PLAN_TABS)[number];

export const PLAN_TAB_LABELS: Record<PlanTab, string> = {
  budget: "Budget",
  recurring: "Recurring",
  "one-time": "One-time",
  inflows: "Inflows",
  forecast: "Forecast",
};

export function isPlanTab(value: string): value is PlanTab {
  return (PLAN_TABS as readonly string[]).includes(value);
}

export const RECURRING_FILTERS = [
  "all",
  "bill",
  "loan_emi",
  "lifestyle",
  "investment",
  "inactive",
] as const;
export type RecurringFilter = (typeof RECURRING_FILTERS)[number];

export const RECURRING_KIND_LABELS: Record<RecurringKind, string> = {
  loan_emi: "Loan/EMI",
  lifestyle: "Lifestyle",
  investment: "Investment",
  bill: "Bill",
};

export const KIND_HELP =
  "Forecast bars and Recurring filters. Auto uses the category: EMIs → Loan/EMI, Investment → Investment, else Lifestyle.";

export const ONE_TIME_KIND_HELP =
  "Optional tag on Budget. Dashboard lists every planned one-time.";

export const RECURRING_FILTER_LABELS: Record<RecurringFilter, string> = {
  all: "All",
  bill: "Bill",
  loan_emi: "Loan/EMI",
  lifestyle: "Lifestyle",
  investment: "Investment",
  inactive: "Inactive",
};

export const FREQUENCY_LABELS = {
  monthly: "Monthly",
  yearly: "Yearly",
  weekly: "Weekly",
  custom_months: "Every N months",
} as const;

export const PRIORITY_LABELS = {
  high: "High",
  medium: "Med",
  low: "Low",
} as const;

export const ONE_TIME_STATUS_LABELS: Record<OneTimeStatus, string> = {
  planned: "Planned",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const INFLOW_STATUS_LABELS = {
  expected: "Expected",
  received: "Received",
  dropped: "Dropped",
} as const;

export type PlanSearch = {
  tab: PlanTab;
  month: YearMonth;
  assumeInflows: boolean;
};

export function parsePlanSearchParams(
  params: URLSearchParams,
  fallbackMonth: YearMonth,
): PlanSearch {
  const tabRaw = params.get("tab") ?? "budget";
  const monthRaw = params.get("month") ?? fallbackMonth;
  return {
    tab: isPlanTab(tabRaw) ? tabRaw : "budget",
    month: isYearMonth(monthRaw) ? monthRaw : fallbackMonth,
    assumeInflows: params.get("assumeInflows") === "1",
  };
}

export function planSearchParams(search: PlanSearch): URLSearchParams {
  const params = new URLSearchParams();
  if (search.tab !== "budget") params.set("tab", search.tab);
  params.set("month", search.month);
  if (search.assumeInflows) params.set("assumeInflows", "1");
  return params;
}

export function planHref(search: PlanSearch): string {
  const params = planSearchParams(search);
  const q = params.toString();
  return q ? `/plan?${q}` : "/plan";
}

export function chipClass(on: boolean): string {
  return `chip ${on ? "chip-on" : "chip-off"}`;
}

export function paceDotClass(band: PaceBand): string {
  if (band === "on_track") return "bg-ok";
  if (band === "watch") return "bg-warn";
  return "bg-danger";
}

export function categoryBarWidth(spent: Paise, max: Paise): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, spent / max));
}

export function frequencyLabel(plan: Pick<RecurringPlan, "frequency" | "intervalMonths">): string {
  if (plan.frequency === "custom_months") {
    const n = plan.intervalMonths ?? 1;
    return n === 1 ? "Every month" : `Every ${n} months`;
  }
  return FREQUENCY_LABELS[plan.frequency];
}

export function formatDueDate(date: IsoDate): string {
  const day = Number(date.slice(8, 10));
  return `${day} ${formatMonthShort(date.slice(0, 7))}`;
}

export function nextDueLabel(plan: RecurringPlan, today: IsoDate): string {
  const due = nextRecurringDueDate(plan, today);
  if (!due) return "No next due";
  return `Next ${formatDueDate(due)}`;
}

export type RecurringSections = {
  live: RecurringPlan[];
  ended: RecurringPlan[];
};

export function recurringSections(
  plans: readonly RecurringPlan[],
  filter: RecurringFilter,
  today: IsoDate,
  categories: readonly Pick<Category, "id" | "name">[],
): RecurringSections {
  const names = new Map(categories.map((row) => [row.id, row.name]));
  const live: RecurringPlan[] = [];
  const ended: RecurringPlan[] = [];

  for (const plan of plans) {
    const endedRow = recurringIsEnded(plan.endDate, today);
    const kind =
      plan.kind === "bill"
        ? "bill"
        : resolveRecurringKind(plan.kind, names.get(plan.categoryId));
    if (endedRow) {
      if (filter === "all" || filter === kind) ended.push(plan);
      continue;
    }
    if (filter === "inactive") {
      if (!plan.active) live.push(plan);
      continue;
    }
    if (!plan.active) continue;
    if (filter === "all" || filter === kind) live.push(plan);
  }

  const byName = (a: RecurringPlan, b: RecurringPlan) => a.name.localeCompare(b.name);
  live.sort(byName);
  ended.sort(byName);
  return { live, ended };
}

export function kindLabel(
  plan: RecurringPlan,
  categories: readonly Pick<Category, "id" | "name">[],
): string {
  if (plan.kind === "bill") return RECURRING_KIND_LABELS.bill;
  const category = categories.find((row) => row.id === plan.categoryId);
  return RECURRING_KIND_LABELS[resolveRecurringKind(plan.kind, category?.name)];
}

export function accountName(
  id: string | null,
  accounts: readonly Pick<Account, "id" | "name">[],
): string | null {
  if (!id) return null;
  return accounts.find((row) => row.id === id)?.name ?? null;
}

export function oneTimeSorted(
  plans: readonly OneTimePlan[],
  status: OneTimeStatus,
): OneTimePlan[] {
  return plans
    .filter((row) => row.status === status)
    .slice()
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.name.localeCompare(b.name));
}

export function inflowsSorted(
  inflows: readonly ExpectedInflow[],
  status: ExpectedInflow["status"],
): ExpectedInflow[] {
  return inflows
    .filter((row) => row.status === status)
    .slice()
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.name.localeCompare(b.name));
}

export function payFromAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((row) => !row.isArchived && row.type !== "virtual");
}

export function liveCategories(categories: readonly Category[]): Category[] {
  return categories
    .filter((row) => !row.isArchived)
    .slice()
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export function addMonthClamped(month: YearMonth, delta: number, todayMonth: YearMonth): YearMonth {
  const next = addMonths(month, delta);
  const min = addMonths(todayMonth, -11);
  const max = addMonths(todayMonth, 6);
  if (next < min) return min;
  if (next > max) return max;
  return next;
}

export function formatPctRound(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0%";
  return `${Math.round(ratio * 100)}%`;
}
