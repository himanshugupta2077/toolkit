import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const bool = (name: string, defaultValue: boolean) =>
  integer(name, { mode: "boolean" }).notNull().default(defaultValue);

export const buckets = sqliteTable("buckets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priority: integer("priority").notNull().unique(),
  targetRule: text("target_rule").notNull(),
  targetAmount: integer("target_amount"),
  targetMonths: integer("target_months"),
  fillMode: text("fill_mode").notNull(),
  fillValue: integer("fill_value"),
  minMonthly: integer("min_monthly"),
  active: bool("active", true),
  colour: text("colour"),
  notes: text("notes"),
  updatedAt: text("updated_at").notNull(),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  categoryGroup: text("category_group").notNull(),
  defaultInBudget: bool("default_in_budget", true),
  isEssential: bool("is_essential", false),
  icon: text("icon"),
  sort: integer("sort").notNull().default(0),
  isArchived: bool("is_archived", false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(),
  accountGroup: text("account_group").notNull(),
  openingBalance: integer("opening_balance").notNull().default(0),
  openingDate: text("opening_date").notNull(),
  creditLimit: integer("credit_limit"),
  includeNetWorth: bool("include_net_worth", true),
  includeLiquid: bool("include_liquid", false),
  bucketId: text("bucket_id").references(() => buckets.id),
  statementDay: integer("statement_day"),
  dueDay: integer("due_day"),
  isArchived: bool("is_archived", false),
  notes: text("notes"),
  virtualKind: text("virtual_kind"),
  maturityDate: text("maturity_date"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  defaultBudget: integer("default_budget").notNull(),
  monthlySalary: integer("monthly_salary").notNull(),
  salaryDay: integer("salary_day"),
  efMonths: integer("ef_months").notNull().default(6),
  updatedAt: text("updated_at").notNull(),
});

export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    time: text("time"),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    fromAccountId: text("from_account_id")
      .notNull()
      .references(() => accounts.id),
    toAccountId: text("to_account_id")
      .notNull()
      .references(() => accounts.id),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    inBudget: bool("in_budget", true),
    notes: text("notes"),
    source: text("source").notNull(),
    sourceHash: text("source_hash"),
    goalId: text("goal_id"),
    holdingTxnId: text("holding_txn_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("ix_ledger_date").on(t.date),
    index("ix_ledger_from").on(t.fromAccountId, t.date),
    index("ix_ledger_to").on(t.toAccountId, t.date),
    index("ix_ledger_category").on(t.categoryId, t.date),
    uniqueIndex("ux_ledger_hash").on(t.sourceHash),
  ],
);

export const monthBudgets = sqliteTable("month_budgets", {
  month: text("month").primaryKey(),
  budgetCap: integer("budget_cap").notNull(),
  note: text("note"),
  updatedAt: text("updated_at").notNull(),
});

