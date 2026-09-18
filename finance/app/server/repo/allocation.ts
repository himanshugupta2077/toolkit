import { desc, eq } from "drizzle-orm";
import {
  allocationLedgerType,
  DEFAULT_BUCKET_IDS,
  findInvestmentCategory,
  isPaise,
  nowTimeIst,
  suggestFromAccount,
  suggestToAccount,
  todayIst,
  validateLedgerEntry,
  yearMonthFromIsoDate,
  type Account,
  type IsoDate,
  type LedgerEntry,
  type LedgerIssue,
  type LedgerType,
  type Paise,
  type YearMonth,
} from "../../src/engine/index.ts";
import type { AppDb } from "../db/client.ts";
import { allocationRunLines, allocationRuns, buckets } from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import { creditDipForAllocation } from "./dip.ts";
import { getCurrentInvestPlan } from "./invest.ts";
import { takeSnapshot } from "./snapshots.ts";
import { insertLedgerEntry, listAccounts, listCategories, listLedgerEntries } from "./store.ts";

export type AllocationStatus = "proposed" | "confirmed";

export type AllocationLineView = {
  id: string;
  bucketId: string;
  name: string;
  proposedAmount: Paise;
  confirmedAmount: Paise | null;
  ledgerEntryId: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  type: LedgerType | null;
};

export type AllocationRunView = {
  id: string;
  month: YearMonth;
  surplusInput: Paise;
  overrideReason: string | null;
  status: AllocationStatus;
  createdAt: string;
  confirmedAt: string | null;
  investPlanId: string | null;
  lines: AllocationLineView[];
};

export type SuggestedMove = {
  bucketId: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  type: "transfer" | "investment" | null;
};

export type ConfirmLineInput = {
  bucketId: string;
  amount: Paise;
  fromAccountId: string;
  toAccountId: string;
};

export type ProposedLineInput = {
  bucketId: string;
  amount: Paise;
};

export class AllocationWriteError extends Error {
  issues: LedgerIssue[];
  status: 400 | 404 | 409;

  constructor(message: string, issues: LedgerIssue[] = [], status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "AllocationWriteError";
    this.issues = issues;
    this.status = status;
  }
}

