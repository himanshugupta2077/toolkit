import { eq } from "drizzle-orm";
import { loadBooks } from "../books.ts";
import type { AppDb } from "../db/client.ts";
import {
  accounts,
  categories,
  expectedInflows,
  ledgerEntries,
  monthBudgets,
  oneTimePlans,
  recurringPlans,
  reconciliations,
  settings,
} from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import { SCHEMA_VERSION } from "../db/paths.ts";
import { insertDefaultBuckets } from "../db/seed.ts";
import { tagDefaultAccountBuckets } from "./mapBuckets.ts";
import { setMeta, wipeAllRows } from "../repo/store.ts";
import {
  computeBalances,
  recurringDueLines,
  validateLedgerEntry,
  type Account,
  type Category,
} from "../../src/engine/index.ts";
import { toDbFrequency } from "../repo/mappers.ts";
import { slugId } from "./cells.ts";
import {
  APPROVAL_MONTH,
  MATCH_TOLERANCE_PAISE,
  type BalanceMatchLine,
  type ImportReport,
  type ImportedLedgerLine,
  type ParsedAccount,
  type ParsedCategory,
  type ParsedFinanceWorkbook,
  type ParsedLedgerRow,
} from "./types.ts";

type IdMaps = {
  accountByName: Map<string, string>;
  accountNameById: Map<string, string>;
  categoryByName: Map<string, string>;
  categoryNameById: Map<string, string>;
  categoryDefault: Map<string, boolean>;
};

function key(name: string): string {
  return name.trim().toLowerCase();
}

function existingHashes(db: AppDb): Map<string, string> {
  const rows = db
    .select({ id: ledgerEntries.id, hash: ledgerEntries.sourceHash })
    .from(ledgerEntries)
    .all();
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.hash) map.set(row.hash, row.id);
  }
  return map;
}

function pickId(
  db: AppDb,
  table: typeof accounts | typeof categories,
  wanted: string,
): string {
  const taken = db.select({ id: table.id }).from(table).where(eq(table.id, wanted)).get();
  return taken ? uuidv7() : wanted;
}

