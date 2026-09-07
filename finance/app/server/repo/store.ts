import { and, count, desc, eq, gte, isNull, lte } from "drizzle-orm";
import type { IsoDate, YearMonth } from "../../src/engine/dates.ts";
import { monthEnd, monthStart } from "../../src/engine/dates.ts";
import type { LedgerEntry, LedgerSource, LedgerType } from "../../src/engine/types.ts";
import type { AppDb } from "../db/client.ts";
import {
  accounts,
  allocationRunLines,
  allocationRuns,
  buckets,
  categories,
  dipReserveLedger,
  expectedInflows,
  goalContributions,
  goals,
  holdingTxns,
  holdings,
  investAssets,
  investPlans,
  investThemeTiers,
  ledgerEntries,
  netWorthDaily,
  meta,
  monthBudgets,
  oneTimePlans,
  recurringPlans,
  reconciliations,
  settings,
  snapshots,
} from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import {
  mapAccount,
  mapBucket,
  mapCategory,
  mapExpectedInflow,
  mapLedgerEntry,
  mapMonthBudget,
  mapOneTimePlan,
  mapRecurringPlan,
  mapSettings,
} from "./mappers.ts";

export type StoreCounts = {
  accounts: number;
  categories: number;
  ledgerEntries: number;
  monthBudgets: number;
  recurringPlans: number;
  oneTimePlans: number;
  expectedInflows: number;
  reconciliations: number;
  buckets: number;
  goals: number;
  investPlans: number;
};

export type NewLedgerInput = {
  date: IsoDate;
  time: string | null;
  type: LedgerType;
  amount: number;
  fromAccountId: string;
  toAccountId: string;
  categoryId: string;
  inBudget: boolean;
  notes: string;
  source: LedgerSource;
  goalId?: string | null;
  holdingTxnId?: string | null;
};

export function listAccounts(db: AppDb) {
  return db.select().from(accounts).all().map(mapAccount);
}

export function listCategories(db: AppDb) {
  return db.select().from(categories).all().map(mapCategory);
}

export function listLedgerEntries(db: AppDb, since?: IsoDate) {
  const rows =
    since == null
      ? db.select().from(ledgerEntries).where(isNull(ledgerEntries.deletedAt)).all()
      : db
          .select()
          .from(ledgerEntries)
          .where(
            and(isNull(ledgerEntries.deletedAt), gte(ledgerEntries.date, since)),
          )
          .all();
  return rows.map(mapLedgerEntry);
}

export function listLedgerEntriesForMonth(db: AppDb, month: YearMonth): LedgerEntry[] {
  const from = monthStart(month);
  const to = monthEnd(month);
  const rows = db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        isNull(ledgerEntries.deletedAt),
        gte(ledgerEntries.date, from),
        lte(ledgerEntries.date, to),
      ),
    )
    .orderBy(desc(ledgerEntries.date), desc(ledgerEntries.createdAt))
    .all();
  return rows.map(mapLedgerEntry);
}

export function listRecentLedgerEntries(db: AppDb, limit = 5): LedgerEntry[] {
  const rows = db
    .select()
    .from(ledgerEntries)
    .where(isNull(ledgerEntries.deletedAt))
    .orderBy(desc(ledgerEntries.date), desc(ledgerEntries.time), desc(ledgerEntries.createdAt))
    .limit(limit)
    .all();
  return rows.map(mapLedgerEntry);
}

export function getLedgerEntry(db: AppDb, id: string): LedgerEntry | null {
  const row = db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.id, id), isNull(ledgerEntries.deletedAt)))
    .get();
  return row ? mapLedgerEntry(row) : null;
}

export function listMonthBudgets(db: AppDb) {
  return db.select().from(monthBudgets).all().map(mapMonthBudget);
}

export function getSettings(db: AppDb) {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) {
    throw new Error("settings row is missing");
  }
  return mapSettings(row);
}

export function listRecurringPlans(db: AppDb) {
  return db.select().from(recurringPlans).all().map(mapRecurringPlan);
}

export function listOneTimePlans(db: AppDb) {
  return db.select().from(oneTimePlans).all().map(mapOneTimePlan);
}

export function listExpectedInflows(db: AppDb) {
  return db.select().from(expectedInflows).all().map(mapExpectedInflow);
}

export function listBuckets(db: AppDb) {
  return db.select().from(buckets).all().map(mapBucket);
}

export function getMeta(db: AppDb, key: string): string | null {
  const row = db.select().from(meta).where(eq(meta.key, key)).get();
  return row?.value ?? null;
}

