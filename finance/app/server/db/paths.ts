import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const SCHEMA_VERSION = "7";

export function defaultDbFile(): string {
  return process.env.FINANCE_DB ?? join(process.cwd(), "data", "finance.sqlite");
}

export function defaultBackupDir(): string {
  return process.env.FINANCE_BACKUP_DIR ?? join(process.cwd(), "data", "backups");
}

export function isMemoryDb(file: string): boolean {
  return file === ":memory:";
}

export function ensureParentDir(file: string): void {
  if (isMemoryDb(file)) return;
  mkdirSync(dirname(file), { recursive: true });
}

export function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}