function issue(field: string, code: string, message: string): LedgerIssue {
  return { field, code, message };
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function suggestMoves(
  bucketRows: readonly { id: string; name: string }[],
  accounts: readonly Account[],
  balances: Readonly<Record<string, Paise>>,
): SuggestedMove[] {
  return bucketRows.map((bucket) => {
    const to = suggestToAccount(bucket, accounts, null);
    const from = suggestFromAccount(accounts, balances, to?.id ?? null);
    const type = to ? allocationLedgerType(to) : null;
    return {
      bucketId: bucket.id,
      fromAccountId: from?.id ?? null,
      toAccountId: to?.id ?? null,
      type,
    };
  });
}

function mapRunStatus(value: string): AllocationStatus {
  if (value === "proposed" || value === "confirmed") return value;
  throw new Error(`invalid allocation status: ${value}`);
}

function lineName(
  bucketId: string,
  names: Map<string, string>,
): string {
  return names.get(bucketId) ?? bucketId;
}

export function listAllocationRuns(db: AppDb): AllocationRunView[] {
  const bucketNames = new Map(
    db
      .select({ id: buckets.id, name: buckets.name })
      .from(buckets)
      .all()
      .map((row) => [row.id, row.name] as const),
  );
  const entries = new Map(listLedgerEntries(db).map((row) => [row.id, row]));
  const runs = db
    .select()
    .from(allocationRuns)
    .orderBy(desc(allocationRuns.createdAt))
    .all();
  return runs.map((run) => {
    const lines = db
      .select()
      .from(allocationRunLines)
      .where(eq(allocationRunLines.runId, run.id))
      .all()
      .map((line) => {
        const entry = line.ledgerEntryId ? entries.get(line.ledgerEntryId) ?? null : null;
        return {
          id: line.id,
          bucketId: line.bucketId,
          name: lineName(line.bucketId, bucketNames),
          proposedAmount: line.proposedAmount,
          confirmedAmount: line.confirmedAmount,
          ledgerEntryId: line.ledgerEntryId,
          fromAccountId: entry?.fromAccountId ?? null,
          toAccountId: entry?.toAccountId ?? null,
          type: entry?.type ?? null,
        } satisfies AllocationLineView;
      });
    return {
      id: run.id,
      month: run.month as YearMonth,
      surplusInput: run.surplusInput,
      overrideReason: run.overrideReason,
      status: mapRunStatus(run.status),
      createdAt: run.createdAt,
      confirmedAt: run.confirmedAt,
      investPlanId: run.investPlanId,
      lines,
    };
  });
}

export function getAllocationRun(db: AppDb, id: string): AllocationRunView | null {
  return listAllocationRuns(db).find((row) => row.id === id) ?? null;
}

function parseLineAmount(raw: unknown, label: string): Paise {
  const n = asFiniteNumber(raw);
  if (n == null || !isPaise(n) || n < 0) {
    throw new AllocationWriteError(`${label} amount must be non-negative integer paise.`);
  }
  return n;
}

export function parseProposedLines(raw: unknown): ProposedLineInput[] {
  if (!Array.isArray(raw)) {
    throw new AllocationWriteError("lines must be an array.");
  }
  return raw.map((row, index) => {
    if (row == null || typeof row !== "object") {
      throw new AllocationWriteError(`Line ${index + 1} is not an object.`);
    }
    const body = row as Record<string, unknown>;
    const bucketId = asString(body.bucketId).trim();
    if (!bucketId) throw new AllocationWriteError(`Line ${index + 1} needs a bucketId.`);
    return { bucketId, amount: parseLineAmount(body.amount, bucketId) };
  });
}

export function parseConfirmLines(raw: unknown): ConfirmLineInput[] {
  if (!Array.isArray(raw)) {
    throw new AllocationWriteError("lines must be an array.");
  }
  return raw.map((row, index) => {
    if (row == null || typeof row !== "object") {
      throw new AllocationWriteError(`Line ${index + 1} is not an object.`);
    }
    const body = row as Record<string, unknown>;
    const bucketId = asString(body.bucketId).trim();
    if (!bucketId) throw new AllocationWriteError(`Line ${index + 1} needs a bucketId.`);
    const fromAccountId = asString(body.fromAccountId).trim();
    const toAccountId = asString(body.toAccountId).trim();
    const amount = parseLineAmount(body.amount, bucketId);
    if (amount > 0 && (!fromAccountId || !toAccountId)) {
      throw new AllocationWriteError(`${bucketId}: From and To are required when the amount is positive.`);
    }
    return { bucketId, amount, fromAccountId, toAccountId };
  });
}

export type SaveRunInput = {
  surplusInput: Paise;
  overrideReason: string | null;
  proposed: ProposedLineInput[];
  confirm: boolean;
  confirmLines: ConfirmLineInput[];
  today?: IsoDate;
};

function requirePositiveFree(free: Paise): void {
  if (!isPaise(free) || free <= 0) {
    throw new AllocationWriteError(
      "Cannot allocate when free cash is not positive.",
      [issue("free", "free_not_positive", "Cannot allocate when free cash is not positive.")],
    );
  }
}

function requireSurplus(surplus: Paise, free: Paise, reason: string | null): void {
  if (!isPaise(surplus) || surplus <= 0) {
    throw new AllocationWriteError("Surplus must be a positive integer paise amount.");
  }
  if (surplus !== free && !reason?.trim()) {
    throw new AllocationWriteError(
      "Changing the surplus needs a reason (kept in history).",
      [issue("overrideReason", "reason_required", "Changing the surplus needs a reason.")],
    );
  }
}

function validateMoves(
  db: AppDb,
  lines: ConfirmLineInput[],
  today: IsoDate,
): { categoryId: string; accounts: Account[] } {
  const accs = listAccounts(db);
  const cats = listCategories(db);
  const category = findInvestmentCategory(cats);
  if (!category) {
    throw new AllocationWriteError("Investment category is missing.");
  }
  const issues: LedgerIssue[] = [];
  const byId = new Map(accs.map((row) => [row.id, row]));
  for (const line of lines) {
    if (line.amount <= 0) continue;
    const from = byId.get(line.fromAccountId);
    const to = byId.get(line.toAccountId);
    if (!from || !to) {
      issues.push(
        issue(
          "fromAccountId",
          "unknown_account",
          `${line.bucketId}: From and To must be real accounts.`,
        ),
      );
      continue;
    }
    const type = allocationLedgerType(to);
    const checked = validateLedgerEntry(
      {
        date: today,
        type,
        amount: line.amount,
        fromAccountId: line.fromAccountId,
        toAccountId: line.toAccountId,
        categoryId: category.id,
      },
      { accounts: accs, categories: cats },
    );
    issues.push(...checked.issues);
  }
  if (issues.length > 0) {
    throw new AllocationWriteError(issues[0]?.message ?? "Type Guide failed.", issues);
  }
  return { categoryId: category.id, accounts: accs };
}

function insertRunRow(
  db: AppDb,
  input: {
    month: YearMonth;
    surplusInput: Paise;
    overrideReason: string | null;
    status: AllocationStatus;
    createdAt: string;
    confirmedAt: string | null;
    investPlanId: string | null;
  },
): string {
  const id = uuidv7();
  db.insert(allocationRuns)
    .values({
      id,
      month: input.month,
      surplusInput: input.surplusInput,
      overrideReason: input.overrideReason,
      status: input.status,
      createdAt: input.createdAt,
      confirmedAt: input.confirmedAt,
      investPlanId: input.investPlanId,
    })
    .run();
  return id;
}

function investmentAmountOf(lines: readonly { bucketId: string; amount: Paise }[]): Paise {
  return (
    lines.find((row) => row.bucketId === DEFAULT_BUCKET_IDS.investment)?.amount ?? 0
  );
}

function insertLineRow(
  db: AppDb,
  input: {
    runId: string;
    bucketId: string;
    proposedAmount: Paise;
    confirmedAmount: Paise | null;
    ledgerEntryId: string | null;
  },
): string {
  const id = uuidv7();
  db.insert(allocationRunLines)
    .values({
      id,
      runId: input.runId,
      bucketId: input.bucketId,
      proposedAmount: input.proposedAmount,
      confirmedAmount: input.confirmedAmount,
      ledgerEntryId: input.ledgerEntryId,
    })
    .run();
  return id;
}

function writeLedger(
  db: AppDb,
  input: {
    today: IsoDate;
    amount: Paise;
    fromAccountId: string;
    toAccountId: string;
    categoryId: string;
    type: Extract<LedgerType, "transfer" | "investment">;
    notes: string;
  },
): LedgerEntry {
  return insertLedgerEntry(db, {
    date: input.today,
    time: nowTimeIst(),
    type: input.type,
    amount: input.amount,
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    categoryId: input.categoryId,
    inBudget: false,
    notes: input.notes,
    source: "allocation",
  });
}

function bucketNameMap(db: AppDb): Map<string, string> {
  return new Map(
    db
      .select({ id: buckets.id, name: buckets.name })
      .from(buckets)
      .all()
      .map((row) => [row.id, row.name] as const),
  );
}

function knownBucketIds(db: AppDb): Set<string> {
  return new Set(db.select({ id: buckets.id }).from(buckets).all().map((row) => row.id));
}

export function saveAllocationRun(
  db: AppDb,
  input: SaveRunInput,
  liveFree: Paise,
): AllocationRunView {
  requirePositiveFree(liveFree);
  requireSurplus(input.surplusInput, liveFree, input.overrideReason);
  const known = knownBucketIds(db);
  for (const line of input.proposed) {
    if (!known.has(line.bucketId)) {
      throw new AllocationWriteError(`Unknown bucket: ${line.bucketId}.`);
    }
  }
  if (input.confirm) {
    const positive = input.confirmLines.filter((line) => line.amount > 0);
    if (positive.length === 0) {
      throw new AllocationWriteError("Nothing to allocate: every line is ₹0.");
    }
    for (const line of input.confirmLines) {
      if (!known.has(line.bucketId)) {
        throw new AllocationWriteError(`Unknown bucket: ${line.bucketId}.`);
      }
    }
  }

  const today = input.today ?? todayIst();
  const month = yearMonthFromIsoDate(today);
  const names = bucketNameMap(db);
  const reason = input.overrideReason?.trim() || null;

  if (input.confirm) {
    const { categoryId, accounts } = validateMoves(db, input.confirmLines, today);
    const byId = new Map(accounts.map((row) => [row.id, row]));
    const planId = getCurrentInvestPlan(db)?.id ?? null;
    db.transaction((tx) => {
      const runId = insertRunRow(tx, {
        month,
        surplusInput: input.surplusInput,
        overrideReason: reason,
        status: "confirmed",
        createdAt: nowIso(),
        confirmedAt: nowIso(),
        investPlanId: planId,
      });
      const proposedByBucket = new Map(input.proposed.map((row) => [row.bucketId, row.amount]));
      const seen = new Set<string>();
      for (const line of input.confirmLines) {
        seen.add(line.bucketId);
        let ledgerId: string | null = null;
        if (line.amount > 0) {
          const to = byId.get(line.toAccountId);
          if (!to) throw new AllocationWriteError("To account is missing.");
          const type = allocationLedgerType(to);
          const name = names.get(line.bucketId) ?? line.bucketId;
          const entry = writeLedger(tx, {
            today,
            amount: line.amount,
            fromAccountId: line.fromAccountId,
            toAccountId: line.toAccountId,
            categoryId,
            type,
            notes: `Allocate · ${name}`,
          });
          ledgerId = entry.id;
        }
        insertLineRow(tx, {
          runId,
          bucketId: line.bucketId,
          proposedAmount: proposedByBucket.get(line.bucketId) ?? line.amount,
          confirmedAmount: line.amount,
          ledgerEntryId: ledgerId,
        });
      }
      for (const line of input.proposed) {
        if (seen.has(line.bucketId)) continue;
        insertLineRow(tx, {
          runId,
          bucketId: line.bucketId,
          proposedAmount: line.amount,
          confirmedAmount: 0,
          ledgerEntryId: null,
        });
      }
      creditDipForAllocation(tx, {
        date: today,
        runId,
        investAmount: investmentAmountOf(input.confirmLines),
      });
    });
  } else {
    db.transaction((tx) => {
      const runId = insertRunRow(tx, {
        month,
        surplusInput: input.surplusInput,
        overrideReason: reason,
        status: "proposed",
        createdAt: nowIso(),
        confirmedAt: null,
        investPlanId: getCurrentInvestPlan(db)?.id ?? null,
      });
      for (const line of input.proposed) {
        insertLineRow(tx, {
          runId,
          bucketId: line.bucketId,
          proposedAmount: line.amount,
          confirmedAmount: null,
          ledgerEntryId: null,
        });
      }
    });
  }

  const latest = listAllocationRuns(db)[0];
  if (!latest) throw new Error("allocation run insert failed");
  if (input.confirm) takeSnapshot(db);
  return latest;
}

export function confirmAllocationRun(
  db: AppDb,
  runId: string,
  lines: ConfirmLineInput[],
  liveFree: Paise,
): AllocationRunView {
  const existing = db.select().from(allocationRuns).where(eq(allocationRuns.id, runId)).get();
  if (!existing) {
    throw new AllocationWriteError("Allocation run not found.", [], 404);
  }
  if (existing.status === "confirmed") {
    throw new AllocationWriteError(
      "Confirmed runs are not rewritten. Start a new run to amend.",
      [issue("status", "already_confirmed", "Confirmed runs are not rewritten.")],
      409,
    );
  }
  requirePositiveFree(liveFree);
  requireSurplus(existing.surplusInput, liveFree, existing.overrideReason);
  const positive = lines.filter((line) => line.amount > 0);
  if (positive.length === 0) {
    throw new AllocationWriteError("Nothing to allocate: every line is ₹0.");
  }
  const today = todayIst();
  const { categoryId, accounts } = validateMoves(db, lines, today);
  const byId = new Map(accounts.map((row) => [row.id, row]));
  const names = bucketNameMap(db);
  const storedLines = db
    .select()
    .from(allocationRunLines)
    .where(eq(allocationRunLines.runId, runId))
    .all();
  const storedByBucket = new Map(storedLines.map((row) => [row.bucketId, row]));

  db.transaction((tx) => {
    for (const line of lines) {
      const stored = storedByBucket.get(line.bucketId);
      if (!stored) {
        throw new AllocationWriteError(`Unknown bucket on this run: ${line.bucketId}.`);
      }
      let ledgerId: string | null = null;
      if (line.amount > 0) {
        const to = byId.get(line.toAccountId);
        if (!to) throw new AllocationWriteError("To account is missing.");
        const type = allocationLedgerType(to);
        const name = names.get(line.bucketId) ?? line.bucketId;
        const entry = writeLedger(tx, {
          today,
          amount: line.amount,
          fromAccountId: line.fromAccountId,
          toAccountId: line.toAccountId,
          categoryId,
          type,
          notes: `Allocate · ${name}`,
        });
        ledgerId = entry.id;
      }
      tx.update(allocationRunLines)
        .set({
          confirmedAmount: line.amount,
          ledgerEntryId: ledgerId,
        })
        .where(eq(allocationRunLines.id, stored.id))
        .run();
    }
    tx.update(allocationRuns)
      .set({
        status: "confirmed",
        confirmedAt: nowIso(),
        investPlanId: getCurrentInvestPlan(db)?.id ?? existing.investPlanId,
      })
      .where(eq(allocationRuns.id, runId))
      .run();
    creditDipForAllocation(tx, {
      date: today,
      runId,
      investAmount: investmentAmountOf(lines),
    });
  });

  const updated = getAllocationRun(db, runId);
  if (!updated) throw new Error("allocation confirm failed");
  takeSnapshot(db);
  return updated;
}
