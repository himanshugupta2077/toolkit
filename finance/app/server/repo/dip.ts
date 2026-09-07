import { desc } from "drizzle-orm";
import {
  allocationLedgerType,
  DEFAULT_BUCKET_IDS,
  findInvestmentCategory,
  isPaise,
  nowTimeIst,
  splitInvest,
  suggestFromAccount,
  suggestToAccount,
  todayIst,
  validateLedgerEntry,
  ZERO_PAISE,
  type IsoDate,
  type LedgerEntry,
  type LedgerIssue,
  type Paise,
} from "../../src/engine/index.ts";
import type { AppDb } from "../db/client.ts";
import { dipReserveLedger } from "../db/schema.ts";
import { uuidv7 } from "../ids.ts";
import { maybeBuyDipTxn } from "./holdings.ts";
import { InvestWriteError, getCurrentInvestPlan } from "./invest.ts";
import { insertLedgerEntry, listAccounts, listBuckets, listCategories } from "./store.ts";

export type DipReserveLine = {
  id: string;
  date: IsoDate;
  credit: Paise;
  debit: Paise;
  runId: string | null;
  ledgerEntryId: string | null;
  note: string;
};

export type DipBuyLineInput = {
  assetId: string;
  amount: Paise;
};

export type DipBuyInput = {
  amount: Paise;
  fromAccountId: string;
  toAccountId: string;
  lines: DipBuyLineInput[];
  today?: IsoDate;
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

export function listDipReserve(db: AppDb): DipReserveLine[] {
  return db
    .select()
    .from(dipReserveLedger)
    .orderBy(desc(dipReserveLedger.date), desc(dipReserveLedger.id))
    .all()
    .map((row) => ({
      id: row.id,
      date: row.date as IsoDate,
      credit: row.credit,
      debit: row.debit,
      runId: row.runId,
      ledgerEntryId: row.ledgerEntryId,
      note: row.note ?? "",
    }));
}

export function dipReserveBalance(db: AppDb): Paise {
  let balance: Paise = ZERO_PAISE;
  for (const row of listDipReserve(db)) {
    balance += row.credit - row.debit;
  }
  return balance;
}

export function insertDipCredit(
  db: AppDb,
  input: {
    date: IsoDate;
    amount: Paise;
    runId: string | null;
    note: string;
  },
): DipReserveLine {
  const id = uuidv7();
  db.insert(dipReserveLedger)
    .values({
      id,
      date: input.date,
      credit: input.amount,
      debit: 0,
      runId: input.runId,
      ledgerEntryId: null,
      note: input.note,
    })
    .run();
  return {
    id,
    date: input.date,
    credit: input.amount,
    debit: 0,
    runId: input.runId,
    ledgerEntryId: null,
    note: input.note,
  };
}

export function creditDipForAllocation(
  db: AppDb,
  input: { date: IsoDate; runId: string; investAmount: Paise },
): Paise {
  if (!isPaise(input.investAmount) || input.investAmount <= 0) return ZERO_PAISE;
  const plan = getCurrentInvestPlan(db);
  if (!plan) return ZERO_PAISE;
  const split = splitInvest(input.investAmount, plan);
  if (split.dipCredit <= 0) return ZERO_PAISE;
  insertDipCredit(db, {
    date: input.date,
    amount: split.dipCredit,
    runId: input.runId,
    note: "Allocation dip credit",
  });
  return split.dipCredit;
}

export function parseDipBuyBody(body: unknown): DipBuyInput {
  if (body == null || typeof body !== "object") {
    throw new InvestWriteError("invalid json");
  }
  const rec = body as Record<string, unknown>;
  const amount = asFiniteNumber(rec.amount);
  if (amount == null || !isPaise(amount) || amount <= 0) {
    throw new InvestWriteError("Deploy amount must be a positive paise integer.");
  }
  const fromAccountId = asString(rec.fromAccountId).trim();
  const toAccountId = asString(rec.toAccountId).trim();
  if (!fromAccountId || !toAccountId) {
    throw new InvestWriteError("From and To are required.");
  }
  if (fromAccountId === toAccountId) {
    throw new InvestWriteError("From and To must be different accounts.");
  }
  if (!Array.isArray(rec.lines) || rec.lines.length === 0) {
    throw new InvestWriteError("lines must be a non-empty array.");
  }
  const lines = rec.lines.map((row, index) => {
    if (row == null || typeof row !== "object") {
      throw new InvestWriteError(`Line ${index + 1} is not an object.`);
    }
    const line = row as Record<string, unknown>;
    const assetId = asString(line.assetId).trim();
    if (!assetId) throw new InvestWriteError(`Line ${index + 1} needs an assetId.`);
    const lineAmount = asFiniteNumber(line.amount);
    if (lineAmount == null || !isPaise(lineAmount) || lineAmount < 0) {
      throw new InvestWriteError(`${assetId}: amount must be non-negative integer paise.`);
    }
    return { assetId, amount: lineAmount };
  });
  const sum = lines.reduce((total, row) => total + row.amount, 0);
  if (sum !== amount) {
    throw new InvestWriteError("Split amounts must sum to the deploy amount.");
  }
  let today: IsoDate | undefined;
  if (rec.date != null && rec.date !== "") {
    const date = asString(rec.date).trim();
    today = date as IsoDate;
  }
  return { amount, fromAccountId, toAccountId, lines, today };
}

export function suggestedDipAccounts(
  db: AppDb,
  balances: Readonly<Record<string, Paise>>,
): { fromAccountId: string | null; toAccountId: string | null } {
  const accounts = listAccounts(db);
  const buckets = listBuckets(db);
  const investment =
    buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.investment) ?? {
      id: DEFAULT_BUCKET_IDS.investment,
      name: "Investment",
    };
  const to = suggestToAccount(investment, accounts, null);
  const from = suggestFromAccount(accounts, balances, to?.id ?? null);
  return { fromAccountId: from?.id ?? null, toAccountId: to?.id ?? null };
}

