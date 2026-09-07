import { and, desc, eq, isNull, or } from "drizzle-orm";
import {
  accountBalance,
  adjustmentLegs,
  canReconcileAccount,
  computeBalances,
  currentCycleStart,
  cycleSpends,
  daysBetween,
  findAdjustmentCounterpart,
  findReconciliationCategory,
  nowTimeIst,
  reconCheckedDate,
  todayIst,
  validateLedgerEntry,
  type Account,
  type AccountGroup,
  type AccountType,
  type IsoDate,
  type LedgerEntry,
  type Paise,
  type VirtualKind,
} from "../../src/engine/index.ts";
import type { AppDb } from "../db/client.ts";
import {
  accounts,
  buckets,
  ledgerEntries,
  reconciliations,
} from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import { mapAccount, mapLedgerEntry } from "./mappers.ts";
import {
  insertLedgerEntry,
  listAccounts,
  listBuckets,
  listCategories,
  listLedgerEntries,
} from "./store.ts";

export const RECONCILE_RESOLUTIONS_WRITE = ["none", "adjustment"] as const;
export type ReconcileWriteResolution = (typeof RECONCILE_RESOLUTIONS_WRITE)[number];

export type AccountBalanceRow = Account & {
  balance: Paise;
  available: Paise | null;
  utilisation: number | null;
  lastReconciledAt: string | null;
  daysSinceReconcile: number | null;
};

export type ReconciliationRow = {
  id: string;
  accountId: string;
  checkedAt: string;
  calculatedBalance: Paise;
  actualBalance: Paise;
  difference: Paise;
  resolution: string;
  adjustmentEntryId: string | null;
  notes: string;
};

export type NewAccountInput = {
  name: string;
  type: AccountType;
  group: AccountGroup;
  openingBalance: Paise;
  openingDate: IsoDate;
  creditLimit: Paise | null;
  includeNetWorth: boolean;
  includeLiquid: boolean;
  bucketId: string | null;
  statementDay: number | null;
  dueDay: number | null;
  notes: string;
  virtualKind: VirtualKind | null;
  maturityDate?: IsoDate | null;
};

export type AccountPatch = Partial<
  Pick<
    NewAccountInput,
    | "name"
    | "creditLimit"
    | "includeNetWorth"
    | "includeLiquid"
    | "bucketId"
    | "statementDay"
    | "dueDay"
    | "notes"
    | "maturityDate"
  >
> & { isArchived?: boolean };

export type AccountDetail = {
  today: IsoDate;
  account: Account;
  balance: Paise;
  available: Paise | null;
  utilisation: number | null;
  lastReconciledAt: string | null;
  daysSinceReconcile: number | null;
  cycleStart: IsoDate;
  cycleSpent: Paise;
  entries: LedgerEntry[];
  reconciliations: ReconciliationRow[];
  accounts: Account[];
  categories: ReturnType<typeof listCategories>;
  buckets: { id: string; name: string }[];
  canReconcile: boolean;
  canArchive: boolean;
};

function mapRecon(row: typeof reconciliations.$inferSelect): ReconciliationRow {
  return {
    id: row.id,
    accountId: row.accountId,
    checkedAt: row.checkedAt,
    calculatedBalance: row.calculatedBalance,
    actualBalance: row.actualBalance,
    difference: row.difference,
    resolution: row.resolution,
    adjustmentEntryId: row.adjustmentEntryId,
    notes: row.notes ?? "",
  };
}

export function getAccount(db: AppDb, id: string): Account | null {
  const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
  return row ? mapAccount(row) : null;
}

export function listReconciliations(db: AppDb, accountId: string): ReconciliationRow[] {
  return db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.accountId, accountId))
    .orderBy(desc(reconciliations.checkedAt))
    .all()
    .map(mapRecon);
}

export function latestReconByAccount(db: AppDb): Map<string, ReconciliationRow> {
  const rows = db
    .select()
    .from(reconciliations)
    .orderBy(desc(reconciliations.checkedAt))
    .all()
    .map(mapRecon);
  const map = new Map<string, ReconciliationRow>();
  for (const row of rows) {
    if (!map.has(row.accountId)) map.set(row.accountId, row);
  }
  return map;
}

export function listLedgerForAccount(
  db: AppDb,
  accountId: string,
  limit = 50,
): LedgerEntry[] {
  const rows = db
    .select()
    .from(ledgerEntries)
    .where(
      and(
        isNull(ledgerEntries.deletedAt),
        or(
          eq(ledgerEntries.fromAccountId, accountId),
          eq(ledgerEntries.toAccountId, accountId),
        ),
      ),
    )
    .orderBy(desc(ledgerEntries.date), desc(ledgerEntries.createdAt))
    .limit(limit)
    .all();
  return rows.map(mapLedgerEntry);
}

function daysSince(checkedAt: string | null, today: IsoDate): number | null {
  if (!checkedAt) return null;
  const day = reconCheckedDate(checkedAt);
  if (!day) return null;
  return daysBetween(day, today);
}

