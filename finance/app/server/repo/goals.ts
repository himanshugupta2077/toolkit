import { desc, eq } from "drizzle-orm";
import {
  DEFAULT_BUCKET_IDS,
  isGoalStatus,
  isIsoDate,
  isPaise,
  type Goal,
  type GoalContribution,
  type GoalStatus,
  type IsoDate,
  type LedgerEntry,
  type Paise,
} from "../../src/engine/index.ts";
import type { AppDb } from "../db/client.ts";
import { buckets, goalContributions, goals } from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import { mapGoal, mapGoalContribution } from "./mappers.ts";

export class GoalWriteError extends Error {
  status: 400 | 404;

  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.name = "GoalWriteError";
    this.status = status;
  }
}

export type NewGoalInput = {
  name: string;
  targetAmount: Paise | null;
  targetDate: IsoDate | null;
  fundingBucketId: string;
  notes: string;
  status?: GoalStatus;
  priority?: number;
};

export type GoalPatch = {
  name?: string;
  targetAmount?: Paise | null;
  targetDate?: IsoDate | null;
  fundingBucketId?: string;
  notes?: string;
  status?: GoalStatus;
  priority?: number;
};

export type NewContributionInput = {
  goalId: string;
  date: IsoDate;
  amount: Paise;
  note: string;
  ledgerEntryId: string | null;
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

function parseTargetAmount(value: unknown): Paise | null {
  if (value == null || value === "") return null;
  const n = asFiniteNumber(value);
  if (n == null || !isPaise(n) || n <= 0) {
    throw new GoalWriteError("Target must be a positive amount, or blank.");
  }
  return n;
}

function parseTargetDate(value: unknown): IsoDate | null {
  if (value == null || value === "") return null;
  const date = asString(value).trim();
  if (!isIsoDate(date)) throw new GoalWriteError("Target date must be YYYY-MM-DD.");
  return date;
}

function bucketExists(db: AppDb, id: string): boolean {
  return db.select({ id: buckets.id }).from(buckets).where(eq(buckets.id, id)).get() != null;
}

export function getGoal(db: AppDb, id: string): Goal | null {
  const row = db.select().from(goals).where(eq(goals.id, id)).get();
  return row ? mapGoal(row) : null;
}

export function listGoalContributions(db: AppDb, goalId?: string): GoalContribution[] {
  const rows =
    goalId == null
      ? db.select().from(goalContributions).orderBy(desc(goalContributions.date)).all()
      : db
          .select()
          .from(goalContributions)
          .where(eq(goalContributions.goalId, goalId))
          .orderBy(desc(goalContributions.date))
          .all();
  return rows.map(mapGoalContribution);
}

function nextPriority(db: AppDb): number {
  const rows = db.select({ priority: goals.priority }).from(goals).all();
  let max = 0;
  for (const row of rows) if (row.priority > max) max = row.priority;
  return max + 1;
}

export function parseCreateGoal(body: unknown): NewGoalInput {
  if (body == null || typeof body !== "object") {
    throw new GoalWriteError("invalid json");
  }
  const rec = body as Record<string, unknown>;
  const name = asString(rec.name).trim();
  if (name === "") throw new GoalWriteError("Name is required.");
  const fundingBucketId =
    asString(rec.fundingBucketId).trim() || DEFAULT_BUCKET_IDS.savingsBuffer;
  return {
    name,
    targetAmount: parseTargetAmount(rec.targetAmount),
    targetDate: parseTargetDate(rec.targetDate),
    fundingBucketId,
    notes: asString(rec.notes).trim(),
    status: rec.status == null ? "active" : undefined,
  };
}

export function parsePatchGoal(body: unknown): GoalPatch {
  if (body == null || typeof body !== "object") {
    throw new GoalWriteError("invalid json");
  }
  const rec = body as Record<string, unknown>;
  const patch: GoalPatch = {};
  if ("name" in rec) {
    const name = asString(rec.name).trim();
    if (name === "") throw new GoalWriteError("Name is required.");
    patch.name = name;
  }
  if ("targetAmount" in rec) patch.targetAmount = parseTargetAmount(rec.targetAmount);
  if ("targetDate" in rec) patch.targetDate = parseTargetDate(rec.targetDate);
  if ("fundingBucketId" in rec) {
    const id = asString(rec.fundingBucketId).trim();
    if (id === "") throw new GoalWriteError("Funding bucket is required.");
    patch.fundingBucketId = id;
  }
  if ("notes" in rec) patch.notes = asString(rec.notes).trim();
  if ("status" in rec) {
    const status = asString(rec.status);
    if (!isGoalStatus(status)) throw new GoalWriteError("Unknown goal status.");
    patch.status = status;
  }
  if ("priority" in rec) {
    const n = asFiniteNumber(rec.priority);
    if (n == null || !Number.isInteger(n) || n < 1) {
      throw new GoalWriteError("Priority must be an integer ≥ 1.");
    }
    patch.priority = n;
  }
  return patch;
}

export function parseContributeBody(
  body: unknown,
  fallbackDate: IsoDate,
): Omit<NewContributionInput, "goalId" | "ledgerEntryId"> {
  if (body == null || typeof body !== "object") {
    throw new GoalWriteError("invalid json");
  }
  const rec = body as Record<string, unknown>;
  const dateRaw = asString(rec.date).trim() || fallbackDate;
  if (!isIsoDate(dateRaw)) throw new GoalWriteError("Date must be YYYY-MM-DD.");
  const amount = asFiniteNumber(rec.amount);
  if (amount == null || !isPaise(amount) || amount <= 0) {
    throw new GoalWriteError("Amount must be a positive number of paise.");
  }
  const note = asString(rec.note).trim();
  if (note === "") {
    throw new GoalWriteError("A note is required when there is no bank move.");
  }
  return { date: dateRaw, amount, note };
}

export function parseGoalOrder(body: unknown): string[] {
  if (body == null || typeof body !== "object") {
    throw new GoalWriteError("invalid json");
  }
  const ids = (body as Record<string, unknown>).ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new GoalWriteError("ids must be a list of goal ids.");
  }
  return ids.map((id) => String(id));
}

