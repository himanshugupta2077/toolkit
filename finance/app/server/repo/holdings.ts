import { and, asc, desc, eq } from "drizzle-orm";
import {
  allocationLedgerType,
  applyHoldingsNav,
  computeBalances,
  findInvestmentCategory,
  isHoldingTxnKind,
  isIsoDate,
  isPaise,
  matchPlanAssetId,
  nowTimeIst,
  summarizeHolding,
  todayIst,
  unitsFromAmount,
  validateLedgerEntry,
  ZERO_PAISE,
  type Books,
  type HoldingOverlay,
  type HoldingSummary,
  type HoldingTxnKind,
  type IsoDate,
  type Paise,
} from "../../src/engine/index.ts";
import { loadBooks } from "../books.ts";
import type { AppDb } from "../db/client.ts";
import {
  holdingTxns,
  holdings,
  investAssets,
  investPlans,
  ledgerEntries,
} from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import { insertLedgerEntry, listAccounts, listCategories } from "./store.ts";

export class HoldingWriteError extends Error {
  status: 400 | 404 | 409;
  issues: { field: string; code: string; message: string }[];

  constructor(
    message: string,
    status: 400 | 404 | 409 = 400,
    issues: { field: string; code: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "HoldingWriteError";
    this.status = status;
    this.issues = issues;
  }
}

export type HoldingRow = {
  id: string;
  assetId: string;
  assetName: string;
  accountId: string;
  lastNav: Paise | null;
  lastNavDate: IsoDate | null;
  updatedAt: string;
};

export type HoldingTxnRow = {
  id: string;
  holdingId: string;
  date: IsoDate;
  kind: HoldingTxnKind;
  units: number;
  nav: Paise;
  amount: Paise;
  ledgerEntryId: string;
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

function mapHolding(
  row: typeof holdings.$inferSelect,
  assetName: string,
): HoldingRow {
  return {
    id: row.id,
    assetId: row.assetId,
    assetName,
    accountId: row.accountId,
    lastNav: row.lastNav,
    lastNavDate: row.lastNavDate as IsoDate | null,
    updatedAt: row.updatedAt,
  };
}

function mapTxn(row: typeof holdingTxns.$inferSelect): HoldingTxnRow {
  if (!isHoldingTxnKind(row.kind)) {
    throw new Error(`invalid holding txn kind: ${row.kind}`);
  }
  return {
    id: row.id,
    holdingId: row.holdingId,
    date: row.date as IsoDate,
    kind: row.kind,
    units: row.units,
    nav: row.nav,
    amount: row.amount,
    ledgerEntryId: row.ledgerEntryId,
  };
}

function assetNameById(db: AppDb): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of db.select().from(investAssets).all()) {
    map.set(row.id, row.name);
  }
  return map;
}

export function listHoldings(db: AppDb): HoldingRow[] {
  const names = assetNameById(db);
  return db
    .select()
    .from(holdings)
    .all()
    .map((row) => mapHolding(row, names.get(row.assetId) ?? row.assetId));
}

export function getHolding(db: AppDb, id: string): HoldingRow | null {
  const row = db.select().from(holdings).where(eq(holdings.id, id)).get();
  if (!row) return null;
  const asset = db.select().from(investAssets).where(eq(investAssets.id, row.assetId)).get();
  return mapHolding(row, asset?.name ?? row.assetId);
}

export function listHoldingTxns(db: AppDb, holdingId: string): HoldingTxnRow[] {
  return db
    .select()
    .from(holdingTxns)
    .where(eq(holdingTxns.holdingId, holdingId))
    .orderBy(asc(holdingTxns.date), asc(holdingTxns.id))
    .all()
    .map(mapTxn);
}

export function summarizeHoldingRow(db: AppDb, holding: HoldingRow): HoldingSummary {
  return summarizeHolding(listHoldingTxns(db, holding.id), holding.lastNav);
}

