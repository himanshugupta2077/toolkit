import { eq } from "drizzle-orm";
import type { IsoDate, YearMonth } from "../../src/engine/dates.ts";
import type { Paise } from "../../src/engine/money.ts";
import type {
  ExpectedInflow,
  InflowStatus,
  OneTimePlan,
  OneTimeStatus,
  PlanPriority,
  RecurringFrequency,
  RecurringKind,
  RecurringPlan,
} from "../../src/engine/types.ts";
import type { AppDb } from "../db/client.ts";
import {
  expectedInflows,
  monthBudgets,
  oneTimePlans,
  recurringPlans,
  settings,
} from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import {
  mapExpectedInflow,
  mapOneTimePlan,
  mapRecurringPlan,
  toDbFrequency,
} from "./mappers.ts";

export type NewRecurringInput = {
  name: string;
  categoryId: string;
  frequency: RecurringFrequency;
  intervalMonths: number | null;
  amount: Paise;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  active: boolean;
  kind: RecurringKind | null;
  payFromAccountId: string | null;
  autoPost: boolean;
  notes: string;
};

export type RecurringPatch = Partial<NewRecurringInput>;

export type NewOneTimeInput = {
  name: string;
  categoryId: string;
  expectedDate: IsoDate;
  amount: Paise;
  priority: PlanPriority;
  status: OneTimeStatus;
  payFromAccountId: string | null;
  notes: string;
};

export type OneTimePatch = Partial<NewOneTimeInput>;

export type NewInflowInput = {
  name: string;
  categoryId: string | null;
  expectedDate: IsoDate;
  amount: Paise;
  isLiquid: boolean;
  status: InflowStatus;
  notes: string;
};

export type InflowPatch = Partial<NewInflowInput>;

function getRecurringRow(db: AppDb, id: string) {
  return db.select().from(recurringPlans).where(eq(recurringPlans.id, id)).get();
}

function getOneTimeRow(db: AppDb, id: string) {
  return db.select().from(oneTimePlans).where(eq(oneTimePlans.id, id)).get();
}

function getInflowRow(db: AppDb, id: string) {
  return db.select().from(expectedInflows).where(eq(expectedInflows.id, id)).get();
}

