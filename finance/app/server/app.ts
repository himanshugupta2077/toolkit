import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import {
  BP_SCALE,
  budgetPace,
  defaultIncludeLiquid,
  freeToAllocate,
  isAccountGroup,
  isClockTime,
  isInflowStatus,
  isIsoDate,
  isLedgerSource,
  isLedgerType,
  isOneTimeStatus,
  isPaise,
  isPlanPriority,
  isRecurringFrequency,
  isRecurringKind,
  isVirtualKind,
  isYearMonth,
  monthSummary,
  nowTimeIst,
  resolveBudgetCap,
  splitInvest,
  todayIst,
  typeForAccountGroup,
  validateLedgerEntry,
  yearMonthFromIsoDate,
  type AccountGroup,
  type InflowStatus,
  type LedgerIssue,
  type LedgerType,
  type OneTimeStatus,
  type PlanPriority,
  type RecurringFrequency,
  type RecurringKind,
  type VirtualKind,
} from "../src/engine/index.ts";
import { loadBooks, toFreeCashBooks } from "./books.ts";
import { buildHome } from "./home.ts";
import { buildForecast, buildPlan } from "./plan.ts";
import { lastBackupAt, vacuumInto } from "./db/backup.ts";
import type { AppDb, OpenedDb } from "./db/client.ts";
import { SCHEMA_VERSION } from "./db/paths.ts";
import {
  DUMMY_EXPENSE_NOTES,
  DUMMY_EXPENSE_PAISE,
  SEED_IDS,
  seedCatalog,
} from "./db/seed.ts";
import { buildEngineSummary } from "./engineSummary.ts";
import { buildAllocation } from "./allocation.ts";
import { buildGoals } from "./goals.ts";
import { buildHoldingDetail, buildPortfolio } from "./portfolio.ts";
import { buildWealth } from "./wealth.ts";
import {
  AllocationWriteError,
  confirmAllocationRun,
  getAllocationRun,
  parseConfirmLines,
  parseProposedLines,
  saveAllocationRun,
} from "./repo/allocation.ts";
import {
  GoalWriteError,
  contributeFromLedger,
  getGoal,
  insertContribution,
  insertGoal,
  parseContributeBody,
  parseCreateGoal,
  parseGoalOrder,
  parsePatchGoal,
  reorderGoals,
  updateGoal,
} from "./repo/goals.ts";
import {
  BucketWriteError,
  parseBucketWrites,
  saveBuckets,
} from "./repo/buckets.ts";
import { applyFinanceImport } from "./import/applyFinance.ts";
import { applyInvestImport, seedDefaultInvestSide } from "./import/applyInvest.ts";
import { ImportError } from "./import/error.ts";
import { sha256Hex } from "./import/hash.ts";
import { parseFinanceWorkbook } from "./import/parseFinance.ts";
import { parseInvestWorkbook } from "./import/parseInvest.ts";
import { MAX_UPLOAD_BYTES } from "./import/types.ts";
import { buildInvest } from "./invest.ts";
import {
  applySeedTargets,
  getCurrentInvestPlan,
  InvestWriteError,
  parseInvestPlanBody,
  saveInvestPlanVersion,
  type SeedTargetPatch,
} from "./repo/invest.ts";
import { deployDip, parseDipBuyBody } from "./repo/dip.ts";
import {
  HoldingWriteError,
  insertHolding,
  parseHoldingBody,
  parseHoldingTxnBody,
  parseNavBody,
  recordHoldingTxn,
  updateHoldingNav,
} from "./repo/holdings.ts";
import { parseHistoryRange, takeSnapshot } from "./repo/snapshots.ts";
import { ensureDefaultBuckets, tagDefaultAccountBuckets } from "./import/mapBuckets.ts";
import {
  getAccountDetail,
  insertAccount,
  listAccountBalanceRows,
  listBucketOptions,
  postReconcile,
  updateAccount,
  type AccountPatch,
  type NewAccountInput,
  type ReconcileWriteResolution,
} from "./repo/accounts.ts";
import {
  deleteExpectedInflow,
  deleteOneTimePlan,
  deleteRecurringPlan,
  insertExpectedInflow,
  insertOneTimePlan,
  insertRecurringPlan,
  updateExpectedInflow,
  updateOneTimePlan,
  updateRecurringPlan,
  upsertMonthBudget,
  type InflowPatch,
  type NewInflowInput,
  type NewOneTimeInput,
  type NewRecurringInput,
  type OneTimePatch,
  type RecurringPatch,
} from "./repo/plans.ts";
import {
  getLedgerEntry,
  getMeta,
  insertLedgerEntry,
  listAccounts,
  listCategories,
  listExpectedInflows,
  listLedgerEntriesForMonth,
  listOneTimePlans,
  listRecurringPlans,
  softDeleteLedgerEntry,
  storeCounts,
  updateLedgerEntry,
  wipeAll,
  type NewLedgerInput,
} from "./repo/store.ts";
import {
  insertCategory,
  listCategoryRows,
  setEssentialIds,
  updateCategory,
  type CategoryPatch,
  type NewCategoryInput,
} from "./repo/categories.ts";
import {
  clearPin,
  getLockStatus,
  getMoneySettings,
  setAutoLockSeconds,
  setBlurDefault,
  setPin,
  unlockWithPin,
  updateMoneySettings,
  type MoneyPatch,
} from "./repo/prefs.ts";
import {
  authFromEnv,
  denyReason,
  tailscaleLoginFromHeaders,
  type AuthConfig,
} from "./auth.ts";

export type CreateAppOptions = OpenedDb & {
  serveUi?: boolean;
  auth?: AuthConfig;
  /** Wipe / dummy-expense. Off in production unless FINANCE_DEV_ROUTES=1. */
  allowDevRoutes?: boolean;
};