export function holdingOverlays(db: AppDb): HoldingOverlay[] {
  const rows = listHoldings(db);
  const byAccount = new Map<string, HoldingOverlay>();
  for (const holding of rows) {
    const summary = summarizeHoldingRow(db, holding);
    const cur = byAccount.get(holding.accountId) ?? {
      accountId: holding.accountId,
      cost: ZERO_PAISE,
      value: ZERO_PAISE,
    };
    cur.cost += summary.cost;
    cur.value += summary.value;
    byAccount.set(holding.accountId, cur);
  }
  return [...byAccount.values()];
}

export function loadMarkedBooks(
  db: AppDb,
  today?: IsoDate,
): { books: Books; snap: ReturnType<typeof computeBalances> } {
  const books = loadBooks(db, today);
  const snap = applyHoldingsNav(
    computeBalances(books.accounts, books.entries, books.today),
    books.accounts,
    holdingOverlays(db),
  );
  return { books, snap };
}

export function findHoldingForAssetAccount(
  db: AppDb,
  assetId: string,
  accountId: string,
): HoldingRow | null {
  const row = db
    .select()
    .from(holdings)
    .where(and(eq(holdings.assetId, assetId), eq(holdings.accountId, accountId)))
    .get();
  if (!row) return null;
  const names = assetNameById(db);
  return mapHolding(row, names.get(row.assetId) ?? row.assetId);
}

export function rematchHoldingsToPlan(
  db: AppDb,
  oldAssets: readonly { id: string; name: string }[],
  newAssets: readonly { id: string; name: string }[],
): void {
  const rows = db.select().from(holdings).all();
  if (rows.length === 0) return;
  for (const row of rows) {
    const old = oldAssets.find((asset) => asset.id === row.assetId);
    const name = old?.name ?? assetNameById(db).get(row.assetId) ?? "";
    const nextId = matchPlanAssetId(newAssets, row.assetId, name);
    if (nextId && nextId !== row.assetId) {
      const clash = db
        .select()
        .from(holdings)
        .where(and(eq(holdings.assetId, nextId), eq(holdings.accountId, row.accountId)))
        .get();
      if (clash) continue;
      db.update(holdings)
        .set({ assetId: nextId, updatedAt: nowIso() })
        .where(eq(holdings.id, row.id))
        .run();
    }
  }
}

export function deleteAllHoldings(db: AppDb): void {
  db.delete(holdingTxns).run();
  db.delete(holdings).run();
}

function currentPlanAssetIds(db: AppDb): Set<string> {
  const plan = db
    .select()
    .from(investPlans)
    .orderBy(desc(investPlans.effectiveFrom), desc(investPlans.createdAt))
    .get();
  if (!plan) return new Set();
  return new Set(
    db
      .select({ id: investAssets.id })
      .from(investAssets)
      .where(eq(investAssets.planId, plan.id))
      .all()
      .map((row) => row.id),
  );
}

export function insertHolding(
  db: AppDb,
  input: { assetId: string; accountId: string },
): HoldingRow {
  const assetIds = currentPlanAssetIds(db);
  if (assetIds.size === 0) throw new HoldingWriteError("No invest plan is saved yet.", 404);
  if (!assetIds.has(input.assetId)) {
    throw new HoldingWriteError("Unknown asset on the current plan.");
  }
  const account = listAccounts(db).find((row) => row.id === input.accountId);
  if (!account) throw new HoldingWriteError("Unknown account.");
  if (account.type === "virtual") {
    throw new HoldingWriteError("Holdings need a real investment account.");
  }
  const existing = findHoldingForAssetAccount(db, input.assetId, input.accountId);
  if (existing) {
    throw new HoldingWriteError("That asset is already tracked on this account.", 409);
  }
  const id = uuidv7();
  const at = nowIso();
  db.insert(holdings)
    .values({
      id,
      assetId: input.assetId,
      accountId: input.accountId,
      lastNav: null,
      lastNavDate: null,
      updatedAt: at,
    })
    .run();
  const created = getHolding(db, id);
  if (!created) throw new Error("insert holding failed");
  return created;
}