export function insertRecurringPlan(db: AppDb, input: NewRecurringInput): RecurringPlan {
  const at = nowIso();
  const id = uuidv7();
  db.insert(recurringPlans)
    .values({
      id,
      name: input.name,
      categoryId: input.categoryId,
      frequency: toDbFrequency(input.frequency),
      everyN: input.frequency === "custom_months" ? input.intervalMonths : null,
      amount: input.amount,
      startDate: input.startDate,
      endDate: input.endDate,
      active: input.active,
      kind: input.kind,
      payFromAccountId: input.payFromAccountId,
      autoPropose: input.autoPost,
      lastProposedMonth: null,
      notes: input.notes,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  const row = getRecurringRow(db, id);
  if (!row) throw new Error("insert recurring failed");
  return mapRecurringPlan(row);
}

export function updateRecurringPlan(
  db: AppDb,
  id: string,
  patch: RecurringPatch,
): RecurringPlan | null {
  const current = getRecurringRow(db, id);
  if (!current) return null;
  const mapped = mapRecurringPlan(current);
  const next: NewRecurringInput = {
    name: patch.name ?? mapped.name,
    categoryId: patch.categoryId ?? mapped.categoryId,
    frequency: patch.frequency ?? mapped.frequency,
    intervalMonths:
      patch.intervalMonths !== undefined ? patch.intervalMonths : mapped.intervalMonths,
    amount: patch.amount ?? mapped.amount,
    startDate: patch.startDate !== undefined ? patch.startDate : mapped.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : mapped.endDate,
    active: patch.active ?? mapped.active,
    kind: patch.kind !== undefined ? patch.kind : mapped.kind,
    payFromAccountId:
      patch.payFromAccountId !== undefined ? patch.payFromAccountId : mapped.payFromAccountId,
    autoPost: patch.autoPost ?? mapped.autoPost,
    notes: patch.notes ?? mapped.notes,
  };
  const at = nowIso();
  db.update(recurringPlans)
    .set({
      name: next.name,
      categoryId: next.categoryId,
      frequency: toDbFrequency(next.frequency),
      everyN: next.frequency === "custom_months" ? next.intervalMonths : null,
      amount: next.amount,
      startDate: next.startDate,
      endDate: next.endDate,
      active: next.active,
      kind: next.kind,
      payFromAccountId: next.payFromAccountId,
      autoPropose: next.autoPost,
      notes: next.notes,
      updatedAt: at,
    })
    .where(eq(recurringPlans.id, id))
    .run();
  const row = getRecurringRow(db, id);
  if (!row) throw new Error("update recurring failed");
  return mapRecurringPlan(row);
}

export function insertOneTimePlan(db: AppDb, input: NewOneTimeInput): OneTimePlan {
  const at = nowIso();
  const id = uuidv7();
  db.insert(oneTimePlans)
    .values({
      id,
      name: input.name,
      categoryId: input.categoryId,
      expectedDate: input.expectedDate,
      amount: input.amount,
      priority: input.priority,
      status: input.status,
      payFromAccountId: input.payFromAccountId,
      linkedEntryId: null,
      notes: input.notes,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  const row = getOneTimeRow(db, id);
  if (!row) throw new Error("insert one-time failed");
  return mapOneTimePlan(row);
}

export function updateOneTimePlan(
  db: AppDb,
  id: string,
  patch: OneTimePatch,
): OneTimePlan | null {
  const current = getOneTimeRow(db, id);
  if (!current) return null;
  const mapped = mapOneTimePlan(current);
  const next: NewOneTimeInput = {
    name: patch.name ?? mapped.name,
    categoryId: patch.categoryId ?? mapped.categoryId,
    expectedDate: patch.expectedDate ?? mapped.expectedDate,
    amount: patch.amount ?? mapped.amount,
    priority: patch.priority ?? mapped.priority,
    status: patch.status ?? mapped.status,
    payFromAccountId:
      patch.payFromAccountId !== undefined ? patch.payFromAccountId : mapped.payFromAccountId,
    notes: patch.notes ?? mapped.notes,
  };
  const at = nowIso();
  db.update(oneTimePlans)
    .set({
      name: next.name,
      categoryId: next.categoryId,
      expectedDate: next.expectedDate,
      amount: next.amount,
      priority: next.priority,
      status: next.status,
      payFromAccountId: next.payFromAccountId,
      notes: next.notes,
      updatedAt: at,
    })
    .where(eq(oneTimePlans.id, id))
    .run();
  const row = getOneTimeRow(db, id);
  if (!row) throw new Error("update one-time failed");
  return mapOneTimePlan(row);
}

export function insertExpectedInflow(db: AppDb, input: NewInflowInput): ExpectedInflow {
  const at = nowIso();
  const id = uuidv7();
  db.insert(expectedInflows)
    .values({
      id,
      name: input.name,
      categoryId: input.categoryId,
      expectedDate: input.expectedDate,
      amount: input.amount,
      isLiquid: input.isLiquid,
      status: input.status,
      linkedEntryId: null,
      notes: input.notes,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  const row = getInflowRow(db, id);
  if (!row) throw new Error("insert inflow failed");
  return mapExpectedInflow(row);
}

export function updateExpectedInflow(
  db: AppDb,
  id: string,
  patch: InflowPatch,
): ExpectedInflow | null {
  const current = getInflowRow(db, id);
  if (!current) return null;
  const mapped = mapExpectedInflow(current);
  const next: NewInflowInput = {
    name: patch.name ?? mapped.name,
    categoryId:
      patch.categoryId !== undefined
        ? patch.categoryId
        : mapped.categoryId === ""
          ? null
          : mapped.categoryId,
    expectedDate: patch.expectedDate ?? mapped.expectedDate,
    amount: patch.amount ?? mapped.amount,
    isLiquid: patch.isLiquid ?? mapped.isLiquid,
    status: patch.status ?? mapped.status,
    notes: patch.notes ?? mapped.notes,
  };
  const at = nowIso();
  db.update(expectedInflows)
    .set({
      name: next.name,
      categoryId: next.categoryId,
      expectedDate: next.expectedDate,
      amount: next.amount,
      isLiquid: next.isLiquid,
      status: next.status,
      notes: next.notes,
      updatedAt: at,
    })
    .where(eq(expectedInflows.id, id))
    .run();
  const row = getInflowRow(db, id);
  if (!row) throw new Error("update inflow failed");
  return mapExpectedInflow(row);
}

export function upsertMonthBudget(
  db: AppDb,
  month: YearMonth,
  cap: Paise,
  note: string,
  applyToFuture: boolean,
): { month: YearMonth; cap: Paise; defaultBudget: Paise } {
  const at = nowIso();
  db.insert(monthBudgets)
    .values({ month, budgetCap: cap, note, updatedAt: at })
    .onConflictDoUpdate({
      target: monthBudgets.month,
      set: { budgetCap: cap, note, updatedAt: at },
    })
    .run();

  if (applyToFuture) {
    db.update(settings).set({ defaultBudget: cap, updatedAt: at }).where(eq(settings.id, 1)).run();
    const rows = db.select().from(monthBudgets).all();
    for (const row of rows) {
      if (row.month > month) {
        db.update(monthBudgets)
          .set({ budgetCap: cap, updatedAt: at })
          .where(eq(monthBudgets.month, row.month))
          .run();
      }
    }
  }

  const settingsRow = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!settingsRow) throw new Error("settings row is missing");
  return { month, cap, defaultBudget: settingsRow.defaultBudget };
}