type LedgerBody = {
  date?: unknown;
  time?: unknown;
  type?: unknown;
  amount?: unknown;
  fromAccountId?: unknown;
  toAccountId?: unknown;
  categoryId?: unknown;
  inBudget?: unknown;
  notes?: unknown;
  source?: unknown;
  goalId?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pctToBp(value: number): number {
  if (value <= 1) return Math.round(value * BP_SCALE);
  return Math.round(value * 100);
}

function seedPatchFromBody(body: Record<string, unknown>): SeedTargetPatch {
  const patch: SeedTargetPatch = {};
  const savingsPaise = asFiniteNumber(body.savingsTargetPaise);
  const savingsRupees = asFiniteNumber(body.savingsRupees);
  if (savingsPaise != null) patch.savingsTargetPaise = Math.round(savingsPaise);
  else if (savingsRupees != null) patch.savingsTargetPaise = Math.round(savingsRupees * 100);

  const efTargetPaise = asFiniteNumber(body.efTargetPaise);
  const efRupees = asFiniteNumber(body.efRupees);
  if (efTargetPaise != null) patch.efTargetPaise = Math.round(efTargetPaise);
  else if (efRupees != null) patch.efTargetPaise = Math.round(efRupees * 100);

  const sipBp = asFiniteNumber(body.sipBp);
  const dipBp = asFiniteNumber(body.dipReserveBp);
  const sipPct = asFiniteNumber(body.sipPct);
  const dipPct = asFiniteNumber(body.dipPct);
  if (sipBp != null) patch.sipBp = Math.round(sipBp);
  else if (sipPct != null) patch.sipBp = pctToBp(sipPct);
  if (dipBp != null) patch.dipReserveBp = Math.round(dipBp);
  else if (dipPct != null) patch.dipReserveBp = pctToBp(dipPct);
  if (patch.sipBp != null && patch.dipReserveBp == null) {
    patch.dipReserveBp = BP_SCALE - patch.sipBp;
  }
  if (patch.dipReserveBp != null && patch.sipBp == null) {
    patch.sipBp = BP_SCALE - patch.dipReserveBp;
  }

  if (typeof body.goldInactive === "boolean") patch.goldInactive = body.goldInactive;
  return patch;
}

type AccountBody = {
  name?: unknown;
  group?: unknown;
  openingBalance?: unknown;
  openingDate?: unknown;
  creditLimit?: unknown;
  includeNetWorth?: unknown;
  includeLiquid?: unknown;
  bucketId?: unknown;
  statementDay?: unknown;
  dueDay?: unknown;
  notes?: unknown;
  virtualKind?: unknown;
  isArchived?: unknown;
  maturityDate?: unknown;
};

type ReconcileBody = {
  accountId?: unknown;
  actualBalance?: unknown;
  resolution?: unknown;
  notes?: unknown;
};

function asDay(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  const n = asFiniteNumber(value);
  if (n == null || !Number.isInteger(n) || n < 1 || n > 31) return "invalid";
  return n;
}

function asPaiseField(value: unknown): number | "invalid" | null {
  if (value == null || value === "") return null;
  const n = asFiniteNumber(value);
  if (n == null || !Number.isInteger(n)) return "invalid";
  return n;
}

function asBoolField(value: unknown, fallback: boolean): boolean | "invalid" {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  return "invalid";
}

function parseNewAccount(body: AccountBody): { ok: true; value: NewAccountInput } | { ok: false; error: string } {
  const name = asString(body.name).trim();
  if (name === "") return { ok: false, error: "Name is required." };
  const groupRaw = asString(body.group);
  if (!isAccountGroup(groupRaw)) return { ok: false, error: "Unknown account group." };
  const group = groupRaw as AccountGroup;
  const type = typeForAccountGroup(group);
  const openingDate = asString(body.openingDate);
  if (!isIsoDate(openingDate)) return { ok: false, error: "Opening date must be YYYY-MM-DD." };
  const openingRaw =
    body.openingBalance == null || body.openingBalance === "" ? 0 : asPaiseField(body.openingBalance);
  if (openingRaw === "invalid" || openingRaw == null || !isPaise(openingRaw)) {
    return { ok: false, error: "Opening balance must be integer paise." };
  }
  const openPaise = openingRaw;

  const limitRaw = asPaiseField(body.creditLimit);
  if (limitRaw === "invalid") return { ok: false, error: "Credit limit must be integer paise." };
  const creditLimit = group === "credit_card" ? limitRaw : null;

  const includeNetWorth = asBoolField(body.includeNetWorth, type !== "virtual");
  if (includeNetWorth === "invalid") return { ok: false, error: "includeNetWorth must be true or false." };
  const includeLiquid = asBoolField(body.includeLiquid, defaultIncludeLiquid(group));
  if (includeLiquid === "invalid") return { ok: false, error: "includeLiquid must be true or false." };

  const statementDay = asDay(body.statementDay);
  if (statementDay === "invalid") return { ok: false, error: "Statement day must be 1–31." };
  const dueDay = asDay(body.dueDay);
  if (dueDay === "invalid") return { ok: false, error: "Due day must be 1–31." };

  let virtualKind: VirtualKind | null = null;
  if (type === "virtual") {
    const raw = asString(body.virtualKind);
    if (!isVirtualKind(raw)) return { ok: false, error: "Virtual accounts need Employer, External, or Expense." };
    virtualKind = raw;
  }

  const bucketRaw = body.bucketId;
  const bucketId =
    bucketRaw == null || bucketRaw === ""
      ? null
      : typeof bucketRaw === "string"
        ? bucketRaw
        : null;
  if (bucketRaw != null && bucketRaw !== "" && typeof bucketRaw !== "string") {
    return { ok: false, error: "bucketId must be a string." };
  }

  let maturityDate: string | null = null;
  if (body.maturityDate != null && body.maturityDate !== "") {
    const raw = asString(body.maturityDate).trim();
    if (!isIsoDate(raw)) return { ok: false, error: "Maturity date must be YYYY-MM-DD." };
    maturityDate = raw;
  }

  return {
    ok: true,
    value: {
      name,
      type,
      group,
      openingBalance: openPaise,
      openingDate,
      creditLimit,
      includeNetWorth,
      includeLiquid,
      bucketId,
      statementDay,
      dueDay,
      notes: asString(body.notes),
      virtualKind,
      maturityDate,
    },
  };
}

function parseAccountPatch(body: AccountBody): { ok: true; value: AccountPatch } | { ok: false; error: string } {
  const patch: AccountPatch = {};
  if (body.name !== undefined) {
    const name = asString(body.name).trim();
    if (name === "") return { ok: false, error: "Name is required." };
    patch.name = name;
  }
  if (body.creditLimit !== undefined) {
    const limitRaw = asPaiseField(body.creditLimit);
    if (limitRaw === "invalid") return { ok: false, error: "Credit limit must be integer paise." };
    patch.creditLimit = limitRaw;
  }
  if (body.includeNetWorth !== undefined) {
    const v = asBoolField(body.includeNetWorth, true);
    if (v === "invalid") return { ok: false, error: "includeNetWorth must be true or false." };
    patch.includeNetWorth = v;
  }
  if (body.includeLiquid !== undefined) {
    const v = asBoolField(body.includeLiquid, false);
    if (v === "invalid") return { ok: false, error: "includeLiquid must be true or false." };
    patch.includeLiquid = v;
  }
  if (body.bucketId !== undefined) {
    if (body.bucketId == null || body.bucketId === "") patch.bucketId = null;
    else if (typeof body.bucketId === "string") patch.bucketId = body.bucketId;
    else return { ok: false, error: "bucketId must be a string." };
  }
  if (body.statementDay !== undefined) {
    const day = asDay(body.statementDay);
    if (day === "invalid") return { ok: false, error: "Statement day must be 1–31." };
    patch.statementDay = day;
  }
  if (body.dueDay !== undefined) {
    const day = asDay(body.dueDay);
    if (day === "invalid") return { ok: false, error: "Due day must be 1–31." };
    patch.dueDay = day;
  }
  if (body.notes !== undefined) patch.notes = asString(body.notes);
  if (body.maturityDate !== undefined) {
    if (body.maturityDate == null || body.maturityDate === "") patch.maturityDate = null;
    else {
      const raw = asString(body.maturityDate).trim();
      if (!isIsoDate(raw)) return { ok: false, error: "Maturity date must be YYYY-MM-DD." };
      patch.maturityDate = raw;
    }
  }
  if (body.isArchived !== undefined) {
    const v = asBoolField(body.isArchived, false);
    if (v === "invalid") return { ok: false, error: "isArchived must be true or false." };
    patch.isArchived = v;
  }
  return { ok: true, value: patch };
}

function queryFlag(raw: string | undefined): boolean {
  return raw === "1" || raw === "true";
}

function knownCategory(db: AppDb, id: string): boolean {
  return listCategories(db).some((row) => row.id === id);
}

function knownAccount(db: AppDb, id: string): boolean {
  return listAccounts(db).some((row) => row.id === id);
}

type RecurringBody = {
  name?: unknown;
  categoryId?: unknown;
  frequency?: unknown;
  intervalMonths?: unknown;
  amount?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  active?: unknown;
  kind?: unknown;
  payFromAccountId?: unknown;
  autoPost?: unknown;
  notes?: unknown;
};

type OneTimeBody = {
  name?: unknown;
  categoryId?: unknown;
  expectedDate?: unknown;
  amount?: unknown;
  priority?: unknown;
  status?: unknown;
  kind?: unknown;
  payFromAccountId?: unknown;
  notes?: unknown;
};

type InflowBody = {
  name?: unknown;
  categoryId?: unknown;
  expectedDate?: unknown;
  amount?: unknown;
  isLiquid?: unknown;
  status?: unknown;
  notes?: unknown;
};

type BudgetBody = {
  cap?: unknown;
  applyToFuture?: unknown;
  note?: unknown;
};

function optionalIso(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, value: null };
  const raw = asString(value);
  if (!isIsoDate(raw)) return { ok: false, error: `${label} must be YYYY-MM-DD.` };
  return { ok: true, value: raw };
}

function requiredIso(value: unknown, label: string): { ok: true; value: string } | { ok: false; error: string } {
  const raw = asString(value);
  if (!isIsoDate(raw)) return { ok: false, error: `${label} must be YYYY-MM-DD.` };
  return { ok: true, value: raw };
}