export function updateHoldingNav(
  db: AppDb,
  id: string,
  input: { lastNav: Paise; lastNavDate?: IsoDate },
): HoldingRow {
  const current = getHolding(db, id);
  if (!current) throw new HoldingWriteError("Holding not found.", 404);
  if (!isPaise(input.lastNav) || input.lastNav <= 0) {
    throw new HoldingWriteError("NAV must be a positive paise integer.");
  }
  const date = input.lastNavDate ?? todayIst();
  if (!isIsoDate(date)) throw new HoldingWriteError("NAV date must be YYYY-MM-DD.");
  db.update(holdings)
    .set({
      lastNav: input.lastNav,
      lastNavDate: date,
      updatedAt: nowIso(),
    })
    .where(eq(holdings.id, id))
    .run();
  const next = getHolding(db, id);
  if (!next) throw new Error("update holding failed");
  return next;
}

export function insertHoldingTxn(
  db: AppDb,
  input: {
    holdingId: string;
    date: IsoDate;
    kind: HoldingTxnKind;
    units: number;
    nav: Paise;
    amount: Paise;
    ledgerEntryId: string;
  },
): HoldingTxnRow {
  const id = uuidv7();
  db.insert(holdingTxns)
    .values({
      id,
      holdingId: input.holdingId,
      date: input.date,
      kind: input.kind,
      units: input.units,
      nav: input.nav,
      amount: input.amount,
      ledgerEntryId: input.ledgerEntryId,
    })
    .run();
  db.update(ledgerEntries)
    .set({ holdingTxnId: id, updatedAt: nowIso() })
    .where(eq(ledgerEntries.id, input.ledgerEntryId))
    .run();
  const holding = db.select().from(holdings).where(eq(holdings.id, input.holdingId)).get();
  if (holding && (holding.lastNav == null || input.kind !== "dividend")) {
    db.update(holdings)
      .set({
        lastNav: input.nav > 0 ? input.nav : holding.lastNav,
        lastNavDate: input.nav > 0 ? input.date : holding.lastNavDate,
        updatedAt: nowIso(),
      })
      .where(eq(holdings.id, input.holdingId))
      .run();
  }
  const row = db.select().from(holdingTxns).where(eq(holdingTxns.id, id)).get();
  if (!row) throw new Error("insert holding txn failed");
  return mapTxn(row);
}

export function recordHoldingTxn(
  db: AppDb,
  holdingId: string,
  input: {
    date: IsoDate;
    kind: HoldingTxnKind;
    amount: Paise;
    nav: Paise;
    units: number | null;
    fromAccountId: string | null;
    ledgerEntryId: string | null;
  },
): HoldingTxnRow {
  const holding = getHolding(db, holdingId);
  if (!holding) throw new HoldingWriteError("Holding not found.", 404);
  const units = input.units ?? unitsFromAmount(input.amount, input.nav);
  let ledgerEntryId = input.ledgerEntryId;
  if (!ledgerEntryId) {
    const fromAccountId = input.fromAccountId;
    if (!fromAccountId) {
      throw new HoldingWriteError("fromAccountId or ledgerEntryId is required.");
    }
    const accs = listAccounts(db);
    const cats = listCategories(db);
    const category = findInvestmentCategory(cats);
    if (!category) throw new HoldingWriteError("Investment category is missing.");
    const to = accs.find((row) => row.id === holding.accountId);
    if (!to) throw new HoldingWriteError("Holding account is missing.");
    const type = allocationLedgerType(to);
    const checked = validateLedgerEntry(
      {
        date: input.date,
        type,
        amount: input.amount,
        fromAccountId,
        toAccountId: holding.accountId,
        categoryId: category.id,
      },
      { accounts: accs, categories: cats },
    );
    if (!checked.ok) {
      throw new HoldingWriteError(checked.issues[0]?.message ?? "Type Guide failed.", 400);
    }
    const entry = insertLedgerEntry(db, {
      date: input.date,
      time: nowTimeIst(),
      type,
      amount: input.amount,
      fromAccountId,
      toAccountId: holding.accountId,
      categoryId: category.id,
      inBudget: false,
      notes: `${input.kind === "buy_dip" ? "Dip" : "SIP"} · ${holding.assetName}`,
      source: "manual",
    });
    ledgerEntryId = entry.id;
  }
  return insertHoldingTxn(db, {
    holdingId,
    date: input.date,
    kind: input.kind,
    units,
    nav: input.nav,
    amount: input.amount,
    ledgerEntryId,
  });
}

