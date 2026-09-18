import {
  ACCOUNT_GROUPS,
  ACCOUNT_TYPES,
  FILL_MODES,
  INFLOW_STATUSES,
  isGoalStatus,
  isInvestAssetKind,
  isLedgerSource,
  isLedgerType,
  ONE_TIME_STATUSES,
  PLAN_PRIORITIES,
  RECURRING_FREQUENCIES,
  RECURRING_KINDS,
  TARGET_RULES,
  VIRTUAL_KINDS,
  type Account,
  type AccountGroup,
  type AccountType,
  type Bucket,
  type Category,
  type ExpectedInflow,
  type FillMode,
  type InflowStatus,
  type LedgerEntry,
  type MonthBudget,
  type OneTimePlan,
  type OneTimeStatus,
  type PlanPriority,
  type RecurringFrequency,
  type RecurringKind,
  type RecurringPlan,
  type Settings,
  type TargetRule,
  type VirtualKind,
  type Goal,
  type GoalContribution,
  type GoalStatus,
  type InvestAsset,
  type InvestAssetKind,
  type InvestPlan,
  type InvestThemeTier,
} from "../../src/engine/types.ts";
import type {
  accounts,
  buckets,
  categories,
  expectedInflows,
  goalContributions,
  goals,
  investAssets,
  investPlans,
  investThemeTiers,
  ledgerEntries,
  monthBudgets,
  oneTimePlans,
  recurringPlans,
  settings,
} from "../db/schema.ts";

function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`invalid ${label}: ${value}`);
}

function textOrEmpty(value: string | null | undefined): string {
  return value ?? "";
}

export function mapAccount(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    name: row.name,
    type: oneOf(row.type, ACCOUNT_TYPES, "account type") as AccountType,
    openingBalance: row.openingBalance,
    openingDate: row.openingDate,
    creditLimit: row.creditLimit,
    includeNetWorth: row.includeNetWorth,
    includeLiquid: row.includeLiquid,
    group: oneOf(row.accountGroup, ACCOUNT_GROUPS, "account group") as AccountGroup,
    bucketId: row.bucketId,
    statementDay: row.statementDay,
    dueDay: row.dueDay,
    isArchived: row.isArchived,
    notes: textOrEmpty(row.notes),
    virtualKind:
      row.virtualKind == null
        ? null
        : (oneOf(row.virtualKind, VIRTUAL_KINDS, "virtual kind") as VirtualKind),
    maturityDate: row.maturityDate,
  };
}

export function mapCategory(row: typeof categories.$inferSelect): Category {
  return {
    id: row.id,
    name: row.name,
    group: row.categoryGroup,
    defaultInBudget: row.defaultInBudget,
    icon: row.icon,
    isArchived: row.isArchived,
    sort: row.sort,
  };
}

export function mapLedgerEntry(row: typeof ledgerEntries.$inferSelect): LedgerEntry {
  if (!isLedgerType(row.type)) {
    throw new Error(`invalid ledger type: ${row.type}`);
  }
  if (!isLedgerSource(row.source)) {
    throw new Error(`invalid ledger source: ${row.source}`);
  }
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    type: row.type,
    amount: row.amount,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    categoryId: row.categoryId,
    inBudget: row.inBudget,
    notes: textOrEmpty(row.notes),
    source: row.source,
    goalId: row.goalId,
    holdingTxnId: row.holdingTxnId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapMonthBudget(row: typeof monthBudgets.$inferSelect): MonthBudget {
  return {
    month: row.month,
    cap: row.budgetCap,
    note: textOrEmpty(row.note),
  };
}

export function mapSettings(row: typeof settings.$inferSelect): Settings {
  return {
    defaultBudget: row.defaultBudget,
    monthlySalary: row.monthlySalary,
    salaryDay: row.salaryDay ?? 1,
  };
}

function fromDbFrequency(value: string): RecurringFrequency {
  if (value === "every_n_months") return "custom_months";
  return oneOf(value, RECURRING_FREQUENCIES, "recurring frequency");
}

export function toDbFrequency(value: RecurringFrequency): string {
  return value === "custom_months" ? "every_n_months" : value;
}

export function mapRecurringPlan(row: typeof recurringPlans.$inferSelect): RecurringPlan {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    frequency: fromDbFrequency(row.frequency),
    intervalMonths: row.everyN,
    amount: row.amount,
    startDate: row.startDate,
    endDate: row.endDate,
    active: row.active,
    kind:
      row.kind == null
        ? null
        : (oneOf(row.kind, RECURRING_KINDS, "recurring kind") as RecurringKind),
    payFromAccountId: row.payFromAccountId,
    notes: textOrEmpty(row.notes),
    autoPost: row.autoPropose,
    lastPostedMonth: row.lastProposedMonth,
  };
}