export function deployDip(db: AppDb, input: DipBuyInput): {
  entries: LedgerEntry[];
  debitTotal: Paise;
} {
  const today = input.today ?? todayIst();
  const plan = getCurrentInvestPlan(db);
  if (!plan) throw new InvestWriteError("No invest plan is saved yet.", 404);
  const known = new Set(plan.assets.map((row) => row.id));
  for (const line of input.lines) {
    if (line.amount <= 0) continue;
    if (!known.has(line.assetId)) {
      throw new InvestWriteError(`Unknown asset: ${line.assetId}.`);
    }
  }
  const balance = dipReserveBalance(db);
  if (input.amount > balance) {
    throw new InvestWriteError("Deploy amount is more than the dip reserve.");
  }

  const accs = listAccounts(db);
  const cats = listCategories(db);
  const category = findInvestmentCategory(cats);
  if (!category) throw new InvestWriteError("Investment category is missing.");
  const byId = new Map(accs.map((row) => [row.id, row]));
  const from = byId.get(input.fromAccountId);
  const to = byId.get(input.toAccountId);
  if (!from || !to) throw new InvestWriteError("From and To must be real accounts.");
  const type = allocationLedgerType(to);
  const names = new Map(plan.assets.map((row) => [row.id, row.name] as const));

  const issues: LedgerIssue[] = [];
  for (const line of input.lines) {
    if (line.amount <= 0) continue;
    const checked = validateLedgerEntry(
      {
        date: today,
        type,
        amount: line.amount,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        categoryId: category.id,
      },
      { accounts: accs, categories: cats },
    );
    issues.push(...checked.issues);
  }
  if (issues.length > 0) {
    throw new InvestWriteError(issues[0]?.message ?? "Type Guide failed.", 400, issues);
  }

  const entries: LedgerEntry[] = [];
  db.transaction((tx) => {
    for (const line of input.lines) {
      if (line.amount <= 0) continue;
      const name = names.get(line.assetId) ?? line.assetId;
      const entry = insertLedgerEntry(tx, {
        date: today,
        time: nowTimeIst(),
        type,
        amount: line.amount,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        categoryId: category.id,
        inBudget: false,
        notes: `Dip · ${name}`,
        source: "manual",
      });
      entries.push(entry);
      maybeBuyDipTxn(tx, {
        assetId: line.assetId,
        accountId: input.toAccountId,
        date: today,
        amount: line.amount,
        ledgerEntryId: entry.id,
      });
      const id = uuidv7();
      tx.insert(dipReserveLedger)
        .values({
          id,
          date: today,
          credit: 0,
          debit: line.amount,
          runId: null,
          ledgerEntryId: entry.id,
          note: `Dip · ${name}`,
        })
        .run();
    }
  });

  return { entries, debitTotal: input.amount };
}