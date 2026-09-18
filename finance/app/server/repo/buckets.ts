import { eq } from "drizzle-orm";
import {
  isFillMode,
  isPaise,
  isTargetRule,
  validateBuckets,
  type Bucket,
  type BucketIssue,
  type FillMode,
  type Paise,
  type TargetRule,
} from "../../src/engine/index.ts";
import type { AppDb } from "../db/client.ts";
import { accounts, buckets } from "../db/schema.ts";
import { nowIso } from "../ids.ts";
import { listAccounts, listBuckets } from "./store.ts";

export type BucketWrite = Bucket & { accountIds: string[] };

export class BucketWriteError extends Error {
  issues: BucketIssue[];

  constructor(issues: BucketIssue[]) {
    super(issues[0]?.message ?? "invalid buckets");
    this.name = "BucketWriteError";
    this.issues = issues;
  }
}

function issue(field: string, code: string, message: string): BucketIssue {
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

function asNullableInt(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  const n = asFiniteNumber(value);
  if (n == null || !Number.isInteger(n)) return "invalid";
  return n;
}

function asBool(value: unknown, fallback: boolean): boolean | "invalid" {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  return "invalid";
}

function parseOne(raw: unknown, index: number): { ok: true; value: BucketWrite } | { ok: false; error: string } {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, error: `Bucket ${index + 1} is not an object.` };
  }
  const body = raw as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (id === "") return { ok: false, error: `Bucket ${index + 1} needs an id.` };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "") return { ok: false, error: `${id}: name is required.` };

  const priorityRaw = asFiniteNumber(body.priority);
  if (priorityRaw == null || !Number.isInteger(priorityRaw) || priorityRaw < 1) {
    return { ok: false, error: `${id}: priority must be an integer ≥ 1.` };
  }

  const targetRuleRaw = typeof body.targetRule === "string" ? body.targetRule : "";
  if (!isTargetRule(targetRuleRaw)) return { ok: false, error: `${id}: unknown target rule.` };
  const targetRule = targetRuleRaw as TargetRule;

  const fillModeRaw = typeof body.fillMode === "string" ? body.fillMode : "";
  if (!isFillMode(fillModeRaw)) return { ok: false, error: `${id}: unknown fill mode.` };
  const fillMode = fillModeRaw as FillMode;

  const targetAmount = asNullableInt(body.targetAmount);
  if (targetAmount === "invalid") return { ok: false, error: `${id}: target amount must be integer paise.` };
  const targetMonths = asNullableInt(body.targetMonths);
  if (targetMonths === "invalid") return { ok: false, error: `${id}: target months must be an integer.` };
  const fillValue = asNullableInt(body.fillValue);
  if (fillValue === "invalid") return { ok: false, error: `${id}: fill value must be an integer.` };
  const minMonthly = asNullableInt(body.minMonthly);
  if (minMonthly === "invalid") return { ok: false, error: `${id}: min monthly must be integer paise.` };
  if (minMonthly != null && (minMonthly < 0 || !isPaise(minMonthly))) {
    return { ok: false, error: `${id}: min monthly must be non-negative paise.` };
  }

  const active = asBool(body.active, true);
  if (active === "invalid") return { ok: false, error: `${id}: active must be true or false.` };

  const accountIdsRaw = body.accountIds;
  const accountIds: string[] = [];
  if (accountIdsRaw != null) {
    if (!Array.isArray(accountIdsRaw) || accountIdsRaw.some((id) => typeof id !== "string")) {
      return { ok: false, error: `${id}: accountIds must be a list of account ids.` };
    }
    for (const accId of accountIdsRaw) {
      const trimmed = accId.trim();
      if (trimmed && !accountIds.includes(trimmed)) accountIds.push(trimmed);
    }
  }

  const notes = typeof body.notes === "string" ? body.notes : "";
  const colour = typeof body.colour === "string" ? body.colour.trim().slice(0, 32) : "";

  const value: BucketWrite = {
    id,
    name,
    priority: priorityRaw,
    targetRule,
    targetAmount: targetRule === "fixed" ? targetAmount : null,
    targetMonths: targetRule === "months_of_essentials" ? targetMonths : null,
    fillMode,
    fillValue: fillMode === "percent" || fillMode === "fixed" ? fillValue : null,
    minMonthly: minMonthly as Paise | null,
    active,
    notes,
    colour,
    accountIds,
  };
  return { ok: true, value };
}