export function listAccountBalanceRows(
  db: AppDb,
  today: IsoDate = todayIst(),
): { rows: AccountBalanceRow[]; liquid: Paise } {
  const accs = listAccounts(db);
  const entries = listLedgerEntries(db);
  const snap = computeBalances(accs, entries);
  const pos = new Map(snap.positions.map((row) => [row.accountId, row]));
  const latest = latestReconByAccount(db);
  const rows = accs.map((account) => {
    const p = pos.get(account.id);
    const recon = latest.get(account.id);
    const lastReconciledAt = recon?.checkedAt ?? null;
    return {
      ...account,
      balance: p?.balance ?? 0,
      available: p?.available ?? null,
      utilisation: p?.utilisation ?? null,
      lastReconciledAt,
      daysSinceReconcile: daysSince(lastReconciledAt, today),
    };
  });
  return { rows, liquid: snap.liquid };
}

export function getAccountDetail(
  db: AppDb,
  id: string,
  today: IsoDate = todayIst(),
): AccountDetail | null {
  const account = getAccount(db, id);
  if (!account) return null;
  const accs = listAccounts(db);
  const cats = listCategories(db);
  const entriesAll = listLedgerEntries(db);
  const snap = computeBalances(accs, entriesAll);
  const pos = snap.positions.find((row) => row.accountId === id);
  const recons = listReconciliations(db, id);
  const last = recons[0] ?? null;
  const cycleStart = currentCycleStart(today, account.statementDay);
  return {
    today,
    account,
    balance: pos?.balance ?? accountBalance(account, entriesAll),
    available: pos?.available ?? null,
    utilisation: pos?.utilisation ?? null,
    lastReconciledAt: last?.checkedAt ?? null,
    daysSinceReconcile: daysSince(last?.checkedAt ?? null, today),
    cycleStart,
    cycleSpent: cycleSpends(account.id, entriesAll, cycleStart, today),
    entries: listLedgerForAccount(db, id),
    reconciliations: recons,
    accounts: accs,
    categories: cats,
    buckets: listBuckets(db).map((row) => ({ id: row.id, name: row.name })),
    canReconcile: canReconcileAccount(account),
    canArchive: account.type !== "virtual",
  };
}

function nameTaken(db: AppDb, name: string, exceptId?: string): boolean {
  const row = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, name)).get();
  if (!row) return false;
  return exceptId == null || row.id !== exceptId;
}

function bucketExists(db: AppDb, bucketId: string | null): boolean {
  if (bucketId == null) return true;
  return Boolean(db.select({ id: buckets.id }).from(buckets).where(eq(buckets.id, bucketId)).get());
}

