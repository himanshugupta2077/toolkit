import type { BudgetPace, CategorySpend, MonthSummary } from "../engine/budget.ts";
import type { Forecast, FreeToAllocate, NextMonthEstimate } from "../engine/cash.ts";
import type { GoalCard } from "../engine/goals.ts";
import type { InvestSplit } from "../engine/invest.ts";
import type { WaterfallResult } from "../engine/waterfall.ts";
import type {
  Account,
  AccountGroup,
  AccountType,
  Books,
  Bucket,
  Category,
  ExpectedInflow,
  Goal,
  GoalContribution,
  GoalStatus,
  InflowStatus,
  InvestPlan,
  LedgerEntry,
  LedgerSource,
  LedgerType,
  OneTimePlan,
  OneTimeStatus,
  PlanPriority,
  RecurringFrequency,
  RecurringKind,
  RecurringPlan,
  VirtualKind,
} from "../engine/types.ts";
import { apiJson } from "./http.ts";

export type StoreCounts = {
  accounts: number;
  categories: number;
  ledgerEntries: number;
  monthBudgets: number;
  recurringPlans: number;
  oneTimePlans: number;
  expectedInflows: number;
  reconciliations?: number;
  buckets: number;
  goals?: number;
  investPlans?: number;
};

export type HealthResponse = {
  ok: boolean;
  schemaVersion: string;
  dbFile: string;
  lastBackup: string | null;
  lastImport: string | null;
};

export type BalanceMatchLine = {
  accountId: string;
  name: string;
  type: string;
  group: string;
  sheetPaise: number;
  enginePaise: number;
  deltaPaise: number;
  match: boolean;
  actualPaise: number | null;
};

export type ImportedLedgerLine = {
  id: string;
  date: string;
  type: string;
  amount: number;
  fromAccountId: string;
  toAccountId: string;
  fromName: string;
  toName: string;
  categoryName: string;
  notes: string;
  sheetRow: number | null;
  skipped: boolean;
};

export type ImportReport = {
  filename: string;
  replace: boolean;
  ok: boolean;
  counts: {
    accounts: number;
    categories: number;
    ledgerInserted: number;
    ledgerSkipped: number;
    monthBudgets: number;
    recurring: number;
    oneTime: number;
    inflows: number;
    reconciliations: number;
    extraManualLedger: number;
  };
  balances: BalanceMatchLine[];
  mismatches: BalanceMatchLine[];
  ledger: ImportedLedgerLine[];
  warnings: { sheet: string; row: number | null; message: string }[];
  typeGuideIssues: { sheetRow: number; notes: string; issues: { message: string }[] }[];
  recurringCheck: {
    month: string;
    loanEmi: number;
    includesSmartEmi: boolean;
    lines: { name: string; kind: string; amount: number }[];
  };
};

export type ImportResponse = { ok: boolean; report: ImportReport; error?: string };

export type CountsResponse = { ok: boolean; counts: StoreCounts };

export type MonthResponse = {
  ok: boolean;
  month: string;
  today: string;
  pace: BudgetPace;
  summary: MonthSummary;
  freeCash?: Pick<FreeToAllocate, "liquid" | "free" | "committed">;
};

export type HomeCard = {
  accountId: string;
  name: string;
  due: number;
  creditLimit: number | null;
  available: number | null;
  utilisation: number | null;
  dueDay: number | null;
};

export type HomeForecastMonth = {
  month: string;
  loanEmi: number;
  lifestyle: number;
  investment: number;
  total: number;
};

export type HomeReconRow = {
  id: string;
  name: string;
  type: Account["type"];
  group: AccountGroup;
  isArchived: boolean;
  lastReconciledAt: string | null;
  daysSinceReconcile: number | null;
};

