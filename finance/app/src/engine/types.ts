import type { ClockTime, IsoDate, YearMonth } from "./dates.ts";
import type { Paise } from "./money.ts";

export const ACCOUNT_TYPES = ["asset", "liability", "virtual"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_GROUPS = [
  "savings",
  "cash",
  "credit_card",
  "fd",
  "investment",
  "virtual",
  "loan",
  "other",
] as const;
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number];

export const VIRTUAL_KINDS = ["employer", "external", "expense"] as const;
export type VirtualKind = (typeof VIRTUAL_KINDS)[number];

export function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(value);
}

export function isAccountGroup(value: string): value is AccountGroup {
  return (ACCOUNT_GROUPS as readonly string[]).includes(value);
}

export function isVirtualKind(value: string): value is VirtualKind {
  return (VIRTUAL_KINDS as readonly string[]).includes(value);
}

/** Group implies type. Credit card / loan are liabilities; virtual stays virtual. */
export function typeForAccountGroup(group: AccountGroup): AccountType {
  if (group === "virtual") return "virtual";
  if (group === "credit_card" || group === "loan") return "liability";
  return "asset";
}

export function defaultIncludeLiquid(group: AccountGroup): boolean {
  return group === "savings" || group === "cash";
}

export const LEDGER_TYPES = [
  "income",
  "expense",
  "transfer",
  "cc_payment",
  "refund",
  "investment",
  "adjustment",
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const LEDGER_SOURCES = [
  "manual",
  "excel",
  "statement",
  "recurring_auto",
  "allocation",
  "ai",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export function isLedgerType(value: string): value is LedgerType {
  return (LEDGER_TYPES as readonly string[]).includes(value);
}

export function isLedgerSource(value: string): value is LedgerSource {
  return (LEDGER_SOURCES as readonly string[]).includes(value);
}

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: Paise;
  openingDate: IsoDate;
  creditLimit: Paise | null;
  includeNetWorth: boolean;
  includeLiquid: boolean;
  group: AccountGroup;
  bucketId: string | null;
  statementDay: number | null;
  dueDay: number | null;
  isArchived: boolean;
  notes: string;
  /** Employer / External / Expense. Null on real accounts. */
  virtualKind: VirtualKind | null;
  /** FD (and similar) optional maturity. Null/omitted when none. */
  maturityDate?: IsoDate | null;
};

export type Category = {
  id: string;
  name: string;
  group: string;
  defaultInBudget: boolean;
  icon: string | null;
  isArchived: boolean;
  sort: number;
};

export type LedgerEntry = {
  id: string;
  date: IsoDate;
  time: ClockTime | null;
  type: LedgerType;
  amount: Paise;
  fromAccountId: string;
  toAccountId: string;
  categoryId: string;
  inBudget: boolean;
  notes: string;
  source: LedgerSource;
  goalId: string | null;
  holdingTxnId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const RECONCILIATION_CATEGORY_NAME = "Reconciliation";
/** Sheet Monthly Budget SUMIFS on Ledger Category. */
export const EMI_CATEGORY_NAME = "EMIs";
export const RENT_CATEGORY_NAME = "Rent";
/** Blank Kind infers this category name → investment (Planned Expenses helper). */
export const INVESTMENT_CATEGORY_NAME = "Investment";

export type MonthBudget = {
  month: YearMonth;
  cap: Paise;
  note: string;
};

export const RECURRING_FREQUENCIES = [
  "monthly",
  "yearly",
  "weekly",
  "custom_months",
] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export function isRecurringFrequency(value: string): value is RecurringFrequency {
  return (RECURRING_FREQUENCIES as readonly string[]).includes(value);
}

export const RECURRING_KINDS = ["loan_emi", "lifestyle", "investment"] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];

export function isRecurringKind(value: string): value is RecurringKind {
  return (RECURRING_KINDS as readonly string[]).includes(value);
}

export const PLAN_PRIORITIES = ["high", "medium", "low"] as const;
export type PlanPriority = (typeof PLAN_PRIORITIES)[number];

export function isPlanPriority(value: string): value is PlanPriority {
  return (PLAN_PRIORITIES as readonly string[]).includes(value);
}

export const ONE_TIME_STATUSES = ["planned", "completed", "cancelled"] as const;
export type OneTimeStatus = (typeof ONE_TIME_STATUSES)[number];

export function isOneTimeStatus(value: string): value is OneTimeStatus {
  return (ONE_TIME_STATUSES as readonly string[]).includes(value);
}

export type RecurringPlan = {
  id: string;
  name: string;
  categoryId: string;
  frequency: RecurringFrequency;
  /** Months between dues. Used when frequency is `custom_months`. Null otherwise. */
  intervalMonths: number | null;
  amount: Paise;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  active: boolean;
  /** Null = blank Kind: infer EMIs → loan_emi, Investment → investment, else lifestyle. */
  kind: RecurringKind | null;
  payFromAccountId: string | null;
  notes: string;
  autoPost: boolean;
  lastPostedMonth: YearMonth | null;
};

export type OneTimePlan = {
  id: string;
  name: string;
  categoryId: string;
  expectedDate: IsoDate;
  amount: Paise;
  priority: PlanPriority;
  status: OneTimeStatus;
  payFromAccountId: string | null;
  notes: string;
  linkedLedgerEntryId: string | null;
};

export const INFLOW_STATUSES = ["expected", "received", "dropped"] as const;
export type InflowStatus = (typeof INFLOW_STATUSES)[number];

export function isInflowStatus(value: string): value is InflowStatus {
  return (INFLOW_STATUSES as readonly string[]).includes(value);
}

/** Planning-only. Shown on free cash; added to projected liquid only when assume-inflows is on. */
export type ExpectedInflow = {
  id: string;
  name: string;
  categoryId: string;
  expectedDate: IsoDate;
  amount: Paise;
  isLiquid: boolean;
  status: InflowStatus;
  notes: string;
  linkedLedgerEntryId: string | null;
};

/** Money settings the engine needs. Blur / PIN live in prefs, not here. */
export type Settings = {
  defaultBudget: Paise;
  monthlySalary: Paise;
  /** 1–31. Unused until month-rollover / reminders. */
  salaryDay: number;
};

/**
 * Full snapshot the store loads for the engine. Goals / invest plan arrive in
 * later phases; extra fields on the DB rows are allowed.
 */
export type Books = {
  today: IsoDate;
  accounts: readonly Account[];
  categories: readonly Category[];
  entries: readonly LedgerEntry[];
  monthBudgets: readonly MonthBudget[];
  settings: Settings;
  recurringPlans: readonly RecurringPlan[];
  oneTimePlans: readonly OneTimePlan[];
  inflows: readonly ExpectedInflow[];
  buckets: readonly Bucket[];
};

export const TARGET_RULES = ["fixed", "months_of_essentials", "none"] as const;
export type TargetRule = (typeof TARGET_RULES)[number];

export const FILL_MODES = ["until_target", "percent", "fixed", "remainder"] as const;
export type FillMode = (typeof FILL_MODES)[number];

export function isTargetRule(value: string): value is TargetRule {
  return (TARGET_RULES as readonly string[]).includes(value);
}

export function isFillMode(value: string): value is FillMode {
  return (FILL_MODES as readonly string[]).includes(value);
}

/**
 * Allocation destination. Default seed is Emergency Fund → Savings buffer →
 * Investment (remainder). `minMonthly` is stored for Phase 18; the waterfall
 * does not apply it.
 */
export type Bucket = {
  id: string;
  name: string;
  /** Lower runs first. */
  priority: number;
  targetRule: TargetRule;
  /** When `targetRule` is `fixed`. */
  targetAmount: Paise | null;
  /** When `targetRule` is `months_of_essentials` (default 6). */
  targetMonths: number | null;
  fillMode: FillMode;
  /**
   * `percent`: 0–100 of original surplus.
   * `fixed`: paise to try to give.
   * Otherwise unused.
   */
  fillValue: number | null;
  minMonthly: Paise | null;
  active: boolean;
  notes: string;
  colour: string;
};

/** 10_000 bp = 100%. Used for SIP/dip split and asset target weights. */
export const BP_SCALE = 10_000;

export const INVEST_ASSET_KINDS = ["core", "theme"] as const;
export type InvestAssetKind = (typeof INVEST_ASSET_KINDS)[number];

export function isInvestAssetKind(value: string): value is InvestAssetKind {
  return (INVEST_ASSET_KINDS as readonly string[]).includes(value);
}

export type InvestAsset = {
  id: string;
  name: string;
  kind: InvestAssetKind;
  /** Share of the full plan. 2500 = 25%. Split re-normalises over the active set. */
  targetBp: number;
  /** Lower deploys first on a dip buy. Null = not in the dip order. */
  dipPriority: number | null;
  instrumentNote: string;
  active: boolean;
};

/**
 * Theme engine row. Amounts strictly below `belowAmount` match; `null` is the
 * unbounded top tier (₹20,000+ in the default seed).
 */
export type InvestThemeTier = {
  id: string;
  belowAmount: Paise | null;
  allowedAssetIds: readonly string[];
};

export type InvestPlan = {
  id: string;
  effectiveFrom: IsoDate;
  /** SIP pool as basis points of the monthly invest amount. Default 7000. */
  sipBp: number;
  /** Dip-reserve credit as basis points. sipBp + dipReserveBp = 10_000. */
  dipReserveBp: number;
  notes: string;
  assets: readonly InvestAsset[];
  themeTiers: readonly InvestThemeTier[];
};

export const GOAL_STATUSES = ["active", "paused", "achieved", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export function isGoalStatus(value: string): value is GoalStatus {
  return (GOAL_STATUSES as readonly string[]).includes(value);
}

export const GOAL_PILLS = [
  "achieved",
  "affordable_now",
  "on_track",
  "behind",
  "saving",
] as const;
export type GoalPill = (typeof GOAL_PILLS)[number];

export type Goal = {
  id: string;
  name: string;
  /** Null when the sheet left the target blank (MacBook / iPhone). */
  targetAmount: Paise | null;
  targetDate: IsoDate | null;
  /** Lower is higher priority. */
  priority: number;
  fundingBucketId: string;
  status: GoalStatus;
  notes: string;
};

export type GoalContribution = {
  id: string;
  goalId: string;
  date: IsoDate;
  amount: Paise;
  note: string;
  /** Set when Fund now posted a real transfer/invest row. */
  ledgerEntryId: string | null;
};

export const HOLDING_TXN_KINDS = ["buy_sip", "buy_dip", "sell", "dividend"] as const;
export type HoldingTxnKind = (typeof HOLDING_TXN_KINDS)[number];

export function isHoldingTxnKind(value: string): value is HoldingTxnKind {
  return (HOLDING_TXN_KINDS as readonly string[]).includes(value);
}

export const HISTORY_RANGES = ["1M", "3M", "6M", "1Y", "All"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export function isHistoryRange(value: string): value is HistoryRange {
  return (HISTORY_RANGES as readonly string[]).includes(value);
}

/** Micro-units: 1 unit = 1_000_000. NAV is paise per unit. */
export const UNIT_SCALE = 1_000_000;
/** Rebalance hint when |actual − target| exceeds this many percentage points. */
export const DRIFT_HINT_PP = 5;