export function mapOneTimePlan(row: typeof oneTimePlans.$inferSelect): OneTimePlan {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    expectedDate: row.expectedDate,
    amount: row.amount,
    priority: oneOf(row.priority, PLAN_PRIORITIES, "plan priority") as PlanPriority,
    status: oneOf(row.status, ONE_TIME_STATUSES, "one-time status") as OneTimeStatus,
    kind:
      row.kind == null
        ? null
        : (oneOf(row.kind, RECURRING_KINDS, "one-time kind") as RecurringKind),
    payFromAccountId: row.payFromAccountId,
    notes: textOrEmpty(row.notes),
    linkedLedgerEntryId: row.linkedEntryId,
  };
}

export function mapExpectedInflow(
  row: typeof expectedInflows.$inferSelect,
): ExpectedInflow {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId ?? "",
    expectedDate: row.expectedDate,
    amount: row.amount,
    isLiquid: row.isLiquid,
    status: oneOf(row.status, INFLOW_STATUSES, "inflow status") as InflowStatus,
    notes: textOrEmpty(row.notes),
    linkedLedgerEntryId: row.linkedEntryId,
  };
}

export function mapBucket(row: typeof buckets.$inferSelect): Bucket {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    targetRule: oneOf(row.targetRule, TARGET_RULES, "target rule") as TargetRule,
    targetAmount: row.targetAmount,
    targetMonths: row.targetMonths,
    fillMode: oneOf(row.fillMode, FILL_MODES, "fill mode") as FillMode,
    fillValue: row.fillValue,
    minMonthly: row.minMonthly,
    active: row.active,
    notes: textOrEmpty(row.notes),
    colour: textOrEmpty(row.colour),
  };
}

export function mapGoal(row: typeof goals.$inferSelect): Goal {
  if (!isGoalStatus(row.status)) {
    throw new Error(`invalid goal status: ${row.status}`);
  }
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.targetAmount,
    targetDate: row.targetDate,
    priority: row.priority,
    fundingBucketId: row.fundingBucketId,
    status: row.status as GoalStatus,
    notes: textOrEmpty(row.notes),
  };
}

export function mapGoalContribution(
  row: typeof goalContributions.$inferSelect,
): GoalContribution {
  return {
    id: row.id,
    goalId: row.goalId,
    date: row.date,
    amount: row.amount,
    note: textOrEmpty(row.note),
    ledgerEntryId: row.ledgerEntryId,
  };
}

export function mapInvestAsset(row: typeof investAssets.$inferSelect): InvestAsset {
  if (!isInvestAssetKind(row.kind)) {
    throw new Error(`invalid invest asset kind: ${row.kind}`);
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as InvestAssetKind,
    targetBp: row.targetBp,
    dipPriority: row.dipPriority,
    instrumentNote: textOrEmpty(row.instrumentNote),
    active: row.active,
  };
}

export function parseAllowedAssetIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function mapInvestThemeTier(row: typeof investThemeTiers.$inferSelect): InvestThemeTier {
  return {
    id: row.id,
    belowAmount: row.belowAmount,
    allowedAssetIds: parseAllowedAssetIds(row.allowedAssetIds),
  };
}

export function mapInvestPlan(
  plan: typeof investPlans.$inferSelect,
  assets: readonly InvestAsset[],
  themeTiers: readonly InvestThemeTier[],
): InvestPlan {
  return {
    id: plan.id,
    effectiveFrom: plan.effectiveFrom,
    sipBp: plan.sipBp,
    dipReserveBp: plan.dipReserveBp,
    notes: textOrEmpty(plan.notes),
    assets,
    themeTiers,
  };
}