export const recurringPlans = sqliteTable("recurring_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id),
  frequency: text("frequency").notNull(),
  everyN: integer("every_n"),
  amount: integer("amount").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  active: bool("active", true),
  kind: text("kind"),
  payFromAccountId: text("pay_from_account_id").references(() => accounts.id),
  autoPropose: bool("auto_propose", false),
  lastProposedMonth: text("last_proposed_month"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const oneTimePlans = sqliteTable("one_time_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id),
  expectedDate: text("expected_date").notNull(),
  amount: integer("amount").notNull(),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  kind: text("kind"),
  payFromAccountId: text("pay_from_account_id").references(() => accounts.id),
  linkedEntryId: text("linked_entry_id").references(() => ledgerEntries.id),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const reconciliations = sqliteTable("reconciliations", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id),
  checkedAt: text("checked_at").notNull(),
  calculatedBalance: integer("calculated_balance").notNull(),
  actualBalance: integer("actual_balance").notNull(),
  difference: integer("difference").notNull(),
  resolution: text("resolution").notNull(),
  adjustmentEntryId: text("adjustment_entry_id").references(() => ledgerEntries.id),
  notes: text("notes"),
});

export const expectedInflows = sqliteTable("expected_inflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: text("category_id").references(() => categories.id),
  expectedDate: text("expected_date").notNull(),
  amount: integer("amount").notNull(),
  isLiquid: bool("is_liquid", true),
  status: text("status").notNull(),
  linkedEntryId: text("linked_entry_id").references(() => ledgerEntries.id),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const investPlans = sqliteTable("invest_plans", {
  id: text("id").primaryKey(),
  effectiveFrom: text("effective_from").notNull(),
  sipBp: integer("sip_bp").notNull(),
  dipReserveBp: integer("dip_reserve_bp").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const investAssets = sqliteTable("invest_assets", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => investPlans.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  targetBp: integer("target_bp").notNull(),
  dipPriority: integer("dip_priority"),
  instrumentNote: text("instrument_note"),
  active: bool("active", true),
});

export const investThemeTiers = sqliteTable("invest_theme_tiers", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => investPlans.id, { onDelete: "cascade" }),
  belowAmount: integer("below_amount"),
  allowedAssetIds: text("allowed_asset_ids").notNull(),
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  targetAmount: integer("target_amount"),
  targetDate: text("target_date"),
  priority: integer("priority").notNull(),
  fundingBucketId: text("funding_bucket_id")
    .notNull()
    .references(() => buckets.id),
  status: text("status").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const goalContributions = sqliteTable("goal_contributions", {
  id: text("id").primaryKey(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  amount: integer("amount").notNull(),
  ledgerEntryId: text("ledger_entry_id").references(() => ledgerEntries.id),
  note: text("note"),
});

export const allocationRuns = sqliteTable("allocation_runs", {
  id: text("id").primaryKey(),
  month: text("month").notNull(),
  surplusInput: integer("surplus_input").notNull(),
  overrideReason: text("override_reason"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  confirmedAt: text("confirmed_at"),
  investPlanId: text("invest_plan_id").references(() => investPlans.id),
});

export const allocationRunLines = sqliteTable("allocation_run_lines", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => allocationRuns.id, { onDelete: "cascade" }),
  bucketId: text("bucket_id")
    .notNull()
    .references(() => buckets.id),
  proposedAmount: integer("proposed_amount").notNull(),
  confirmedAmount: integer("confirmed_amount"),
  ledgerEntryId: text("ledger_entry_id").references(() => ledgerEntries.id),
});

export const dipReserveLedger = sqliteTable("dip_reserve_ledger", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  credit: integer("credit").notNull().default(0),
  debit: integer("debit").notNull().default(0),
  runId: text("run_id").references(() => allocationRuns.id),
  ledgerEntryId: text("ledger_entry_id").references(() => ledgerEntries.id),
  note: text("note"),
});

export const holdings = sqliteTable(
  "holdings",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => investAssets.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    lastNav: integer("last_nav"),
    lastNavDate: text("last_nav_date"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("ux_holdings_asset_account").on(t.assetId, t.accountId)],
);

export const holdingTxns = sqliteTable(
  "holding_txns",
  {
    id: text("id").primaryKey(),
    holdingId: text("holding_id")
      .notNull()
      .references(() => holdings.id),
    date: text("date").notNull(),
    kind: text("kind").notNull(),
    units: integer("units").notNull(),
    nav: integer("nav").notNull(),
    amount: integer("amount").notNull(),
    ledgerEntryId: text("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.id),
  },
  (t) => [index("ix_holding_txns_holding").on(t.holdingId, t.date)],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    date: text("date").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    balance: integer("balance").notNull(),
  },
  (t) => [uniqueIndex("ux_snapshots_date_account").on(t.date, t.accountId)],
);

export const netWorthDaily = sqliteTable("net_worth_daily", {
  date: text("date").primaryKey(),
  assets: integer("assets").notNull(),
  liabilities: integer("liabilities").notNull(),
  liquid: integer("liquid").notNull(),
  invested: integer("invested").notNull(),
  efBalance: integer("ef_balance").notNull(),
  savingsBalance: integer("savings_balance").notNull(),
});

export const schema = {
  buckets,
  categories,
  accounts,
  settings,
  ledgerEntries,
  monthBudgets,
  recurringPlans,
  oneTimePlans,
  expectedInflows,
  reconciliations,
  meta,
  investPlans,
  investAssets,
  investThemeTiers,
  goals,
  goalContributions,
  allocationRuns,
  allocationRunLines,
  dipReserveLedger,
  holdings,
  holdingTxns,
  snapshots,
  netWorthDaily,
};
