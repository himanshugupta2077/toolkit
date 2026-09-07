import { eq } from "drizzle-orm";
import { DEFAULT_BUCKET_IDS } from "../../src/engine/waterfall.ts";
import type { AppDb } from "../db/client.ts";
import { accounts, buckets } from "../db/schema.ts";
import { insertDefaultBuckets } from "../db/seed.ts";
import { nowIso } from "../ids.ts";

/** Locked v1: FD → EF, ICICI Savings → Savings buffer, Mutual Fund → Investment. */
export const DEFAULT_ACCOUNT_BUCKET_BY_NAME: Readonly<Record<string, string>> = {
  fd: DEFAULT_BUCKET_IDS.emergencyFund,
  "icici savings": DEFAULT_BUCKET_IDS.savingsBuffer,
  "mutual fund": DEFAULT_BUCKET_IDS.investment,
};

export function ensureDefaultBuckets(db: AppDb, at = nowIso()): void {
  const row = db.select({ id: buckets.id }).from(buckets).get();
  if (row) return;
  insertDefaultBuckets(db, at);
}

export function tagDefaultAccountBuckets(db: AppDb): number {
  const have = new Set(db.select({ id: buckets.id }).from(buckets).all().map((row) => row.id));
  const rows = db.select().from(accounts).all();
  let tagged = 0;
  for (const row of rows) {
    const bucketId = DEFAULT_ACCOUNT_BUCKET_BY_NAME[row.name.trim().toLowerCase()];
    if (!bucketId || !have.has(bucketId) || row.bucketId === bucketId) continue;
    db.update(accounts).set({ bucketId }).where(eq(accounts.id, row.id)).run();
    tagged += 1;
  }
  return tagged;
}