export type HomeResponse = {
  ok: boolean;
  today: string;
  month: string;
  lastImport: string | null;
  pace: BudgetPace;
  summary: MonthSummary;
  free: FreeToAllocate;
  nextMonth: NextMonthEstimate;
  forecast: {
    months: HomeForecastMonth[];
    totals: { loanEmi: number; lifestyle: number; investment: number; total: number };
  };
  cards: HomeCard[];
  recent: LedgerEntry[];
  accounts: Account[];
  categories: Category[];
  recon: HomeReconRow[];
  paceByCategory: CategorySpend[];
};

export type LedgerPostBody = {
  date: string;
  time?: string | null;
  type: LedgerType;
  amount: number;
  fromAccountId: string;
  toAccountId: string;
  categoryId: string;
  inBudget: boolean;
  notes: string;
  source?: LedgerSource;
  goalId?: string | null;
};

export type LedgerPostResponse = MonthResponse & {
  ok: boolean;
  entry: LedgerEntry;
};

export type LedgerListResponse = {
  ok: boolean;
  month: string;
  today: string;
  entries: LedgerEntry[];
  accounts: Account[];
  categories: Category[];
};

export type LedgerEntryResponse = {
  ok: boolean;
  today: string;
  entry: LedgerEntry;
  accounts: Account[];
  categories: Category[];
};

export type LedgerDeleteResponse = MonthResponse & {
  ok: boolean;
  id: string;
};

export type BooksResponse = { ok: boolean; books: Books };

export function getHealth() {
  return apiJson<HealthResponse>("/api/health");
}

export function getBooks(since?: string) {
  const path = since ? `/api/books?since=${since}` : "/api/books";
  return apiJson<BooksResponse>(path);
}