function requiredPaiseAmount(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n = asPaiseField(value);
  if (n === "invalid" || n == null || n <= 0 || !isPaise(n)) {
    return { ok: false, error: "Amount must be positive integer paise." };
  }
  return { ok: true, value: n };
}

function optionalAccountId(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "payFromAccountId must be a string." };
  return { ok: true, value };
}

function parseRecurringWrite(
  body: RecurringBody,
  mode: "create" | "patch",
): { ok: true; value: NewRecurringInput | RecurringPatch } | { ok: false; error: string } {
  const patch: RecurringPatch = {};
  if (mode === "create" || body.name !== undefined) {
    const name = asString(body.name).trim();
    if (name === "") return { ok: false, error: "Name is required." };
    patch.name = name;
  }
  if (mode === "create" || body.categoryId !== undefined) {
    const categoryId = asString(body.categoryId);
    if (categoryId === "") return { ok: false, error: "Category is required." };
    patch.categoryId = categoryId;
  }
  if (mode === "create" || body.frequency !== undefined) {
    const frequency = asString(body.frequency);
    if (!isRecurringFrequency(frequency)) return { ok: false, error: "Unknown frequency." };
    patch.frequency = frequency as RecurringFrequency;
  }
  if (body.intervalMonths !== undefined) {
    if (body.intervalMonths == null || body.intervalMonths === "") patch.intervalMonths = null;
    else {
      const n = asFiniteNumber(body.intervalMonths);
      if (n == null || !Number.isInteger(n) || n < 1) {
        return { ok: false, error: "Every N months must be a positive integer." };
      }
      patch.intervalMonths = n;
    }
  }
  if (mode === "create" || body.amount !== undefined) {
    const amount = requiredPaiseAmount(body.amount);
    if (!amount.ok) return amount;
    patch.amount = amount.value;
  }
  if (mode === "create" || body.startDate !== undefined) {
    const start = optionalIso(body.startDate, "Start date");
    if (!start.ok) return start;
    patch.startDate = start.value;
  }
  if (mode === "create" || body.endDate !== undefined) {
    const end = optionalIso(body.endDate, "End date");
    if (!end.ok) return end;
    patch.endDate = end.value;
  }
  if (mode === "create" || body.active !== undefined) {
    const active = asBoolField(body.active, true);
    if (active === "invalid") return { ok: false, error: "active must be true or false." };
    patch.active = active;
  }
  if (mode === "create" || body.kind !== undefined) {
    if (body.kind == null || body.kind === "") patch.kind = null;
    else {
      const kind = asString(body.kind);
      if (!isRecurringKind(kind)) return { ok: false, error: "Unknown kind." };
      patch.kind = kind as RecurringKind;
    }
  }
  if (mode === "create" || body.payFromAccountId !== undefined) {
    const pay = optionalAccountId(body.payFromAccountId);
    if (!pay.ok) return pay;
    patch.payFromAccountId = pay.value;
  }
  if (mode === "create" || body.autoPost !== undefined) {
    const autoPost = asBoolField(body.autoPost, false);
    if (autoPost === "invalid") return { ok: false, error: "autoPost must be true or false." };
    patch.autoPost = autoPost;
  }
  if (mode === "create" || body.notes !== undefined) patch.notes = asString(body.notes);

  if (mode === "create") {
    const frequency = patch.frequency ?? "monthly";
    const interval =
      frequency === "custom_months" ? (patch.intervalMonths ?? null) : null;
    if (frequency === "custom_months" && (interval == null || interval < 1)) {
      return { ok: false, error: "Every N months is required for that frequency." };
    }
    return {
      ok: true,
      value: {
        name: patch.name ?? "",
        categoryId: patch.categoryId ?? "",
        frequency,
        intervalMonths: interval,
        amount: patch.amount ?? 0,
        startDate: patch.startDate ?? null,
        endDate: patch.endDate ?? null,
        active: patch.active ?? true,
        kind: patch.kind ?? null,
        payFromAccountId: patch.payFromAccountId ?? null,
        autoPost: patch.autoPost ?? false,
        notes: patch.notes ?? "",
      } satisfies NewRecurringInput,
    };
  }
  if (
    (patch.frequency === "custom_months" ||
      (patch.frequency == null && patch.intervalMonths != null)) &&
    patch.intervalMonths != null &&
    patch.intervalMonths < 1
  ) {
    return { ok: false, error: "Every N months must be a positive integer." };
  }
  return { ok: true, value: patch };
}

function parseOneTimeWrite(
  body: OneTimeBody,
  mode: "create" | "patch",
): { ok: true; value: NewOneTimeInput | OneTimePatch } | { ok: false; error: string } {
  const patch: OneTimePatch = {};
  if (mode === "create" || body.name !== undefined) {
    const name = asString(body.name).trim();
    if (name === "") return { ok: false, error: "Name is required." };
    patch.name = name;
  }
  if (mode === "create" || body.categoryId !== undefined) {
    const categoryId = asString(body.categoryId);
    if (categoryId === "") return { ok: false, error: "Category is required." };
    patch.categoryId = categoryId;
  }
  if (mode === "create" || body.expectedDate !== undefined) {
    const date = requiredIso(body.expectedDate, "Expected date");
    if (!date.ok) return date;
    patch.expectedDate = date.value;
  }
  if (mode === "create" || body.amount !== undefined) {
    const amount = requiredPaiseAmount(body.amount);
    if (!amount.ok) return amount;
    patch.amount = amount.value;
  }
  if (mode === "create" || body.priority !== undefined) {
    const priority = asString(body.priority || "medium");
    if (!isPlanPriority(priority)) return { ok: false, error: "Unknown priority." };
    patch.priority = priority as PlanPriority;
  }
  if (mode === "create" || body.status !== undefined) {
    const status = asString(body.status || "planned");
    if (!isOneTimeStatus(status)) return { ok: false, error: "Unknown status." };
    patch.status = status as OneTimeStatus;
  }
  if (mode === "create" || body.kind !== undefined) {
    if (body.kind == null || body.kind === "") patch.kind = null;
    else {
      const kind = asString(body.kind);
      if (!isRecurringKind(kind)) return { ok: false, error: "Unknown kind." };
      patch.kind = kind as RecurringKind;
    }
  }
  if (mode === "create" || body.payFromAccountId !== undefined) {
    const pay = optionalAccountId(body.payFromAccountId);
    if (!pay.ok) return pay;
    patch.payFromAccountId = pay.value;
  }
  if (mode === "create" || body.notes !== undefined) patch.notes = asString(body.notes);

  if (mode === "create") {
    return {
      ok: true,
      value: {
        name: patch.name ?? "",
        categoryId: patch.categoryId ?? "",
        expectedDate: patch.expectedDate ?? "",
        amount: patch.amount ?? 0,
        priority: patch.priority ?? "medium",
        status: patch.status ?? "planned",
        kind: patch.kind ?? null,
        payFromAccountId: patch.payFromAccountId ?? null,
        notes: patch.notes ?? "",
      } satisfies NewOneTimeInput,
    };
  }
  return { ok: true, value: patch };
}

