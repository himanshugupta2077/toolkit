import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";
import {
  defaultDbFile,
  ensureParentDir,
  isMemoryDb,
  SCHEMA_VERSION,
} from "./paths.ts";

export type AppDb = BetterSQLite3Database<typeof schema>;

export type OpenedDb = {
  sqlite: Database.Database;
  db: AppDb;
  dbFile: string;
};

const migrationsFolder = join(process.cwd(), "server/db/migrations");

export function applyPragmas(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
}

export function runMigrations(db: AppDb): void {
  migrate(db, { migrationsFolder });
}

export function openDatabase(file = defaultDbFile()): OpenedDb {
  ensureParentDir(file);
  const sqlite = new Database(file);
  applyPragmas(sqlite);
  const db = drizzle(sqlite, { schema });
  runMigrations(db);
  return { sqlite, db, dbFile: file };
}

export { SCHEMA_VERSION, isMemoryDb };