export function parseBucketWrites(
  body: unknown,
): { ok: true; value: BucketWrite[] } | { ok: false; error: string; issues?: BucketIssue[] } {
  if (body == null || typeof body !== "object") {
    return { ok: false, error: "invalid json" };
  }
  const bucketsRaw = (body as { buckets?: unknown }).buckets;
  if (!Array.isArray(bucketsRaw) || bucketsRaw.length === 0) {
    return { ok: false, error: "buckets must be a non-empty list." };
  }
  const writes: BucketWrite[] = [];
  for (let i = 0; i < bucketsRaw.length; i += 1) {
    const parsed = parseOne(bucketsRaw[i], i);
    if (!parsed.ok) return parsed;
    writes.push(parsed.value);
  }
  return { ok: true, value: writes };
}

export function saveBuckets(db: AppDb, writes: BucketWrite[], at = nowIso()): void {
  const checked = validateBuckets(writes);
  if (!checked.ok) throw new BucketWriteError(checked.issues);

  const prios = writes.map((row) => row.priority);
  if (new Set(prios).size !== prios.length) {
    throw new BucketWriteError([
      issue("priority", "duplicate_priority", "Each bucket needs a unique priority."),
    ]);
  }

  const existing = listBuckets(db);
  const existingIds = new Set(existing.map((row) => row.id));
  const writeIds = new Set(writes.map((row) => row.id));
  if (existingIds.size !== writeIds.size || [...existingIds].some((id) => !writeIds.has(id))) {
    throw new BucketWriteError([
      issue(
        "id",
        "bucket_set",
        "Send every existing bucket. Adding or removing buckets is not in this phase.",
      ),
    ]);
  }

  const allAccounts = listAccounts(db);
  const accountById = new Map(allAccounts.map((row) => [row.id, row]));
  const assigned = new Map<string, string>();
  for (const bucket of writes) {
    for (const accountId of bucket.accountIds) {
      const account = accountById.get(accountId);
      if (!account) {
        throw new BucketWriteError([
          issue("accountIds", "unknown_account", `Unknown account: ${accountId}.`),
        ]);
      }
      if (account.type === "virtual") {
        throw new BucketWriteError([
          issue(
            "accountIds",
            "virtual_account",
            `${account.name} is virtual and cannot be tagged to a bucket.`,
          ),
        ]);
      }
      if (assigned.has(accountId)) {
        throw new BucketWriteError([
          issue(
            "accountIds",
            "duplicate_account",
            `${account.name} is tagged to more than one bucket.`,
          ),
        ]);
      }
      assigned.set(accountId, bucket.id);
    }
  }

  db.transaction((tx) => {
    writes.forEach((bucket, index) => {
      tx.update(buckets)
        .set({ priority: 10_000 + index, updatedAt: at })
        .where(eq(buckets.id, bucket.id))
        .run();
    });
    for (const bucket of writes) {
      tx.update(buckets)
        .set({
          name: bucket.name,
          priority: bucket.priority,
          targetRule: bucket.targetRule,
          targetAmount: bucket.targetAmount,
          targetMonths: bucket.targetMonths,
          fillMode: bucket.fillMode,
          fillValue: bucket.fillValue,
          minMonthly: bucket.minMonthly,
          active: bucket.active,
          colour: bucket.colour,
          notes: bucket.notes,
          updatedAt: at,
        })
        .where(eq(buckets.id, bucket.id))
        .run();
    }

    for (const account of allAccounts) {
      if (account.type === "virtual") continue;
      const next = assigned.get(account.id) ?? null;
      if (account.bucketId === next) continue;
      tx.update(accounts)
        .set({ bucketId: next, updatedAt: at })
        .where(eq(accounts.id, account.id))
        .run();
    }
  });
}