function parseInflowWrite(
  body: InflowBody,
  mode: "create" | "patch",
): { ok: true; value: NewInflowInput | InflowPatch } | { ok: false; error: string } {
  const patch: InflowPatch = {};
  if (mode === "create" || body.name !== undefined) {
    const name = asString(body.name).trim();
    if (name === "") return { ok: false, error: "Name is required." };
    patch.name = name;
  }
  if (mode === "create" || body.categoryId !== undefined) {
    if (body.categoryId == null || body.categoryId === "") patch.categoryId = null;
    else if (typeof body.categoryId !== "string") {
      return { ok: false, error: "categoryId must be a string." };
    } else patch.categoryId = body.categoryId;
  }
  if (mode === "create" || body.expectedDate !== undefined) {
    const date = requiredIso(body.expectedDate, "Expected date");
    if (!date.ok) return date;
    patch.expectedDate = date.value;
  }
  if (mode === "create" || body.amount !== undefined) {
    const amount = requiredPaiseAmount(body.amount);
    if (!amount.ok) return amount;
    patch.amount = amount.value;
  }
  if (mode === "create" || body.isLiquid !== undefined) {
    const isLiquid = asBoolField(body.isLiquid, true);
    if (isLiquid === "invalid") return { ok: false, error: "isLiquid must be true or false." };
    patch.isLiquid = isLiquid;
  }
  if (mode === "create" || body.status !== undefined) {
    const status = asString(body.status || "expected");
    if (!isInflowStatus(status)) return { ok: false, error: "Unknown status." };
    patch.status = status as InflowStatus;
  }
  if (mode === "create" || body.notes !== undefined) patch.notes = asString(body.notes);

  if (mode === "create") {
    return {
      ok: true,
      value: {
        name: patch.name ?? "",
        categoryId: patch.categoryId ?? null,
        expectedDate: patch.expectedDate ?? "",
        amount: patch.amount ?? 0,
        isLiquid: patch.isLiquid ?? true,
        status: patch.status ?? "expected",
        notes: patch.notes ?? "",
      } satisfies NewInflowInput,
    };
  }
  return { ok: true, value: patch };
}

function catalogOk(
  db: AppDb,
  input: { categoryId?: string | null; payFromAccountId?: string | null },
): string | null {
  if (input.categoryId != null && input.categoryId !== "" && !knownCategory(db, input.categoryId)) {
    return "Unknown category.";
  }
  if (input.payFromAccountId != null && !knownAccount(db, input.payFromAccountId)) {
    return "Unknown pay-from account.";
  }
  return null;
}

function extraLedgerIssues(body: LedgerBody): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  if (body.inBudget != null && typeof body.inBudget !== "boolean") {
    issues.push({
      field: "inBudget",
      code: "in_budget_not_boolean",
      message: "inBudget must be true or false.",
    });
  }
  const sourceRaw = body.source == null ? "manual" : body.source;
  if (typeof sourceRaw !== "string" || !isLedgerSource(sourceRaw)) {
    issues.push({
      field: "source",
      code: "invalid_source",
      message: "Unknown ledger source.",
    });
  }
  const timeRaw = body.time == null || body.time === "" ? null : body.time;
  if (timeRaw != null && (typeof timeRaw !== "string" || !isClockTime(timeRaw))) {
    issues.push({
      field: "time",
      code: "invalid_time",
      message: "Time must be HH:mm (24-hour).",
    });
  }
  return issues;
}

function monthPayload(db: AppDb, month: string) {
  const books = loadBooks(db);
  const cap = resolveBudgetCap(month, books.monthBudgets, books.settings.defaultBudget);
  const pace = budgetPace(month, books.entries, cap, books.today);
  const summary = monthSummary(month, books.entries, books.categories);
  const freeCash = freeToAllocate(toFreeCashBooks(books));
  return { month, today: books.today, pace, summary, freeCash };
}

function addLedger(db: AppDb, input: NewLedgerInput, id?: string) {
  const books = loadBooks(db);
  const result = validateLedgerEntry(
    {
      date: input.date,
      time: input.time ?? undefined,
      type: input.type,
      amount: input.amount,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      categoryId: input.categoryId,
    },
    { accounts: books.accounts, categories: books.categories },
  );
  if (!result.ok) return { ok: false as const, issues: result.issues };
  if (!id && input.goalId) {
    if (!getGoal(db, input.goalId)) {
      return {
        ok: false as const,
        issues: [
          {
            field: "goalId",
            code: "unknown_goal",
            message: "Unknown goal.",
          } satisfies LedgerIssue,
        ],
      };
    }
  }
  let entry: ReturnType<typeof insertLedgerEntry> | null;
  try {
    entry = db.transaction((tx) => {
      const row = id
        ? updateLedgerEntry(tx, id, input)
        : insertLedgerEntry(tx, input);
      if (!row) return null;
      if (!id && input.goalId) contributeFromLedger(tx, row);
      return row;
    });
  } catch (err) {
    if (err instanceof GoalWriteError) {
      return {
        ok: false as const,
        issues: [
          {
            field: "goalId",
            code: "goal",
            message: err.message,
          } satisfies LedgerIssue,
        ],
      };
    }
    throw err;
  }
  if (!entry) return { ok: false as const, issues: result.issues, notFound: true };
  const month = yearMonthFromIsoDate(entry.date);
  return { ok: true as const, entry, ...monthPayload(db, month) };
}

function postLedgerFromBody(
  db: AppDb,
  body: LedgerBody,
  existing?: { id: string; source: string },
) {
  const extra = extraLedgerIssues({
    ...body,
    source: existing?.source ?? body.source,
  });
  const books = loadBooks(db);
  const date = asString(body.date);
  const type = asString(body.type);
  const fromAccountId = asString(body.fromAccountId);
  const toAccountId = asString(body.toAccountId);
  const categoryId = asString(body.categoryId);
  const amount = typeof body.amount === "number" ? body.amount : Number.NaN;
  const time =
    body.time == null || body.time === "" ? null : asString(body.time);
  const engine = validateLedgerEntry(
    {
      date,
      time: time ?? undefined,
      type: type as LedgerType,
      amount,
      fromAccountId,
      toAccountId,
      categoryId,
    },
    { accounts: books.accounts, categories: books.categories },
  );
  const issues = [...extra, ...engine.issues];
  if (issues.length > 0 || !isLedgerType(type) || !isPaise(amount)) {
    return { ok: false as const, issues };
  }
  const source = existing?.source ?? (body.source == null ? "manual" : asString(body.source));
  if (!isLedgerSource(source)) {
    return { ok: false as const, issues };
  }
  const category = books.categories.find((row) => row.id === categoryId);
  const inBudget =
    typeof body.inBudget === "boolean"
      ? body.inBudget
      : (category?.defaultInBudget ?? true);
  const goalIdRaw = asString(body.goalId).trim();
  return addLedger(
    db,
    {
      date,
      time,
      type,
      amount,
      fromAccountId,
      toAccountId,
      categoryId,
      inBudget,
      notes: asString(body.notes),
      source,
      goalId: goalIdRaw === "" ? null : goalIdRaw,
    },
    existing?.id,
  );
}

type CategoryBody = {
  name?: unknown;
  group?: unknown;
  defaultInBudget?: unknown;
  isEssential?: unknown;
  isArchived?: unknown;
};

type SettingsBody = {
  defaultBudget?: unknown;
  monthlySalary?: unknown;
  essentialIds?: unknown;
  blurDefault?: unknown;
  autoLockSeconds?: unknown;
};

type PinBody = {
  pin?: unknown;
  currentPin?: unknown;
};

function parseNewCategory(
  body: CategoryBody,
): { ok: true; value: NewCategoryInput } | { ok: false; error: string } {
  const name = asString(body.name).trim();
  if (name === "") return { ok: false, error: "Name is required." };
  const group = asString(body.group).trim() || "Other";
  const defaultInBudget = asBoolField(body.defaultInBudget, true);
  if (defaultInBudget === "invalid") {
    return { ok: false, error: "defaultInBudget must be true or false." };
  }
  const isEssential = asBoolField(body.isEssential, false);
  if (isEssential === "invalid") {
    return { ok: false, error: "isEssential must be true or false." };
  }
  return { ok: true, value: { name, group, defaultInBudget, isEssential } };
}

function parseCategoryPatch(
  body: CategoryBody,
): { ok: true; value: CategoryPatch } | { ok: false; error: string } {
  const patch: CategoryPatch = {};
  if (body.name !== undefined) {
    const name = asString(body.name).trim();
    if (name === "") return { ok: false, error: "Name is required." };
    patch.name = name;
  }
  if (body.group !== undefined) {
    patch.group = asString(body.group).trim() || "Other";
  }
  if (body.defaultInBudget !== undefined) {
    const v = asBoolField(body.defaultInBudget, true);
    if (v === "invalid") return { ok: false, error: "defaultInBudget must be true or false." };
    patch.defaultInBudget = v;
  }
  if (body.isEssential !== undefined) {
    const v = asBoolField(body.isEssential, false);
    if (v === "invalid") return { ok: false, error: "isEssential must be true or false." };
    patch.isEssential = v;
  }
  if (body.isArchived !== undefined) {
    const v = asBoolField(body.isArchived, false);
    if (v === "invalid") return { ok: false, error: "isArchived must be true or false." };
    patch.isArchived = v;
  }
  return { ok: true, value: patch };
}