export function maybeBuyDipTxn(
  db: AppDb,
  input: {
    assetId: string;
    accountId: string;
    date: IsoDate;
    amount: Paise;
    ledgerEntryId: string;
  },
): HoldingTxnRow | null {
  const holding = findHoldingForAssetAccount(db, input.assetId, input.accountId);
  if (!holding) return null;
  if (holding.lastNav == null || holding.lastNav <= 0) return null;
  const units = unitsFromAmount(input.amount, holding.lastNav);
  return insertHoldingTxn(db, {
    holdingId: holding.id,
    date: input.date,
    kind: "buy_dip",
    units,
    nav: holding.lastNav,
    amount: input.amount,
    ledgerEntryId: input.ledgerEntryId,
  });
}

export function parseHoldingBody(body: unknown): { assetId: string; accountId: string } {
  if (body == null || typeof body !== "object") {
    throw new HoldingWriteError("invalid json");
  }
  const rec = body as Record<string, unknown>;
  const assetId = asString(rec.assetId).trim();
  const accountId = asString(rec.accountId).trim();
  if (!assetId) throw new HoldingWriteError("assetId is required.");
  if (!accountId) throw new HoldingWriteError("accountId is required.");
  return { assetId, accountId };
}

export function parseNavBody(body: unknown): { lastNav: Paise; lastNavDate?: IsoDate } {
  if (body == null || typeof body !== "object") {
    throw new HoldingWriteError("invalid json");
  }
  const rec = body as Record<string, unknown>;
  const lastNav = asFiniteNumber(rec.lastNav);
  if (lastNav == null || !isPaise(lastNav) || lastNav <= 0) {
    throw new HoldingWriteError("NAV must be a positive paise integer.");
  }
  let lastNavDate: IsoDate | undefined;
  if (rec.lastNavDate != null && rec.lastNavDate !== "") {
    const date = asString(rec.lastNavDate).trim();
    if (!isIsoDate(date)) throw new HoldingWriteError("NAV date must be YYYY-MM-DD.");
    lastNavDate = date;
  }
  return { lastNav, lastNavDate };
}

export function parseHoldingTxnBody(body: unknown): {
  date: IsoDate;
  kind: HoldingTxnKind;
  amount: Paise;
  nav: Paise;
  units: number | null;
  fromAccountId: string | null;
  ledgerEntryId: string | null;
} {
  if (body == null || typeof body !== "object") {
    throw new HoldingWriteError("invalid json");
  }
  const rec = body as Record<string, unknown>;
  const dateRaw = asString(rec.date).trim() || todayIst();
  if (!isIsoDate(dateRaw)) throw new HoldingWriteError("date must be YYYY-MM-DD.");
  const kindRaw = asString(rec.kind).trim();
  if (!isHoldingTxnKind(kindRaw)) {
    throw new HoldingWriteError("kind must be buy_sip, buy_dip, sell, or dividend.");
  }
  const amount = asFiniteNumber(rec.amount);
  if (amount == null || !isPaise(amount) || amount <= 0) {
    throw new HoldingWriteError("amount must be a positive paise integer.");
  }
  const nav = asFiniteNumber(rec.nav);
  if (nav == null || !isPaise(nav) || nav <= 0) {
    throw new HoldingWriteError("NAV must be a positive paise integer.");
  }
  let units: number | null = null;
  if (rec.units != null && rec.units !== "") {
    const n = asFiniteNumber(rec.units);
    if (n == null || !Number.isSafeInteger(n) || n < 0) {
      throw new HoldingWriteError("units must be integer micro-units.");
    }
    units = n;
  }
  const fromAccountId = asString(rec.fromAccountId).trim() || null;
  const ledgerEntryId = asString(rec.ledgerEntryId).trim() || null;
  return {
    date: dateRaw,
    kind: kindRaw,
    amount,
    nav,
    units,
    fromAccountId,
    ledgerEntryId,
  };
}
