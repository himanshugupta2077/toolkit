import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { AppDb, OpenedDb } from "./client.ts";
import { openDatabase } from "./client.ts";
import { defaultBackupDir, isMemoryDb, sqlQuote } from "./paths.ts";
import { meta } from "./schema.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export function backupStamp(now = new Date()): string {
  return now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function vacuumInto(
  sqlite: Database.Database,
  destFile: string,
): void {
  sqlite.exec(`VACUUM INTO ${sqlQuote(destFile)}`);
}

export function backupDatabase(
  sqlite: Database.Database,
  backupDir = defaultBackupDir(),
  now = new Date(),
): string {
  mkdirSync(backupDir, { recursive: true });
  const dest = join(backupDir, `finance-${backupStamp(now)}.sqlite`);
  vacuumInto(sqlite, dest);
  return dest;
}

export function recordLastBackup(db: AppDb, at = new Date()): void {
  const value = at.toISOString();
  db.insert(meta)
    .values({ key: "last_backup", value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run();
}

export function lastBackupAt(db: AppDb): string | null {
  const row = db.select().from(meta).where(eq(meta.key, "last_backup")).get();
  return row?.value ?? null;
}

export function maybeBackupOnStart(
  opened: OpenedDb,
  backupDir = defaultBackupDir(),
  now = new Date(),
): string | null {
  if (isMemoryDb(opened.dbFile)) return null;
  const last = lastBackupAt(opened.db);
  if (last) {
    const then = Date.parse(last);
    if (Number.isFinite(then) && now.getTime() - then < DAY_MS) return null;
  }
  const dest = backupDatabase(opened.sqlite, backupDir, now);
  recordLastBackup(opened.db, now);
  return dest;
}

const isCli =
  process.argv[1]?.endsWith("backup.ts") ||
  process.argv[1]?.endsWith("backup.js");

if (isCli) {
  const opened = openDatabase();
  const dest = backupDatabase(opened.sqlite);
  recordLastBackup(opened.db);
  console.log(dest);
  opened.sqlite.close();
}