function parseMoneyPatch(
  body: SettingsBody,
): { ok: true; value: MoneyPatch } | { ok: false; error: string } {
  const patch: MoneyPatch = {};
  if (body.defaultBudget !== undefined) {
    const n = asPaiseField(body.defaultBudget);
    if (n === "invalid" || n == null || n <= 0) {
      return { ok: false, error: "Default budget must be positive integer paise." };
    }
    patch.defaultBudget = n;
  }
  if (body.monthlySalary !== undefined) {
    const n = asPaiseField(body.monthlySalary);
    if (n === "invalid" || n == null || n < 0) {
      return { ok: false, error: "Salary must be integer paise." };
    }
    patch.monthlySalary = n;
  }
  return { ok: true, value: patch };
}

export function createApp(opts: CreateAppOptions): Hono {
  const { db, sqlite, dbFile, serveUi = false } = opts;
  const auth = opts.auth ?? authFromEnv();
  const allowDevRoutes =
    opts.allowDevRoutes ??
    (process.env.FINANCE_DEV_ROUTES === "1" ||
      (process.env.NODE_ENV !== "production" &&
        process.env.FINANCE_DEV_ROUTES !== "0"));
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") {
      await next();
      return;
    }
    const login = tailscaleLoginFromHeaders((name) => c.req.header(name));
    const denied = denyReason(login, auth);
    if (denied) return c.json({ ok: false, error: denied }, 401);
    await next();
  });

  app.get("/api/health", (c) => {
    return c.json({
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      dbFile,
      lastBackup: lastBackupAt(db),
      lastImport: getMeta(db, "last_import_at"),
    });
  });

  app.get("/api/books", (c) => {
    const since = c.req.query("since");
    if (since != null && since !== "" && !isIsoDate(since)) {
      return c.json({ ok: false, error: "since must be YYYY-MM-DD" }, 400);
    }
    const books = loadBooks(db, todayIst(), since || undefined);
    return c.json({ ok: true, books });
  });

  app.post("/api/ledger", async (c) => {
    let body: LedgerBody;
    try {
      body = (await c.req.json()) as LedgerBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const added = postLedgerFromBody(db, body);
    if (!added.ok) return c.json({ ok: false, issues: added.issues }, 400);
    return c.json(added, 201);
  });

  app.get("/api/ledger", (c) => {
    const monthRaw = c.req.query("month") ?? yearMonthFromIsoDate(todayIst());
    if (!isYearMonth(monthRaw)) {
      return c.json({ ok: false, error: "month must be YYYY-MM" }, 400);
    }
    return c.json({
      ok: true,
      month: monthRaw,
      today: todayIst(),
      entries: listLedgerEntriesForMonth(db, monthRaw),
      accounts: listAccounts(db),
      categories: listCategories(db),
    });
  });

  app.get("/api/ledger/:id", (c) => {
    const entry = getLedgerEntry(db, c.req.param("id"));
    if (!entry) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({
      ok: true,
      today: todayIst(),
      entry,
      accounts: listAccounts(db),
      categories: listCategories(db),
    });
  });

  app.patch("/api/ledger/:id", async (c) => {
    const id = c.req.param("id");
    const existing = getLedgerEntry(db, id);
    if (!existing) return c.json({ ok: false, error: "not found" }, 404);
    let body: LedgerBody;
    try {
      body = (await c.req.json()) as LedgerBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const patched = postLedgerFromBody(
      db,
      { ...body, source: existing.source },
      { id, source: existing.source },
    );
    if (!patched.ok) {
      if ("notFound" in patched && patched.notFound) {
        return c.json({ ok: false, error: "not found" }, 404);
      }
      return c.json({ ok: false, issues: patched.issues }, 400);
    }
    return c.json(patched);
  });

  app.delete("/api/ledger/:id", (c) => {
    const removed = softDeleteLedgerEntry(db, c.req.param("id"));
    if (!removed) return c.json({ ok: false, error: "not found" }, 404);
    const month = yearMonthFromIsoDate(removed.date);
    return c.json({ ok: true, id: removed.id, ...monthPayload(db, month) });
  });

  app.get("/api/month/:yyyymm", (c) => {
    const month = c.req.param("yyyymm");
    if (!isYearMonth(month)) {
      return c.json({ ok: false, error: "month must be YYYY-MM" }, 400);
    }
    return c.json({ ok: true, ...monthPayload(db, month) });
  });

  app.get("/api/home", (c) => {
    return c.json({ ok: true, ...buildHome(db) });
  });

  app.get("/api/plan", (c) => {
    const monthRaw = c.req.query("month");
    if (monthRaw != null && monthRaw !== "" && !isYearMonth(monthRaw)) {
      return c.json({ ok: false, error: "month must be YYYY-MM" }, 400);
    }
    return c.json({
      ok: true,
      ...buildPlan(db, {
        month: monthRaw && isYearMonth(monthRaw) ? monthRaw : undefined,
        assumeInflows: queryFlag(c.req.query("assumeInflows")),
      }),
    });
  });

  app.get("/api/forecast", (c) => {
    const monthsRaw = c.req.query("months");
    let months = 6;
    if (monthsRaw != null && monthsRaw !== "") {
      const n = Number(monthsRaw);
      if (!Number.isInteger(n) || n < 1 || n > 24) {
        return c.json({ ok: false, error: "months must be 1–24" }, 400);
      }
      months = n;
    }
    return c.json({
      ok: true,
      forecast: buildForecast(db, {
        months,
        assumeInflows: queryFlag(c.req.query("assumeInflows")),
      }),
    });
  });

  app.put("/api/budgets/:yyyymm", async (c) => {
    const month = c.req.param("yyyymm");
    if (!isYearMonth(month)) {
      return c.json({ ok: false, error: "month must be YYYY-MM" }, 400);
    }
    let body: BudgetBody;
    try {
      body = (await c.req.json()) as BudgetBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const cap = requiredPaiseAmount(body.cap);
    if (!cap.ok) return c.json({ ok: false, error: cap.error }, 400);
    const apply = asBoolField(body.applyToFuture, false);
    if (apply === "invalid") {
      return c.json({ ok: false, error: "applyToFuture must be true or false." }, 400);
    }
    const budget = upsertMonthBudget(db, month, cap.value, asString(body.note), apply);
    return c.json({ ok: true, budget, ...buildPlan(db, { month }) });
  });

  app.get("/api/plans/recurring", (c) => {
    return c.json({ ok: true, recurring: listRecurringPlans(db) });
  });

  app.post("/api/plans/recurring", async (c) => {
    let body: RecurringBody;
    try {
      body = (await c.req.json()) as RecurringBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseRecurringWrite(body, "create");
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    const input = parsed.value as NewRecurringInput;
    const bad = catalogOk(db, input);
    if (bad) return c.json({ ok: false, error: bad }, 400);
    insertRecurringPlan(db, input);
    return c.json({ ok: true, ...buildPlan(db) }, 201);
  });

  app.patch("/api/plans/recurring/:id", async (c) => {
    let body: RecurringBody;
    try {
      body = (await c.req.json()) as RecurringBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseRecurringWrite(body, "patch");
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    const patch = parsed.value as RecurringPatch;
    const bad = catalogOk(db, patch);
    if (bad) return c.json({ ok: false, error: bad }, 400);
    const recurring = updateRecurringPlan(db, c.req.param("id"), patch);
    if (!recurring) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, ...buildPlan(db) });
  });

  app.delete("/api/plans/recurring/:id", (c) => {
    const removed = deleteRecurringPlan(db, c.req.param("id"));
    if (!removed) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, id: removed.id, ...buildPlan(db) });
  });

  app.get("/api/plans/one-time", (c) => {
    return c.json({ ok: true, oneTime: listOneTimePlans(db) });
  });

  app.post("/api/plans/one-time", async (c) => {
    let body: OneTimeBody;
    try {
      body = (await c.req.json()) as OneTimeBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseOneTimeWrite(body, "create");
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    const input = parsed.value as NewOneTimeInput;
    const bad = catalogOk(db, input);
    if (bad) return c.json({ ok: false, error: bad }, 400);
    insertOneTimePlan(db, input);
    return c.json({ ok: true, ...buildPlan(db) }, 201);
  });

  app.patch("/api/plans/one-time/:id", async (c) => {
    let body: OneTimeBody;
    try {
      body = (await c.req.json()) as OneTimeBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseOneTimeWrite(body, "patch");
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    const patch = parsed.value as OneTimePatch;
    const bad = catalogOk(db, patch);
    if (bad) return c.json({ ok: false, error: bad }, 400);
    const oneTime = updateOneTimePlan(db, c.req.param("id"), patch);
    if (!oneTime) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, ...buildPlan(db) });
  });

  app.delete("/api/plans/one-time/:id", (c) => {
    const removed = deleteOneTimePlan(db, c.req.param("id"));
    if (!removed) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, id: removed.id, ...buildPlan(db) });
  });

  app.get("/api/plans/inflows", (c) => {
    return c.json({ ok: true, inflows: listExpectedInflows(db) });
  });

  app.post("/api/plans/inflows", async (c) => {
    let body: InflowBody;
    try {
      body = (await c.req.json()) as InflowBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseInflowWrite(body, "create");
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    const input = parsed.value as NewInflowInput;
    const bad = catalogOk(db, { categoryId: input.categoryId });
    if (bad) return c.json({ ok: false, error: bad }, 400);
    insertExpectedInflow(db, input);
    return c.json({ ok: true, ...buildPlan(db) }, 201);
  });

  app.patch("/api/plans/inflows/:id", async (c) => {
    let body: InflowBody;
    try {
      body = (await c.req.json()) as InflowBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseInflowWrite(body, "patch");
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    const patch = parsed.value as InflowPatch;
    const bad = catalogOk(db, { categoryId: patch.categoryId });
    if (bad) return c.json({ ok: false, error: bad }, 400);
    const inflow = updateExpectedInflow(db, c.req.param("id"), patch);
    if (!inflow) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, ...buildPlan(db) });
  });

  app.delete("/api/plans/inflows/:id", (c) => {
    const removed = deleteExpectedInflow(db, c.req.param("id"));
    if (!removed) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, id: removed.id, ...buildPlan(db) });
  });

  app.post("/api/import/finance", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.parseBody()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: "expected multipart form with file" }, 400);
    }
    const file = body.file;
    if (!(file instanceof Blob)) {
      return c.json({ ok: false, error: "xlsx file required (field name file)" }, 400);
    }
    const filename = file instanceof File && file.name ? file.name : "upload.xlsx";
    if (!filename.toLowerCase().endsWith(".xlsx")) {
      return c.json({ ok: false, error: "file must be .xlsx" }, 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength === 0) {
      return c.json({ ok: false, error: "file is empty" }, 400);
    }
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ ok: false, error: "file is larger than 8 MB" }, 400);
    }
    const replace = body.replace === "true" || body.replace === "1";
    try {
      const parsed = parseFinanceWorkbook(buf);
      const report = applyFinanceImport(db, parsed, {
        replace,
        filename,
        fileSha: sha256Hex(buf),
      });
      return c.json({ ok: true, report });
    } catch (err) {
      if (err instanceof ImportError) {
        return c.json({ ok: false, error: err.message, details: err.details }, 400);
      }
      const message = err instanceof Error ? err.message : "import failed";
      return c.json({ ok: false, error: message }, 500);
    }
  });

  app.post("/api/import/invest", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.parseBody()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: "expected multipart form with file" }, 400);
    }
    const file = body.file;
    if (!(file instanceof Blob)) {
      return c.json({ ok: false, error: "xlsx file required (field name file)" }, 400);
    }
    const filename = file instanceof File && file.name ? file.name : "upload.xlsx";
    if (!filename.toLowerCase().endsWith(".xlsx")) {
      return c.json({ ok: false, error: "file must be .xlsx" }, 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength === 0) {
      return c.json({ ok: false, error: "file is empty" }, 400);
    }
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ ok: false, error: "file is larger than 8 MB" }, 400);
    }
    const replace = body.replace === "true" || body.replace === "1" || body.replace == null;
    try {
      const parsed = parseInvestWorkbook(buf);
      const report = applyInvestImport(db, parsed, { replace, filename });
      return c.json({ ok: true, report });
    } catch (err) {
      if (err instanceof ImportError) {
        return c.json({ ok: false, error: err.message, details: err.details }, 400);
      }
      const message = err instanceof Error ? err.message : "import failed";
      return c.json({ ok: false, error: message }, 500);
    }
  });

  app.get("/api/engine-summary", (c) => {
    return c.json({ ok: true, summary: buildEngineSummary(db) });
  });

  app.get("/api/wealth", (c) => {
    return c.json({ ok: true, ...buildWealth(db) });
  });

  app.get("/api/buckets", (c) => {
    const wealth = buildWealth(db);
    return c.json({
      ok: true,
      buckets: wealth.buckets,
      linkableAccounts: wealth.linkableAccounts,
      free: wealth.free,
      essentialsAverage: wealth.essentialsAverage,
      example: wealth.example,
    });
  });

  app.put("/api/buckets", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseBucketWrites(body);
    if (!parsed.ok) {
      return c.json({ ok: false, error: parsed.error, issues: parsed.issues ?? [] }, 400);
    }
    try {
      saveBuckets(db, parsed.value);
      return c.json({ ok: true, ...buildWealth(db) });
    } catch (err) {
      if (err instanceof BucketWriteError) {
        return c.json({ ok: false, error: err.message, issues: err.issues }, 400);
      }
      const message = err instanceof Error ? err.message : "could not save buckets";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/allocation", (c) => {
    return c.json({ ok: true, ...buildAllocation(db) });
  });

  app.post("/api/allocation/run", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    if (body == null || typeof body !== "object") {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const rec = body as Record<string, unknown>;
    const surplus = asFiniteNumber(rec.surplusInput);
    if (surplus == null || !isPaise(surplus)) {
      return c.json({ ok: false, error: "surplusInput must be integer paise." }, 400);
    }
    const confirm = rec.confirm === true;
    const reason =
      rec.overrideReason == null || rec.overrideReason === ""
        ? null
        : asString(rec.overrideReason);
    try {
      const confirmLines = confirm ? parseConfirmLines(rec.lines) : [];
      const proposed = confirm
        ? confirmLines.map((row) => ({ bucketId: row.bucketId, amount: row.amount }))
        : parseProposedLines(rec.lines);
      const liveFree = buildAllocation(db).freeCash.free;
      const run = saveAllocationRun(
        db,
        {
          surplusInput: surplus,
          overrideReason: reason,
          proposed,
          confirm,
          confirmLines,
        },
        liveFree,
      );
      return c.json({ ok: true, run, ...buildAllocation(db) }, 201);
    } catch (err) {
      if (err instanceof AllocationWriteError) {
        return c.json(
          { ok: false, error: err.message, issues: err.issues },
          err.status,
        );
      }
      const message = err instanceof Error ? err.message : "could not save allocation";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/allocation/:id", (c) => {
    const run = getAllocationRun(db, c.req.param("id"));
    if (!run) return c.json({ ok: false, error: "Allocation run not found." }, 404);
    return c.json({ ok: true, run, ...buildAllocation(db) });
  });

  app.post("/api/allocation/:id/confirm", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    if (body == null || typeof body !== "object") {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const rec = body as Record<string, unknown>;
    try {
      const lines = parseConfirmLines(rec.lines);
      const liveFree = buildAllocation(db).freeCash.free;
      const run = confirmAllocationRun(db, c.req.param("id"), lines, liveFree);
      return c.json({ ok: true, run, ...buildAllocation(db) });
    } catch (err) {
      if (err instanceof AllocationWriteError) {
        return c.json(
          { ok: false, error: err.message, issues: err.issues },
          err.status,
        );
      }
      const message = err instanceof Error ? err.message : "could not confirm allocation";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/invest/plan", (c) => {
    return c.json({ ok: true, plan: getCurrentInvestPlan(db) });
  });

  app.get("/api/invest", (c) => {
    return c.json({ ok: true, ...buildInvest(db) });
  });

  app.put("/api/invest/plan", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const draft = parseInvestPlanBody(body);
      saveInvestPlanVersion(db, draft);
      return c.json({ ok: true, ...buildInvest(db) });
    } catch (err) {
      if (err instanceof InvestWriteError) {
        return c.json(
          { ok: false, error: err.message, issues: err.issues },
          err.status,
        );
      }
      const message = err instanceof Error ? err.message : "could not save invest plan";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/invest/split", (c) => {
    const raw = c.req.query("amount");
    const amount = asFiniteNumber(raw);
    if (amount == null || !isPaise(amount)) {
      return c.json({ ok: false, error: "amount must be integer paise." }, 400);
    }
    const plan = getCurrentInvestPlan(db);
    if (!plan) return c.json({ ok: false, error: "No invest plan is saved yet." }, 404);
    try {
      const split = splitInvest(amount, plan);
      return c.json({ ok: true, split, plan });
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not split";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/portfolio", (c) => {
    const range = parseHistoryRange(c.req.query("range"));
    return c.json({ ok: true, ...buildPortfolio(db, range) });
  });

  app.get("/api/portfolio/:id", (c) => {
    const detail = buildHoldingDetail(db, c.req.param("id"));
    if (!detail) return c.json({ ok: false, error: "Holding not found." }, 404);
    return c.json({ ok: true, ...detail });
  });

  app.post("/api/holdings", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const parsed = parseHoldingBody(body);
      const holding = insertHolding(db, parsed);
      return c.json({ ok: true, holding, ...buildPortfolio(db) }, 201);
    } catch (err) {
      if (err instanceof HoldingWriteError) {
        return c.json({ ok: false, error: err.message, issues: err.issues }, err.status);
      }
      const message = err instanceof Error ? err.message : "could not create holding";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.patch("/api/holdings/:id", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const parsed = parseNavBody(body);
      updateHoldingNav(db, c.req.param("id"), parsed);
      takeSnapshot(db);
      const detail = buildHoldingDetail(db, c.req.param("id"));
      return c.json({ ok: true, ...detail, ...buildPortfolio(db) });
    } catch (err) {
      if (err instanceof HoldingWriteError) {
        return c.json({ ok: false, error: err.message, issues: err.issues }, err.status);
      }
      const message = err instanceof Error ? err.message : "could not update NAV";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.post("/api/holdings/:id/txns", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const parsed = parseHoldingTxnBody(body);
      const txn = recordHoldingTxn(db, c.req.param("id"), parsed);
      takeSnapshot(db);
      const detail = buildHoldingDetail(db, c.req.param("id"));
      return c.json({ ok: true, txn, ...detail, ...buildPortfolio(db) }, 201);
    } catch (err) {
      if (err instanceof HoldingWriteError) {
        return c.json({ ok: false, error: err.message, issues: err.issues }, err.status);
      }
      const message = err instanceof Error ? err.message : "could not record holding txn";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.post("/api/snapshots", (c) => {
    const daily = takeSnapshot(db);
    return c.json({
      ok: true,
      snapshot: daily,
      history: buildPortfolio(db).history,
      netWorth: daily.assets - daily.liabilities,
    });
  });

  app.get("/api/networth/history", (c) => {
    const range = parseHistoryRange(c.req.query("range"));
    const payload = buildPortfolio(db, range);
    return c.json({ ok: true, today: payload.today, history: payload.history, range });
  });

  app.post("/api/invest/dip-buy", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const parsed = parseDipBuyBody(body);
      const result = deployDip(db, parsed);
      takeSnapshot(db);
      return c.json({ ok: true, ...result, ...buildInvest(db) }, 201);
    } catch (err) {
      if (err instanceof InvestWriteError) {
        return c.json(
          { ok: false, error: err.message, issues: err.issues },
          err.status,
        );
      }
      const message = err instanceof Error ? err.message : "could not deploy dip reserve";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/goals", (c) => {
    return c.json({ ok: true, ...buildGoals(db) });
  });

  app.post("/api/goals", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const parsed = parseCreateGoal(body);
      const created = insertGoal(db, parsed);
      const payload = buildGoals(db);
      const goal = payload.goals.find((row) => row.id === created.id) ?? created;
      return c.json({ ok: true, goal, ...payload }, 201);
    } catch (err) {
      if (err instanceof GoalWriteError) {
        return c.json({ ok: false, error: err.message }, err.status);
      }
      const message = err instanceof Error ? err.message : "could not create goal";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.put("/api/goals/order", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      reorderGoals(db, parseGoalOrder(body));
      return c.json({ ok: true, ...buildGoals(db) });
    } catch (err) {
      if (err instanceof GoalWriteError) {
        return c.json({ ok: false, error: err.message }, err.status);
      }
      const message = err instanceof Error ? err.message : "could not reorder goals";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.patch("/api/goals/:id", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const updated = updateGoal(db, c.req.param("id"), parsePatchGoal(body));
      if (!updated) return c.json({ ok: false, error: "not found" }, 404);
      const payload = buildGoals(db);
      const goal = payload.goals.find((row) => row.id === updated.id) ?? updated;
      return c.json({ ok: true, goal, ...payload });
    } catch (err) {
      if (err instanceof GoalWriteError) {
        return c.json({ ok: false, error: err.message }, err.status);
      }
      const message = err instanceof Error ? err.message : "could not update goal";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.post("/api/goals/:id/contribute", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const parsed = parseContributeBody(body, todayIst());
      const contribution = insertContribution(db, {
        goalId: c.req.param("id"),
        ledgerEntryId: null,
        ...parsed,
      });
      const payload = buildGoals(db);
      return c.json({ ok: true, contribution, ...payload }, 201);
    } catch (err) {
      if (err instanceof GoalWriteError) {
        return c.json({ ok: false, error: err.message }, err.status);
      }
      const message = err instanceof Error ? err.message : "could not record contribution";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.post("/api/seed/invest", (c) => {
    const report = seedDefaultInvestSide(db);
    return c.json({ ok: true, report });
  });

  app.put("/api/seed/invest", async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const patch = seedPatchFromBody(body);
      db.transaction((tx) => {
        ensureDefaultBuckets(tx);
        tagDefaultAccountBuckets(tx);
        applySeedTargets(tx, patch);
      });
      return c.json({ ok: true, summary: buildEngineSummary(db) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "seed failed";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/accounts/balances", (c) => {
    const today = todayIst();
    const { rows, liquid } = listAccountBalanceRows(db, today);
    return c.json({
      ok: true,
      today,
      liquid,
      accounts: rows,
      buckets: listBucketOptions(db),
    });
  });

  app.get("/api/accounts", (c) => {
    const today = todayIst();
    const { rows, liquid } = listAccountBalanceRows(db, today);
    return c.json({
      ok: true,
      today,
      liquid,
      accounts: rows,
      buckets: listBucketOptions(db),
    });
  });

  app.get("/api/accounts/:id", (c) => {
    const detail = getAccountDetail(db, c.req.param("id"));
    if (!detail) return c.json({ ok: false, error: "not found" }, 404);
    return c.json({ ok: true, ...detail });
  });

  app.post("/api/accounts", async (c) => {
    let body: AccountBody;
    try {
      body = (await c.req.json()) as AccountBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseNewAccount(body);
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    try {
      const account = insertAccount(db, parsed.value);
      const today = todayIst();
      const { rows, liquid } = listAccountBalanceRows(db, today);
      return c.json({ ok: true, account, liquid, accounts: rows, today }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not create account";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.patch("/api/accounts/:id", async (c) => {
    const id = c.req.param("id");
    let body: AccountBody;
    try {
      body = (await c.req.json()) as AccountBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseAccountPatch(body);
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    try {
      const account = updateAccount(db, id, parsed.value);
      if (!account) return c.json({ ok: false, error: "not found" }, 404);
      const today = todayIst();
      const { liquid } = listAccountBalanceRows(db, today);
      const detail = getAccountDetail(db, id, today);
      return c.json({ ok: true, account, liquid, detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not update account";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.post("/api/reconcile", async (c) => {
    let body: ReconcileBody;
    try {
      body = (await c.req.json()) as ReconcileBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const accountId = asString(body.accountId);
    if (accountId === "") return c.json({ ok: false, error: "accountId is required." }, 400);
    const actual = asPaiseField(body.actualBalance);
    if (actual === "invalid" || actual == null) {
      return c.json({ ok: false, error: "actualBalance must be integer paise." }, 400);
    }
    const resolutionRaw = asString(body.resolution) || "none";
    if (resolutionRaw !== "none" && resolutionRaw !== "adjustment") {
      return c.json({ ok: false, error: "resolution must be none or adjustment." }, 400);
    }
    const resolution = resolutionRaw as ReconcileWriteResolution;
    const result = postReconcile(db, {
      accountId,
      actualBalance: actual,
      resolution,
      notes: asString(body.notes),
    });
    if (!result.ok) {
      const status = result.error === "account not found" ? 404 : 400;
      return c.json({ ok: false, error: result.error, issues: result.issues }, status);
    }
    const month = yearMonthFromIsoDate(todayIst());
    return c.json({
      ok: true,
      reconciliation: result.reconciliation,
      entry: result.entry,
      account: result.account,
      balance: result.balance,
      liquid: result.liquid,
      ...monthPayload(db, month),
    });
  });

  app.get("/api/categories", (c) => {
    return c.json({ ok: true, categories: listCategoryRows(db) });
  });

  app.post("/api/categories", async (c) => {
    let body: CategoryBody;
    try {
      body = (await c.req.json()) as CategoryBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseNewCategory(body);
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    try {
      const category = insertCategory(db, parsed.value);
      return c.json({ ok: true, category, categories: listCategoryRows(db) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not create category";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.patch("/api/categories/:id", async (c) => {
    let body: CategoryBody;
    try {
      body = (await c.req.json()) as CategoryBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const parsed = parseCategoryPatch(body);
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
    try {
      const category = updateCategory(db, c.req.param("id"), parsed.value);
      if (!category) return c.json({ ok: false, error: "not found" }, 404);
      return c.json({ ok: true, category, categories: listCategoryRows(db) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not update category";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/lock", (c) => {
    const login = tailscaleLoginFromHeaders((name) => c.req.header(name));
    return c.json({
      ok: true,
      ...getLockStatus(db),
      identity: { required: auth.requireTailscale, login },
    });
  });

  app.post("/api/lock/unlock", async (c) => {
    let body: PinBody;
    try {
      body = (await c.req.json()) as PinBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const pin = asString(body.pin);
    if (!unlockWithPin(db, pin)) {
      return c.json({ ok: false, error: "Wrong PIN." }, 401);
    }
    return c.json({ ok: true, unlocked: true });
  });

  app.get("/api/settings", (c) => {
    const login = tailscaleLoginFromHeaders((name) => c.req.header(name));
    const money = getMoneySettings(db);
    const lock = getLockStatus(db);
    const cats = listCategoryRows(db);
    return c.json({
      ok: true,
      money,
      lock,
      categories: cats,
      essentialIds: cats.filter((row) => row.isEssential).map((row) => row.id),
      identity: { required: auth.requireTailscale, login },
    });
  });

  app.put("/api/settings", async (c) => {
    let body: SettingsBody;
    try {
      body = (await c.req.json()) as SettingsBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    try {
      const moneyParsed = parseMoneyPatch(body);
      if (!moneyParsed.ok) return c.json({ ok: false, error: moneyParsed.error }, 400);
      if (Object.keys(moneyParsed.value).length > 0) {
        updateMoneySettings(db, moneyParsed.value);
      }
      if (body.essentialIds !== undefined) {
        if (!Array.isArray(body.essentialIds) || body.essentialIds.some((id) => typeof id !== "string")) {
          return c.json({ ok: false, error: "essentialIds must be a list of category ids." }, 400);
        }
        setEssentialIds(db, body.essentialIds);
      }
      if (body.blurDefault !== undefined) {
        const v = asBoolField(body.blurDefault, false);
        if (v === "invalid") return c.json({ ok: false, error: "blurDefault must be true or false." }, 400);
        setBlurDefault(db, v);
      }
      if (body.autoLockSeconds !== undefined) {
        const n = asFiniteNumber(body.autoLockSeconds);
        if (n == null || !Number.isInteger(n)) {
          return c.json({ ok: false, error: "Unknown auto-lock interval." }, 400);
        }
        setAutoLockSeconds(db, n);
      }
      const login = tailscaleLoginFromHeaders((name) => c.req.header(name));
      const money = getMoneySettings(db);
      const lock = getLockStatus(db);
      const cats = listCategoryRows(db);
      return c.json({
        ok: true,
        money,
        lock,
        categories: cats,
        essentialIds: cats.filter((row) => row.isEssential).map((row) => row.id),
        identity: { required: auth.requireTailscale, login },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not save settings";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.post("/api/settings/pin", async (c) => {
    let body: PinBody;
    try {
      body = (await c.req.json()) as PinBody;
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const pin = asString(body.pin);
    const current = body.currentPin == null || body.currentPin === "" ? null : asString(body.currentPin);
    try {
      const lock = setPin(db, pin, current);
      return c.json({ ok: true, lock });
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not set PIN";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.delete("/api/settings/pin", async (c) => {
    let body: PinBody = {};
    try {
      body = (await c.req.json()) as PinBody;
    } catch {
      return c.json({ ok: false, error: "Current PIN is required." }, 400);
    }
    try {
      const lock = clearPin(db, asString(body.currentPin));
      return c.json({ ok: true, lock });
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not clear PIN";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/export.sqlite", (c) => {
    const dir = mkdtempSync(join(tmpdir(), "finance-export-"));
    const dest = join(dir, "finance.sqlite");
    try {
      vacuumInto(sqlite, dest);
      const bytes = readFileSync(dest);
      return c.body(bytes, 200, {
        "content-type": "application/vnd.sqlite3",
        "content-disposition": 'attachment; filename="finance.sqlite"',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  app.get("/api/dev/counts", (c) => {
    return c.json({ ok: true, counts: storeCounts(db) });
  });

  if (allowDevRoutes) {
    app.post("/api/dev/dummy-expense", (c) => {
      const added = addLedger(db, {
        date: todayIst(),
        time: nowTimeIst(),
        type: "expense",
        amount: DUMMY_EXPENSE_PAISE,
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: DUMMY_EXPENSE_NOTES,
        source: "manual",
      });
      if (!added.ok) return c.json({ ok: false, issues: added.issues }, 400);
      return c.json(added, 201);
    });

    app.post("/api/dev/wipe", async (c) => {
      let body: { confirm?: unknown } = {};
      try {
        body = (await c.req.json()) as { confirm?: unknown };
      } catch {
        return c.json({ ok: false, error: "type wipe to confirm" }, 400);
      }
      if (body.confirm !== "wipe") {
        return c.json({ ok: false, error: "type wipe to confirm" }, 400);
      }
      wipeAll(db);
      seedCatalog(db);
      return c.json({ ok: true, counts: storeCounts(db) });
    });
  }

  const handler = new Hono();
  handler.route("/", app);
  if (serveUi) {
    handler.use("/*", serveStatic({ root: "./dist" }));
    handler.get("*", serveStatic({ path: "./dist/index.html" }));
  }

  const root = new Hono();
  // Do not redirect / → /finance/: Tailscale Serve --set-path=/finance may
  // already strip the prefix, and that redirect would loop.
  root.get("/finance", (c) => c.redirect("/finance/", 302));
  root.all("/finance/*", (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice("/finance".length) || "/";
    return handler.fetch(new Request(url, c.req.raw));
  });
  root.route("/", handler);
  return root;
}