export function postLedger(body: LedgerPostBody) {
  return apiJson<LedgerPostResponse>("/api/ledger", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getLedgerMonth(month: string) {
  return apiJson<LedgerListResponse>(`/api/ledger?month=${encodeURIComponent(month)}`);
}

export function getLedgerEntry(id: string) {
  return apiJson<LedgerEntryResponse>(`/api/ledger/${encodeURIComponent(id)}`);
}

export function patchLedger(id: string, body: LedgerPostBody) {
  return apiJson<LedgerPostResponse>(`/api/ledger/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteLedger(id: string) {
  return apiJson<LedgerDeleteResponse>(`/api/ledger/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function getMonth(yyyymm: string) {
  return apiJson<MonthResponse>(`/api/month/${yyyymm}`);
}

export function getHome() {
  return apiJson<HomeResponse>("/api/home");
}

export type PlanBudgetMonth = {
  month: string;
  cap: number;
  income: number;
  budgetSpent: number;
  estSavings: number;
  band: BudgetPace["band"];
};

export type PlanResponse = {
  ok: boolean;
  today: string;
  month: string;
  assumeInflows: boolean;
  defaultBudget: number;
  monthlySalary: number;
  pace: BudgetPace;
  summary: MonthSummary;
  paceByCategory: CategorySpend[];
  budgetMonths: PlanBudgetMonth[];
  recurring: RecurringPlan[];
  recurringHeader: {
    monthlyFixed: number;
    activeCount: number;
    yearlyCommitments: number;
  };
  oneTime: OneTimePlan[];
  oneTimeHeader: {
    next30: number;
    next90: number;
    totalPlanned: number;
  };
  inflows: ExpectedInflow[];
  inflowsHeader: {
    expectedNotCounted: number;
  };
  forecast: Forecast;
  free: FreeToAllocate;
  accounts: Account[];
  categories: Category[];
};

export type RecurringWriteBody = {
  name: string;
  categoryId: string;
  frequency: RecurringFrequency;
  intervalMonths?: number | null;
  amount: number;
  startDate?: string | null;
  endDate?: string | null;
  active?: boolean;
  kind?: RecurringKind | null;
  payFromAccountId?: string | null;
  autoPost?: boolean;
  notes?: string;
};

export type RecurringPatchBody = Partial<RecurringWriteBody>;

export type OneTimeWriteBody = {
  name: string;
  categoryId: string;
  expectedDate: string;
  amount: number;
  priority?: PlanPriority;
  status?: OneTimeStatus;
  payFromAccountId?: string | null;
  notes?: string;
};

export type OneTimePatchBody = Partial<OneTimeWriteBody>;

export type InflowWriteBody = {
  name: string;
  categoryId?: string | null;
  expectedDate: string;
  amount: number;
  isLiquid?: boolean;
  status?: InflowStatus;
  notes?: string;
};

export type InflowPatchBody = Partial<InflowWriteBody>;

export type BudgetPutBody = {
  cap: number;
  applyToFuture?: boolean;
  note?: string;
};

export type PlanMutationResponse = PlanResponse & {
  ok: boolean;
  budget?: { month: string; cap: number; defaultBudget: number };
};

export function getPlan(month?: string, assumeInflows = false) {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (assumeInflows) params.set("assumeInflows", "1");
  const q = params.toString();
  return apiJson<PlanResponse>(q ? `/api/plan?${q}` : "/api/plan");
}

export function putBudget(month: string, body: BudgetPutBody) {
  return apiJson<PlanMutationResponse>(`/api/budgets/${encodeURIComponent(month)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function postRecurring(body: RecurringWriteBody) {
  return apiJson<PlanMutationResponse>("/api/plans/recurring", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchRecurring(id: string, body: RecurringPatchBody) {
  return apiJson<PlanMutationResponse>(`/api/plans/recurring/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function postOneTime(body: OneTimeWriteBody) {
  return apiJson<PlanMutationResponse>("/api/plans/one-time", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchOneTime(id: string, body: OneTimePatchBody) {
  return apiJson<PlanMutationResponse>(`/api/plans/one-time/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function postInflow(body: InflowWriteBody) {
  return apiJson<PlanMutationResponse>("/api/plans/inflows", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchInflow(id: string, body: InflowPatchBody) {
  return apiJson<PlanMutationResponse>(`/api/plans/inflows/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function getCounts() {
  return apiJson<CountsResponse>("/api/dev/counts");
}

export function addDummyExpense() {
  return apiJson<MonthResponse & { ok: boolean; entry: { id: string; amount: number } }>(
    "/api/dev/dummy-expense",
    { method: "POST" },
  );
}

export function wipeStore(confirm: string) {
  return apiJson<CountsResponse>("/api/dev/wipe", {
    method: "POST",
    body: JSON.stringify({ confirm }),
  });
}

export type EngineAccountLine = {
  id: string;
  name: string;
  balance: number;
};

export type EngineBucketLine = {
  id: string;
  name: string;
  priority: number;
  fillMode: string;
  targetRule: string;
  current: number;
  target: number | null;
  room: number | null;
  accounts: EngineAccountLine[];
};

export type EngineGoalLine = {
  id: string;
  name: string;
  targetAmount: number | null;
  priority: number;
  notes: string;
};

export type EngineAssetLine = {
  id: string;
  name: string;
  kind: string;
  targetBp: number;
  dipPriority: number | null;
  active: boolean;
};

export type EngineSummary = {
  today: string;
  confirmation: string;
  buckets: EngineBucketLine[];
  unassignedLiquid: EngineAccountLine[];
  investPlan: {
    sipBp: number;
    dipReserveBp: number;
    assets: EngineAssetLine[];
  } | null;
  goals: EngineGoalLine[];
  essentialsAverage: number;
  efMonths: number;
  savingsTarget: number;
};

export type EngineSummaryResponse = { ok: boolean; summary: EngineSummary };
export type InvestImportResponse = {
  ok: boolean;
  report: EngineSummary & {
    filename: string;
    tagged: number;
    warnings: { sheet: string; row: number | null; message: string }[];
  };
};

export function getEngineSummary() {
  return apiJson<EngineSummaryResponse>("/api/engine-summary");
}

export function seedInvestDefaults() {
  return apiJson<InvestImportResponse>("/api/seed/invest", { method: "POST" });
}

export type WealthAccountLine = {
  id: string;
  name: string;
  group: AccountGroup;
  type: AccountType;
  balance: number;
  includeNetWorth: boolean;
  includeLiquid: boolean;
  isArchived: boolean;
  bucketId: string | null;
};

export type WealthBucketCard = Bucket & {
  current: number;
  target: number | null;
  room: number | null;
  fillPct: number | null;
  monthsFilled: number | null;
  accounts: { id: string; name: string; balance: number }[];
  accountIds: string[];
};

export type NetWorthHistoryPoint = {
  date: string;
  netWorth: number;
};

export type WealthResponse = {
  ok: boolean;
  today: string;
  netWorth: number;
  assetsTotal: number;
  liabilitiesTotal: number;
  assets: WealthAccountLine[];
  liabilities: WealthAccountLine[];
  buckets: WealthBucketCard[];
  linkableAccounts: WealthAccountLine[];
  free: number;
  essentialsAverage: number;
  example: WaterfallResult;
  netWorthHistory: NetWorthHistoryPoint[];
};

export type BucketWriteBody = Bucket & { accountIds: string[] };

export function getWealth() {
  return apiJson<WealthResponse>("/api/wealth");
}

export function putBuckets(buckets: BucketWriteBody[]) {
  return apiJson<WealthResponse>("/api/buckets", {
    method: "PUT",
    body: JSON.stringify({ buckets }),
  });
}

export type GoalBucketLine = {
  id: string;
  name: string;
  current: number;
};

export type GoalAccountLine = {
  id: string;
  name: string;
  group: string;
  bucketId: string | null;
  balance: number;
};

export type GoalsResponse = {
  ok: boolean;
  today: string;
  totalRemaining: number;
  fundingNote: string;
  buckets: GoalBucketLine[];
  accounts: GoalAccountLine[];
  goals: GoalCard[];
  contributions: GoalContribution[];
  goal?: GoalCard | Goal;
  contribution?: GoalContribution;
};

export type GoalWriteBody = {
  name: string;
  targetAmount?: number | null;
  targetDate?: string | null;
  fundingBucketId?: string;
  notes?: string;
};

export type GoalPatchBody = Partial<GoalWriteBody> & {
  status?: GoalStatus;
  priority?: number;
};

export type GoalContributeBody = {
  date?: string;
  amount: number;
  note: string;
};

export function getGoals() {
  return apiJson<GoalsResponse>("/api/goals");
}

export function postGoal(body: GoalWriteBody) {
  return apiJson<GoalsResponse>("/api/goals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchGoal(id: string, body: GoalPatchBody) {
  return apiJson<GoalsResponse>(`/api/goals/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function putGoalOrder(ids: string[]) {
  return apiJson<GoalsResponse>("/api/goals/order", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

export function postGoalContribute(id: string, body: GoalContributeBody) {
  return apiJson<GoalsResponse>(`/api/goals/${encodeURIComponent(id)}/contribute`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type AllocationStatus = "proposed" | "confirmed";

export type SuggestedMove = {
  bucketId: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  type: "transfer" | "investment" | null;
};

export type AllocationLineView = {
  id: string;
  bucketId: string;
  name: string;
  proposedAmount: number;
  confirmedAmount: number | null;
  ledgerEntryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  type: LedgerType | null;
};

export type AllocationRunView = {
  id: string;
  month: string;
  surplusInput: number;
  overrideReason: string | null;
  status: AllocationStatus;
  createdAt: string;
  confirmedAt: string | null;
  investPlanId?: string | null;
  lines: AllocationLineView[];
};

export type AllocationLineWrite = {
  bucketId: string;
  amount: number;
  fromAccountId?: string;
  toAccountId?: string;
};

export type AllocationResponse = WealthResponse & {
  freeCash: FreeToAllocate;
  canAllocate: boolean;
  investPlan: InvestPlan | null;
  investSplit: InvestSplit | null;
  suggested: SuggestedMove[];
  history: AllocationRunView[];
  run?: AllocationRunView;
};

export type AllocationRunBody = {
  surplusInput: number;
  overrideReason?: string | null;
  confirm?: boolean;
  lines: AllocationLineWrite[];
};

export function getAllocation() {
  return apiJson<AllocationResponse>("/api/allocation");
}

export function postAllocationRun(body: AllocationRunBody) {
  return apiJson<AllocationResponse>("/api/allocation/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postAllocationConfirm(id: string, lines: AllocationLineWrite[]) {
  return apiJson<AllocationResponse>(`/api/allocation/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ lines }),
  });
}

export type DipReserveLine = {
  id: string;
  date: string;
  credit: number;
  debit: number;
  runId: string | null;
  ledgerEntryId: string | null;
  note: string;
};

export type InvestAccountLine = {
  id: string;
  name: string;
  group: string;
  balance: number;
};

export type DipOrderLine = {
  assetId: string;
  name: string;
  kind: string;
  dipPriority: number;
  targetBp: number;
  amount: number;
};

export type InvestResponse = {
  ok: boolean;
  today: string;
  plan: InvestPlan | null;
  previousPlan: InvestPlan | null;
  lastInvestAmount: number;
  lastRunId: string | null;
  sipSplit: InvestSplit | null;
  dipBalance: number;
  dipHistory: DipReserveLine[];
  suggestedDip: { amount: number; leftover: number; orders: DipOrderLine[] } | null;
  accounts: InvestAccountLine[];
  suggestedFromAccountId: string | null;
  suggestedToAccountId: string | null;
  planSaved?: InvestPlan;
  entries?: LedgerEntry[];
};

export type InvestPlanWriteBody = InvestPlan;

export type DipBuyBody = {
  amount: number;
  fromAccountId: string;
  toAccountId: string;
  lines: { assetId: string; amount: number }[];
  date?: string;
};

export function getInvest() {
  return apiJson<InvestResponse>("/api/invest");
}

export type PortfolioHoldingCard = {
  id: string;
  assetId: string;
  assetName: string;
  accountId: string;
  accountName: string;
  accountGroup: string;
  lastNav: number | null;
  lastNavDate: string | null;
  units: number;
  avgCost: number;
  cost: number;
  value: number;
  gain: number;
  gainPct: number | null;
  updatedAt: string;
};

export type PortfolioFdCard = {
  accountId: string;
  name: string;
  balance: number;
  maturityDate: string | null;
  daysCaption: string | null;
};

export type PortfolioDriftRow = {
  assetId: string;
  name: string;
  targetBp: number;
  actualBp: number;
  driftPp: number;
  hint: boolean;
};

export type HoldingTxnRow = {
  id: string;
  holdingId: string;
  date: string;
  kind: string;
  units: number;
  nav: number;
  amount: number;
  ledgerEntryId: string;
};

export type PortfolioResponse = {
  ok: boolean;
  today: string;
  value: number;
  invested: number;
  gain: number;
  gainPct: number | null;
  netWorth: number;
  holdings: PortfolioHoldingCard[];
  fds: PortfolioFdCard[];
  drift: PortfolioDriftRow[];
  history: NetWorthHistoryPoint[];
  planId: string | null;
  assets: { id: string; name: string; kind: string }[];
  accounts: { id: string; name: string; group: string }[];
};

export type HoldingDetailResponse = {
  ok: boolean;
  today: string;
  holding: PortfolioHoldingCard;
  txns: HoldingTxnRow[];
  netWorth: number;
  accounts: { id: string; name: string; group: string }[];
};

export function getPortfolio(range?: string) {
  const q = range && range !== "All" ? `?range=${encodeURIComponent(range)}` : "";
  return apiJson<PortfolioResponse>(`/api/portfolio${q}`);
}

export function getHoldingDetail(id: string) {
  return apiJson<HoldingDetailResponse>(`/api/portfolio/${encodeURIComponent(id)}`);
}

export function postHolding(body: { assetId: string; accountId: string }) {
  return apiJson<PortfolioResponse & { holding: PortfolioHoldingCard }>("/api/holdings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchHoldingNav(
  id: string,
  body: { lastNav: number; lastNavDate?: string },
) {
  return apiJson<PortfolioResponse & HoldingDetailResponse>(
    `/api/holdings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function postHoldingTxn(
  id: string,
  body: {
    date?: string;
    kind: string;
    amount: number;
    nav: number;
    units?: number | null;
    fromAccountId?: string | null;
    ledgerEntryId?: string | null;
  },
) {
  return apiJson<PortfolioResponse & HoldingDetailResponse & { txn: HoldingTxnRow }>(
    `/api/holdings/${encodeURIComponent(id)}/txns`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function postSnapshot() {
  return apiJson<{
    ok: boolean;
    snapshot: {
      date: string;
      assets: number;
      liabilities: number;
      netWorth?: number;
    };
    history: NetWorthHistoryPoint[];
    netWorth: number;
  }>("/api/snapshots", { method: "POST" });
}

export function putInvestPlan(body: InvestPlanWriteBody) {
  return apiJson<InvestResponse>("/api/invest/plan", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function getInvestSplit(amount: number) {
  return apiJson<{ ok: boolean; split: InvestSplit; plan: InvestPlan }>(
    `/api/invest/split?amount=${encodeURIComponent(String(amount))}`,
  );
}

export function postDipBuy(body: DipBuyBody) {
  return apiJson<InvestResponse>("/api/invest/dip-buy", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type ReconciliationRow = {
  id: string;
  accountId: string;
  checkedAt: string;
  calculatedBalance: number;
  actualBalance: number;
  difference: number;
  resolution: string;
  adjustmentEntryId: string | null;
  notes: string;
};

export type AccountBalanceRow = Account & {
  balance: number;
  available: number | null;
  utilisation: number | null;
  lastReconciledAt: string | null;
  daysSinceReconcile: number | null;
};

export type AccountsListResponse = {
  ok: boolean;
  today: string;
  liquid: number;
  accounts: AccountBalanceRow[];
  buckets: { id: string; name: string }[];
};

export type AccountDetailResponse = {
  ok: boolean;
  today: string;
  account: Account;
  balance: number;
  available: number | null;
  utilisation: number | null;
  lastReconciledAt: string | null;
  daysSinceReconcile: number | null;
  cycleStart: string;
  cycleSpent: number;
  entries: LedgerEntry[];
  reconciliations: ReconciliationRow[];
  accounts: Account[];
  categories: Category[];
  buckets: { id: string; name: string }[];
  canReconcile: boolean;
  canArchive: boolean;
};

export type AccountPostBody = {
  name: string;
  group: AccountGroup;
  openingBalance: number;
  openingDate: string;
  creditLimit?: number | null;
  includeNetWorth: boolean;
  includeLiquid: boolean;
  bucketId?: string | null;
  statementDay?: number | null;
  dueDay?: number | null;
  notes?: string;
  virtualKind?: VirtualKind | null;
  maturityDate?: string | null;
};

export type AccountPatchBody = {
  name?: string;
  creditLimit?: number | null;
  includeNetWorth?: boolean;
  includeLiquid?: boolean;
  bucketId?: string | null;
  statementDay?: number | null;
  dueDay?: number | null;
  notes?: string;
  isArchived?: boolean;
  maturityDate?: string | null;
};

export type ReconcilePostBody = {
  accountId: string;
  actualBalance: number;
  resolution: "none" | "adjustment";
  notes?: string;
};

export type ReconcileResponse = MonthResponse & {
  ok: boolean;
  reconciliation: ReconciliationRow;
  entry: LedgerEntry | null;
  account: Account;
  balance: number;
  liquid: number;
};

export function getAccounts() {
  return apiJson<AccountsListResponse>("/api/accounts");
}

export function getAccount(id: string) {
  return apiJson<AccountDetailResponse>(`/api/accounts/${encodeURIComponent(id)}`);
}

export function postAccount(body: AccountPostBody) {
  return apiJson<AccountsListResponse & { ok: boolean; account: Account }>(
    "/api/accounts",
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function patchAccount(id: string, body: AccountPatchBody) {
  return apiJson<{ ok: boolean; account: Account; liquid: number; detail: AccountDetailResponse | null }>(
    `/api/accounts/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function postReconcile(body: ReconcilePostBody) {
  return apiJson<ReconcileResponse>("/api/reconcile", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function saveInvestSeed(body: {
  savingsRupees?: number;
  efMonths?: number;
  sipPct?: number;
  dipPct?: number;
  goldInactive?: boolean;
}) {
  return apiJson<{ ok: boolean; summary: EngineSummary }>("/api/seed/invest", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export type CategoryListItem = Category & {
  isEssential: boolean;
  usageCount: number;
};

export type CategoriesResponse = {
  ok: boolean;
  categories: CategoryListItem[];
  category?: CategoryListItem;
};

export type CategoryWriteBody = {
  name: string;
  group: string;
  defaultInBudget?: boolean;
  isEssential?: boolean;
};

export type CategoryPatchBody = {
  name?: string;
  group?: string;
  defaultInBudget?: boolean;
  isEssential?: boolean;
  isArchived?: boolean;
};

export type MoneySettings = {
  defaultBudget: number;
  monthlySalary: number;
  salaryDay: number;
  efMonths: number;
};

export type LockStatus = {
  pinSet: boolean;
  blurDefault: boolean;
  autoLockSeconds: number;
};

export type LockResponse = LockStatus & {
  ok: boolean;
  identity?: { required: boolean; login: string | null };
};

export type SettingsResponse = {
  ok: boolean;
  money: MoneySettings;
  lock: LockStatus;
  categories: CategoryListItem[];
  essentialIds: string[];
  identity: { required: boolean; login: string | null };
};

export type SettingsPutBody = {
  defaultBudget?: number;
  monthlySalary?: number;
  salaryDay?: number;
  efMonths?: number;
  essentialIds?: string[];
  blurDefault?: boolean;
  autoLockSeconds?: number;
};

export function getCategories() {
  return apiJson<CategoriesResponse>("/api/categories");
}

export function postCategory(body: CategoryWriteBody) {
  return apiJson<CategoriesResponse>("/api/categories", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchCategory(id: string, body: CategoryPatchBody) {
  return apiJson<CategoriesResponse>(`/api/categories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function getLockStatus() {
  return apiJson<LockResponse>("/api/lock");
}

export function postUnlock(pin: string) {
  return apiJson<{ ok: boolean; unlocked: boolean }>("/api/lock/unlock", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

export function getSettings() {
  return apiJson<SettingsResponse>("/api/settings");
}

export function putSettings(body: SettingsPutBody) {
  return apiJson<SettingsResponse>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function postPin(pin: string, currentPin?: string | null) {
  return apiJson<{ ok: boolean; lock: LockStatus }>("/api/settings/pin", {
    method: "POST",
    body: JSON.stringify({ pin, currentPin: currentPin ?? null }),
  });
}

export function deletePin(currentPin: string) {
  return apiJson<{ ok: boolean; lock: LockStatus }>("/api/settings/pin", {
    method: "DELETE",
    body: JSON.stringify({ currentPin }),
  });
}