export function setMeta(db: AppDb, key: string, value: string): void {
  db.insert(meta)
    .values({ key, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run();
}

export function insertLedgerEntry(db: AppDb, input: NewLedgerInput): LedgerEntry {
  const at = nowIso();
  const id = uuidv7();
  db.insert(ledgerEntries)
    .values({
      id,
      date: input.date,
      time: input.time,
      type: input.type,
      amount: input.amount,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      categoryId: input.categoryId,
      inBudget: input.inBudget,
      notes: input.notes,
      source: input.source,
      sourceHash: null,
      goalId: input.goalId ?? null,
      holdingTxnId: input.holdingTxnId ?? null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    })
    .run();
  const row = db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id)).get();
  if (!row) throw new Error("insert ledger failed");
  return mapLedgerEntry(row);
}

export function setLedgerHoldingTxn(
  db: AppDb,
  entryId: string,
  holdingTxnId: string,
): void {
  db.update(ledgerEntries)
    .set({ holdingTxnId, updatedAt: nowIso() })
    .where(eq(ledgerEntries.id, entryId))
    .run();
}

export function updateLedgerEntry(
  db: AppDb,
  id: string,
  input: NewLedgerInput,
): LedgerEntry | null {
  const current = db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.id, id), isNull(ledgerEntries.deletedAt)))
    .get();
  if (!current) return null;
  const at = nowIso();
  db.update(ledgerEntries)
    .set({
      date: input.date,
      time: input.time,
      type: input.type,
      amount: input.amount,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      categoryId: input.categoryId,
      inBudget: input.inBudget,
      notes: input.notes,
      updatedAt: at,
    })
    .where(eq(ledgerEntries.id, id))
    .run();
  const row = db.select().from(ledgerEntries).where(eq(ledgerEntries.id, id)).get();
  if (!row) throw new Error("update ledger failed");
  return mapLedgerEntry(row);
}

export function softDeleteLedgerEntry(db: AppDb, id: string): LedgerEntry | null {
  const current = db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.id, id), isNull(ledgerEntries.deletedAt)))
    .get();
  if (!current) return null;
  const at = nowIso();
  db.update(ledgerEntries)
    .set({ deletedAt: at, updatedAt: at })
    .where(eq(ledgerEntries.id, id))
    .run();
  return mapLedgerEntry({ ...current, deletedAt: at, updatedAt: at });
}

export function storeCounts(db: AppDb): StoreCounts {
  const live = db
    .select({ n: count() })
    .from(ledgerEntries)
    .where(isNull(ledgerEntries.deletedAt))
    .get();
  return {
    accounts: db.select({ n: count() }).from(accounts).get()?.n ?? 0,
    categories: db.select({ n: count() }).from(categories).get()?.n ?? 0,
    ledgerEntries: live?.n ?? 0,
    monthBudgets: db.select({ n: count() }).from(monthBudgets).get()?.n ?? 0,
    recurringPlans: db.select({ n: count() }).from(recurringPlans).get()?.n ?? 0,
    oneTimePlans: db.select({ n: count() }).from(oneTimePlans).get()?.n ?? 0,
    expectedInflows: db.select({ n: count() }).from(expectedInflows).get()?.n ?? 0,
    reconciliations: db.select({ n: count() }).from(reconciliations).get()?.n ?? 0,
    buckets: db.select({ n: count() }).from(buckets).get()?.n ?? 0,
    goals: db.select({ n: count() }).from(goals).get()?.n ?? 0,
    investPlans: db.select({ n: count() }).from(investPlans).get()?.n ?? 0,
  };
}

export function wipeAllRows(db: AppDb): void {
  db.delete(holdingTxns).run();
  db.delete(holdings).run();
  db.delete(snapshots).run();
  db.delete(netWorthDaily).run();
  db.delete(dipReserveLedger).run();
  db.delete(allocationRunLines).run();
  db.delete(allocationRuns).run();
  db.delete(goalContributions).run();
  db.delete(goals).run();
  db.delete(investThemeTiers).run();
  db.delete(investAssets).run();
  db.delete(investPlans).run();
  db.delete(reconciliations).run();
  db.delete(expectedInflows).run();
  db.delete(oneTimePlans).run();
  db.delete(recurringPlans).run();
  db.delete(ledgerEntries).run();
  db.delete(monthBudgets).run();
  db.delete(accounts).run();
  db.delete(categories).run();
  db.delete(buckets).run();
  db.delete(settings).run();
  db.delete(meta).run();
}

export function wipeAll(db: AppDb): void {
  db.transaction((tx) => {
    wipeAllRows(tx);
  });
}