function upsertAccounts(db: AppDb, rows: ParsedAccount[], at: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const existing = db.select().from(accounts).where(eq(accounts.name, row.name)).get();
    if (existing) {
      db.update(accounts)
        .set({
          type: row.type,
          accountGroup: row.group,
          openingBalance: row.openingBalance,
          openingDate: row.openingDate,
          creditLimit: row.creditLimit,
          includeNetWorth: row.includeNetWorth,
          includeLiquid: row.includeLiquid,
          notes: row.notes,
          virtualKind: row.virtualKind,
          isArchived: false,
          updatedAt: at,
        })
        .where(eq(accounts.id, existing.id))
        .run();
      map.set(key(row.name), existing.id);
      continue;
    }
    const id = pickId(db, accounts, slugId("acc", row.name));
    db.insert(accounts)
      .values({
        id,
        name: row.name,
        type: row.type,
        accountGroup: row.group,
        openingBalance: row.openingBalance,
        openingDate: row.openingDate,
        creditLimit: row.creditLimit,
        includeNetWorth: row.includeNetWorth,
        includeLiquid: row.includeLiquid,
        bucketId: null,
        statementDay: null,
        dueDay: null,
        isArchived: false,
        notes: row.notes,
        virtualKind: row.virtualKind,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    map.set(key(row.name), id);
  }
  return map;
}

function upsertCategories(db: AppDb, rows: ParsedCategory[], at: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const existing = db.select().from(categories).where(eq(categories.name, row.name)).get();
    if (existing) {
      db.update(categories)
        .set({
          categoryGroup: row.group,
          defaultInBudget: row.defaultInBudget,
          isEssential: row.isEssential,
          sort: row.sort,
          isArchived: false,
          updatedAt: at,
        })
        .where(eq(categories.id, existing.id))
        .run();
      map.set(key(row.name), existing.id);
      continue;
    }
    const id = pickId(db, categories, slugId("cat", row.name));
    db.insert(categories)
      .values({
        id,
        name: row.name,
        categoryGroup: row.group,
        defaultInBudget: row.defaultInBudget,
        isEssential: row.isEssential,
        icon: null,
        sort: row.sort,
        isArchived: false,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    map.set(key(row.name), id);
  }
  return map;
}

function upsertSettings(
  db: AppDb,
  parsed: ParsedFinanceWorkbook["settings"],
  at: string,
): void {
  const existing = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (existing) {
    db.update(settings)
      .set({
        defaultBudget: parsed.defaultBudget,
        monthlySalary: parsed.monthlySalary,
        updatedAt: at,
      })
      .where(eq(settings.id, 1))
      .run();
    return;
  }
  db.insert(settings)
    .values({
      id: 1,
      defaultBudget: parsed.defaultBudget,
      monthlySalary: parsed.monthlySalary,
      salaryDay: 1,
      efMonths: 6,
      updatedAt: at,
    })
    .run();
}

function engineCatalog(
  parsedAccounts: ParsedAccount[],
  parsedCategories: ParsedCategory[],
  accountByName: Map<string, string>,
  categoryByName: Map<string, string>,
): { accounts: Account[]; categories: Category[] } {
  return {
    accounts: parsedAccounts.map((row) => ({
      id: accountByName.get(key(row.name)) ?? "",
      name: row.name,
      type: row.type,
      openingBalance: row.openingBalance,
      openingDate: row.openingDate,
      creditLimit: row.creditLimit,
      includeNetWorth: row.includeNetWorth,
      includeLiquid: row.includeLiquid,
      group: row.group,
      bucketId: null,
      statementDay: null,
      dueDay: null,
      isArchived: false,
      notes: row.notes,
      virtualKind: row.virtualKind,
    })),
    categories: parsedCategories.map((row) => ({
      id: categoryByName.get(key(row.name)) ?? "",
      name: row.name,
      group: row.group,
      defaultInBudget: row.defaultInBudget,
      icon: null,
      isArchived: false,
      sort: row.sort,
    })),
  };
}

function sheetBalanceByAccount(parsed: ParsedFinanceWorkbook): Map<string, number> {
  const map = new Map<string, number>();
  for (const account of parsed.accounts) {
    map.set(key(account.name), account.openingBalance);
  }
  for (const row of parsed.ledger) {
    const from = map.get(key(row.fromName));
    const to = map.get(key(row.toName));
    const fromAcc = parsed.accounts.find((a) => key(a.name) === key(row.fromName));
    const toAcc = parsed.accounts.find((a) => key(a.name) === key(row.toName));
    if (fromAcc && from != null) {
      map.set(key(row.fromName), fromAcc.type === "liability" ? from + row.amount : from - row.amount);
    }
    if (toAcc && to != null) {
      map.set(key(row.toName), toAcc.type === "liability" ? to - row.amount : to + row.amount);
    }
  }
  return map;
}

function insertLedger(
  db: AppDb,
  rows: ParsedLedgerRow[],
  ids: IdMaps,
  hashes: Map<string, string>,
  at: string,
): { lines: ImportedLedgerLine[]; inserted: number; skipped: number } {
  const lines: ImportedLedgerLine[] = [];
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const fromAccountId = ids.accountByName.get(key(row.fromName));
    const toAccountId = ids.accountByName.get(key(row.toName));
    const categoryId = ids.categoryByName.get(key(row.categoryName));
    if (!fromAccountId || !toAccountId || !categoryId) continue;
    const inBudget = row.inBudget ?? ids.categoryDefault.get(key(row.categoryName)) ?? true;
    const existingId = hashes.get(row.sourceHash);
    if (existingId) {
      skipped += 1;
      lines.push({
        id: existingId,
        date: row.date,
        type: row.type,
        amount: row.amount,
        fromAccountId,
        toAccountId,
        fromName: row.fromName,
        toName: row.toName,
        categoryName: row.categoryName,
        notes: row.notes,
        sheetRow: row.sheetRow,
        skipped: true,
      });
      continue;
    }
    const id = uuidv7();
    db.insert(ledgerEntries)
      .values({
        id,
        date: row.date,
        time: row.time,
        type: row.type,
        amount: row.amount,
        fromAccountId,
        toAccountId,
        categoryId,
        inBudget,
        notes: row.notes,
        source: "excel",
        sourceHash: row.sourceHash,
        goalId: null,
        holdingTxnId: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      })
      .run();
    hashes.set(row.sourceHash, id);
    inserted += 1;
    lines.push({
      id,
      date: row.date,
      type: row.type,
      amount: row.amount,
      fromAccountId,
      toAccountId,
      fromName: row.fromName,
      toName: row.toName,
      categoryName: row.categoryName,
      notes: row.notes,
      sheetRow: row.sheetRow,
      skipped: false,
    });
  }
  return { lines, inserted, skipped };
}

function replacePlans(db: AppDb, parsed: ParsedFinanceWorkbook, ids: IdMaps, at: string): void {
  db.delete(expectedInflows).run();
  db.delete(oneTimePlans).run();
  db.delete(recurringPlans).run();

  for (const row of parsed.recurring) {
    const categoryId = ids.categoryByName.get(key(row.categoryName));
    if (!categoryId) continue;
    const payFrom = row.payFromName ? ids.accountByName.get(key(row.payFromName)) ?? null : null;
    db.insert(recurringPlans)
      .values({
        id: uuidv7(),
        name: row.name,
        categoryId,
        frequency: toDbFrequency(row.frequency),
        everyN: row.frequency === "custom_months" ? 1 : null,
        amount: row.amount,
        startDate: row.startDate,
        endDate: row.endDate,
        active: row.active,
        kind: row.kind,
        payFromAccountId: payFrom,
        autoPropose: false,
        lastProposedMonth: null,
        notes: row.notes,
        createdAt: at,
        updatedAt: at,
      })
      .run();
  }

  for (const row of parsed.oneTime) {
    const categoryId = ids.categoryByName.get(key(row.categoryName));
    if (!categoryId) continue;
    db.insert(oneTimePlans)
      .values({
        id: uuidv7(),
        name: row.name,
        categoryId,
        expectedDate: row.expectedDate,
        amount: row.amount,
        priority: row.priority,
        status: row.status,
        payFromAccountId: null,
        linkedEntryId: null,
        notes: row.notes,
        createdAt: at,
        updatedAt: at,
      })
      .run();
  }

  for (const row of parsed.inflows) {
    const categoryId = row.categoryName
      ? ids.categoryByName.get(key(row.categoryName)) ?? null
      : null;
    db.insert(expectedInflows)
      .values({
        id: uuidv7(),
        name: row.name,
        categoryId,
        expectedDate: row.expectedDate,
        amount: row.amount,
        isLiquid: row.isLiquid,
        status: row.status,
        linkedEntryId: null,
        notes: row.notes,
        createdAt: at,
        updatedAt: at,
      })
      .run();
  }
}

function replaceMonthBudgets(db: AppDb, parsed: ParsedFinanceWorkbook, at: string): void {
  for (const row of parsed.monthBudgets) {
    db.insert(monthBudgets)
      .values({
        month: row.month,
        budgetCap: row.cap,
        note: null,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: monthBudgets.month,
        set: { budgetCap: row.cap, updatedAt: at },
      })
      .run();
  }
}

function replaceReconciliations(
  db: AppDb,
  parsed: ParsedFinanceWorkbook,
  ids: IdMaps,
  engineById: Map<string, number>,
): number {
  db.delete(reconciliations).run();
  let n = 0;
  for (const row of parsed.reconciles) {
    const accountId = ids.accountByName.get(key(row.accountName));
    if (!accountId) continue;
    const calculated = engineById.get(accountId) ?? 0;
    const actual = row.actual ?? calculated;
    db.insert(reconciliations)
      .values({
        id: uuidv7(),
        accountId,
        checkedAt: row.lastChecked ?? nowIso().slice(0, 10),
        calculatedBalance: calculated,
        actualBalance: actual,
        difference: actual - calculated,
        resolution: "none",
        adjustmentEntryId: null,
        notes: row.notes,
      })
      .run();
    n += 1;
  }
  return n;
}

export function applyFinanceImport(
  db: AppDb,
  parsed: ParsedFinanceWorkbook,
  opts: { replace: boolean; filename: string; fileSha: string },
): ImportReport {
  const at = nowIso();
  let inserted = 0;
  let skipped = 0;
  let reconCount = 0;
  let extraManual = 0;
  const typeGuideIssues: ImportReport["typeGuideIssues"] = [];
  let lines: ImportedLedgerLine[] = [];
  let maps: IdMaps = {
    accountByName: new Map(),
    accountNameById: new Map(),
    categoryByName: new Map(),
    categoryNameById: new Map(),
    categoryDefault: new Map(),
  };

  db.transaction((tx) => {
    if (opts.replace) {
      wipeAllRows(tx);
      insertDefaultBuckets(tx, at);
    }

    const categoryByName = upsertCategories(tx, parsed.categories, at);
    const accountByName = upsertAccounts(tx, parsed.accounts, at);
    upsertSettings(tx, parsed.settings, at);
    tagDefaultAccountBuckets(tx);

    const categoryNameById = new Map<string, string>();
    const accountNameById = new Map<string, string>();
    const categoryDefault = new Map<string, boolean>();
    for (const row of parsed.categories) {
      const id = categoryByName.get(key(row.name));
      if (id) {
        categoryNameById.set(id, row.name);
        categoryDefault.set(key(row.name), row.defaultInBudget);
      }
    }
    for (const row of parsed.accounts) {
      const id = accountByName.get(key(row.name));
      if (id) accountNameById.set(id, row.name);
    }
    maps = {
      accountByName,
      accountNameById,
      categoryByName,
      categoryNameById,
      categoryDefault,
    };

    const catalog = engineCatalog(parsed.accounts, parsed.categories, accountByName, categoryByName);
    for (const row of parsed.ledger) {
      const fromAccountId = accountByName.get(key(row.fromName)) ?? "";
      const toAccountId = accountByName.get(key(row.toName)) ?? "";
      const categoryId = categoryByName.get(key(row.categoryName)) ?? "";
      const result = validateLedgerEntry(
        {
          date: row.date,
          time: row.time ?? undefined,
          type: row.type,
          amount: row.amount,
          fromAccountId,
          toAccountId,
          categoryId,
        },
        catalog,
      );
      if (!result.ok) {
        typeGuideIssues.push({
          sheetRow: row.sheetRow,
          notes: row.notes,
          issues: result.issues,
        });
      }
    }

    const hashes = existingHashes(tx);
    const written = insertLedger(tx, parsed.ledger, maps, hashes, at);
    lines = written.lines;
    inserted = written.inserted;
    skipped = written.skipped;

    replaceMonthBudgets(tx, parsed, at);
    replacePlans(tx, parsed, maps, at);

    const books = loadBooks(tx);
    const snap = computeBalances(books.accounts, books.entries);
    const engineById = new Map(snap.positions.map((p) => [p.accountId, p.balance]));
    reconCount = replaceReconciliations(tx, parsed, maps, engineById);

    extraManual = books.entries.filter((e) => e.source !== "excel").length;

    setMeta(tx, "schema_version", SCHEMA_VERSION);
    setMeta(tx, "last_import_at", at);
    setMeta(tx, "last_import_sha256", opts.fileSha);
    setMeta(tx, "last_import_filename", opts.filename);
  });

  const books = loadBooks(db);
  const snap = computeBalances(books.accounts, books.entries);
  const engineById = new Map(snap.positions.map((p) => [p.accountId, p.balance]));
  const sheetByName = sheetBalanceByAccount(parsed);
  const actualByName = new Map(
    parsed.reconciles.map((r) => [key(r.accountName), r.actual] as const),
  );

  const balances: BalanceMatchLine[] = parsed.accounts.map((account) => {
    const accountId = maps.accountByName.get(key(account.name)) ?? "";
    const sheetPaise = sheetByName.get(key(account.name)) ?? 0;
    const enginePaise = engineById.get(accountId) ?? 0;
    const deltaPaise = enginePaise - sheetPaise;
    return {
      accountId,
      name: account.name,
      type: account.type,
      group: account.group,
      sheetPaise,
      enginePaise,
      deltaPaise,
      match: Math.abs(deltaPaise) <= MATCH_TOLERANCE_PAISE,
      actualPaise: actualByName.get(key(account.name)) ?? null,
    };
  });

  const mismatches = balances.filter((row) => !row.match);
  const realMismatches = mismatches.filter((row) => row.type !== "virtual");
  const recLines = recurringDueLines(
    APPROVAL_MONTH,
    "loan_emi",
    books.recurringPlans,
    books.categories,
  );

  return {
    filename: opts.filename,
    replace: opts.replace,
    ok: realMismatches.length === 0 && parsed.ledger.length > 0,
    counts: {
      accounts: parsed.accounts.length,
      categories: parsed.categories.length,
      ledgerInserted: inserted,
      ledgerSkipped: skipped,
      monthBudgets: parsed.monthBudgets.length,
      recurring: parsed.recurring.length,
      oneTime: parsed.oneTime.length,
      inflows: parsed.inflows.length,
      reconciliations: reconCount,
      extraManualLedger: extraManual,
    },
    balances,
    mismatches,
    ledger: lines,
    warnings: parsed.warnings,
    typeGuideIssues,
    recurringCheck: {
      month: APPROVAL_MONTH,
      loanEmi: recLines.reduce((sum, line) => sum + line.amount, 0),
      includesSmartEmi: recLines.some((line) => /smartemi/i.test(line.name)),
      lines: recLines,
    },
  };
}