export function insertGoal(db: AppDb, input: NewGoalInput, at = nowIso()): Goal {
  if (!bucketExists(db, input.fundingBucketId)) {
    throw new GoalWriteError("Unknown funding bucket.");
  }
  const id = uuidv7();
  db.insert(goals)
    .values({
      id,
      name: input.name,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate,
      priority: input.priority ?? nextPriority(db),
      fundingBucketId: input.fundingBucketId,
      status: input.status ?? "active",
      notes: input.notes,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  const row = getGoal(db, id);
  if (!row) throw new GoalWriteError("could not create goal");
  return row;
}

export function updateGoal(db: AppDb, id: string, patch: GoalPatch, at = nowIso()): Goal | null {
  const current = getGoal(db, id);
  if (!current) return null;
  if (patch.fundingBucketId != null && !bucketExists(db, patch.fundingBucketId)) {
    throw new GoalWriteError("Unknown funding bucket.");
  }
  db.update(goals)
    .set({
      name: patch.name ?? current.name,
      targetAmount: patch.targetAmount === undefined ? current.targetAmount : patch.targetAmount,
      targetDate: patch.targetDate === undefined ? current.targetDate : patch.targetDate,
      fundingBucketId: patch.fundingBucketId ?? current.fundingBucketId,
      notes: patch.notes ?? current.notes,
      status: patch.status ?? current.status,
      priority: patch.priority ?? current.priority,
      updatedAt: at,
    })
    .where(eq(goals.id, id))
    .run();
  return getGoal(db, id);
}

export function reorderGoals(db: AppDb, ids: string[], at = nowIso()): void {
  const existing = db.select({ id: goals.id }).from(goals).all().map((row) => row.id);
  if (ids.length !== existing.length) {
    throw new GoalWriteError("ids must include every goal once.");
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (!existing.includes(id) || seen.has(id)) {
      throw new GoalWriteError("ids must include every goal once.");
    }
    seen.add(id);
  }
  db.transaction((tx) => {
    ids.forEach((id, index) => {
      tx.update(goals)
        .set({ priority: index + 1, updatedAt: at })
        .where(eq(goals.id, id))
        .run();
    });
  });
}

function fundedAmount(db: AppDb, goalId: string): Paise {
  let total: Paise = 0;
  for (const row of listGoalContributions(db, goalId)) total += row.amount;
  return total;
}

function maybeMarkAchieved(db: AppDb, goalId: string, at = nowIso()): void {
  const goal = getGoal(db, goalId);
  if (!goal || goal.status !== "active" || goal.targetAmount == null) return;
  if (fundedAmount(db, goalId) >= goal.targetAmount) {
    db.update(goals)
      .set({ status: "achieved", updatedAt: at })
      .where(eq(goals.id, goalId))
      .run();
  }
}

export function insertContribution(db: AppDb, input: NewContributionInput): GoalContribution {
  const goal = getGoal(db, input.goalId);
  if (!goal) throw new GoalWriteError("Goal not found.", 404);
  if (!isIsoDate(input.date)) throw new GoalWriteError("Date must be YYYY-MM-DD.");
  if (!isPaise(input.amount) || input.amount <= 0) {
    throw new GoalWriteError("Amount must be a positive number of paise.");
  }
  if (input.ledgerEntryId == null && input.note.trim() === "") {
    throw new GoalWriteError("A note is required when there is no bank move.");
  }
  const id = uuidv7();
  db.insert(goalContributions)
    .values({
      id,
      goalId: input.goalId,
      date: input.date,
      amount: input.amount,
      ledgerEntryId: input.ledgerEntryId,
      note: input.note,
    })
    .run();
  maybeMarkAchieved(db, input.goalId);
  const row = db.select().from(goalContributions).where(eq(goalContributions.id, id)).get();
  if (!row) throw new GoalWriteError("could not record contribution");
  return mapGoalContribution(row);
}

export function contributeFromLedger(db: AppDb, entry: LedgerEntry): GoalContribution | null {
  if (entry.goalId == null) return null;
  return insertContribution(db, {
    goalId: entry.goalId,
    date: entry.date,
    amount: entry.amount,
    note: entry.notes.trim() || "From Quick Add",
    ledgerEntryId: entry.id,
  });
}