export function insertAccount(db: AppDb, input: NewAccountInput): Account {
  if (nameTaken(db, input.name)) {
    throw new Error("An account with that name already exists.");
  }
  if (!bucketExists(db, input.bucketId)) {
    throw new Error("Unknown bucket.");
  }
  const at = nowIso();
  const id = uuidv7();
  db.insert(accounts)
    .values({
      id,
      name: input.name,
      type: input.type,
      accountGroup: input.group,
      openingBalance: input.openingBalance,
      openingDate: input.openingDate,
      creditLimit: input.creditLimit,
      includeNetWorth: input.includeNetWorth,
      includeLiquid: input.includeLiquid,
      bucketId: input.bucketId,
      statementDay: input.statementDay,
      dueDay: input.dueDay,
      isArchived: false,
      notes: input.notes,
      virtualKind: input.virtualKind,
      maturityDate: input.maturityDate ?? null,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!row) throw new Error("insert account failed");
  return mapAccount(row);
}

export function updateAccount(
  db: AppDb,
  id: string,
  patch: AccountPatch,
): Account | null {
  const current = getAccount(db, id);
  if (!current) return null;
  if (patch.name != null && nameTaken(db, patch.name, id)) {
    throw new Error("An account with that name already exists.");
  }
  if (patch.bucketId !== undefined && !bucketExists(db, patch.bucketId)) {
    throw new Error("Unknown bucket.");
  }
  if (patch.isArchived === true && current.type === "virtual") {
    throw new Error("Virtual accounts cannot be archived.");
  }
  const at = nowIso();
  db.update(accounts)
    .set({
      name: patch.name ?? current.name,
      creditLimit: patch.creditLimit === undefined ? current.creditLimit : patch.creditLimit,
      includeNetWorth: patch.includeNetWorth ?? current.includeNetWorth,
      includeLiquid: patch.includeLiquid ?? current.includeLiquid,
      bucketId: patch.bucketId === undefined ? current.bucketId : patch.bucketId,
      statementDay:
        patch.statementDay === undefined ? current.statementDay : patch.statementDay,
      dueDay: patch.dueDay === undefined ? current.dueDay : patch.dueDay,
      notes: patch.notes ?? current.notes,
      isArchived: patch.isArchived ?? current.isArchived,
      maturityDate:
        patch.maturityDate === undefined
          ? (current.maturityDate ?? null)
          : patch.maturityDate,
      updatedAt: at,
    })
    .where(eq(accounts.id, id))
    .run();
  return getAccount(db, id);
}

export type ReconcileInput = {
  accountId: string;
  actualBalance: Paise;
  resolution: ReconcileWriteResolution;
  notes: string;
};

export type ReconcileResult =
  | {
      ok: true;
      reconciliation: ReconciliationRow;
      entry: LedgerEntry | null;
      account: Account;
      balance: Paise;
      liquid: Paise;
    }
  | { ok: false; error: string; issues?: { field: string; message: string }[] };

export function postReconcile(db: AppDb, input: ReconcileInput): ReconcileResult {
  const today = todayIst();
  const account = getAccount(db, input.accountId);
  if (!account) return { ok: false, error: "account not found" };
  if (!canReconcileAccount(account)) {
    return { ok: false, error: "Virtual accounts are not reconciled." };
  }

  const accs = listAccounts(db);
  const cats = listCategories(db);
  const entries = listLedgerEntries(db);
  const calculated = accountBalance(account, entries);
  const difference = input.actualBalance - calculated;

  if (input.resolution === "none") {
    if (difference !== 0) {
      return {
        ok: false,
        error: "Difference must be 0 to stamp. Add the missing row or an adjustment.",
      };
    }
    const recon = insertRecon(db, {
      accountId: account.id,
      checkedAt: today,
      calculatedBalance: calculated,
      actualBalance: input.actualBalance,
      difference,
      resolution: "none",
      adjustmentEntryId: null,
      notes: input.notes,
    });
    const snap = computeBalances(listAccounts(db), listLedgerEntries(db));
    return {
      ok: true,
      reconciliation: recon,
      entry: null,
      account,
      balance: calculated,
      liquid: snap.liquid,
    };
  }

  const note = input.notes.trim();
  if (note === "") {
    return { ok: false, error: "A note is required for an adjustment." };
  }
  if (difference === 0) {
    return { ok: false, error: "No gap to adjust. Stamp instead." };
  }

  const counterpart = findAdjustmentCounterpart(accs);
  const category = findReconciliationCategory(cats);
  if (!counterpart) {
    return { ok: false, error: "External account is missing; cannot post an adjustment." };
  }
  if (!category) {
    return { ok: false, error: "Reconciliation category is missing." };
  }
  const legs = adjustmentLegs(account, difference, counterpart.id);
  if (!legs) {
    return { ok: false, error: "Could not build the adjustment." };
  }

  const validated = validateLedgerEntry(
    {
      date: today,
      type: "adjustment",
      amount: legs.amount,
      fromAccountId: legs.fromAccountId,
      toAccountId: legs.toAccountId,
      categoryId: category.id,
    },
    { accounts: accs, categories: cats },
  );
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.issues[0]?.message ?? "Adjustment failed Type Guide.",
      issues: validated.issues.map((i) => ({ field: i.field, message: i.message })),
    };
  }

  const written = db.transaction((tx) => {
    const entry = insertLedgerEntry(tx, {
      date: today,
      time: nowTimeIst(),
      type: "adjustment",
      amount: legs.amount,
      fromAccountId: legs.fromAccountId,
      toAccountId: legs.toAccountId,
      categoryId: category.id,
      inBudget: false,
      notes: note,
      source: "manual",
    });
    const recon = insertRecon(tx, {
      accountId: account.id,
      checkedAt: today,
      calculatedBalance: calculated,
      actualBalance: input.actualBalance,
      difference,
      resolution: "adjustment",
      adjustmentEntryId: entry.id,
      notes: note,
    });
    return { entry, recon };
  });

  const after = listLedgerEntries(db);
  const snap = computeBalances(listAccounts(db), after);
  const pos = snap.positions.find((row) => row.accountId === account.id);
  return {
    ok: true,
    reconciliation: written.recon,
    entry: written.entry,
    account,
    balance: pos?.balance ?? accountBalance(account, after),
    liquid: snap.liquid,
  };
}

function insertRecon(
  db: AppDb,
  row: Omit<ReconciliationRow, "id">,
): ReconciliationRow {
  const id = uuidv7();
  db.insert(reconciliations)
    .values({
      id,
      accountId: row.accountId,
      checkedAt: row.checkedAt,
      calculatedBalance: row.calculatedBalance,
      actualBalance: row.actualBalance,
      difference: row.difference,
      resolution: row.resolution,
      adjustmentEntryId: row.adjustmentEntryId,
      notes: row.notes,
    })
    .run();
  const stored = db.select().from(reconciliations).where(eq(reconciliations.id, id)).get();
  if (!stored) throw new Error("insert reconciliation failed");
  return mapRecon(stored);
}

export function listBucketOptions(db: AppDb) {
  return listBuckets(db).map((row) => ({ id: row.id, name: row.name }));
}
