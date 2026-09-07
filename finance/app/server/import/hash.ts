import { createHash } from "node:crypto";
import type { ParsedLedgerRow } from "./types.ts";

export function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function canonicalLedger(row: Omit<ParsedLedgerRow, "sourceHash" | "sheetRow">): string {
  const budget =
    row.inBudget == null ? "" : row.inBudget ? "1" : "0";
  return [
    row.date,
    row.time ?? "",
    row.type,
    String(row.amount),
    row.fromName,
    row.toName,
    row.categoryName,
    budget,
    row.notes,
  ].join("\u001f");
}

export function assignLedgerHashes(
  rows: Omit<ParsedLedgerRow, "sourceHash">[],
): ParsedLedgerRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = canonicalLedger(row);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    const digest = sha256Hex(key);
    const sourceHash = n === 1 ? `excel:${digest}` : `excel:${digest}:${n}`;
    return { ...row, sourceHash };
  });
}
