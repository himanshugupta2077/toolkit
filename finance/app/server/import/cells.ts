import * as XLSX from "xlsx";
import { rupeesToPaise, type Paise } from "../../src/engine/money.ts";

export type Sheet = XLSX.WorkSheet;

export function readWorkbook(buf: Buffer): XLSX.WorkBook {
  return XLSX.read(buf, {
    type: "buffer",
    raw: true,
    cellFormula: true,
    cellDates: false,
  });
}

export function sheetNamed(wb: XLSX.WorkBook, name: string): Sheet | null {
  const found = wb.SheetNames.find(
    (sheet) => sheet.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  return found ? wb.Sheets[found] : null;
}

export function sheetRange(ws: Sheet): { rows: number; cols: number } {
  const ref = ws["!ref"];
  if (!ref) return { rows: 0, cols: 0 };
  const decoded = XLSX.utils.decode_range(ref);
  return { rows: decoded.e.r + 1, cols: decoded.e.c + 1 };
}

export function rawCell(ws: Sheet, row1: number, col1: number): XLSX.CellObject | undefined {
  const addr = XLSX.utils.encode_cell({ r: row1 - 1, c: col1 - 1 });
  return ws[addr] as XLSX.CellObject | undefined;
}

export function cellValue(ws: Sheet, row1: number, col1: number): unknown {
  return rawCell(ws, row1, col1)?.v;
}

export function cellFormula(ws: Sheet, row1: number, col1: number): string | undefined {
  const formula = rawCell(ws, row1, col1)?.f;
  return typeof formula === "string" ? formula : undefined;
}

export function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

export function normHeader(value: unknown): string {
  return cellText(value)
    .toLowerCase()
    .replace(/[₹?()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function headerMap(ws: Sheet, row1: number, maxCol = 16): Map<string, number> {
  const map = new Map<string, number>();
  for (let col = 1; col <= maxCol; col++) {
    const key = normHeader(cellValue(ws, row1, col));
    if (key && !map.has(key)) map.set(key, col);
  }
  return map;
}

export function hasHeaders(map: Map<string, number>, needed: readonly string[]): boolean {
  return needed.every((key) => map.has(key));
}

export function asBool(value: unknown, formula?: string): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const raw = `${cellText(value)} ${formula ?? ""}`.trim().toLowerCase();
  if (!raw) return null;
  if (
    raw === "true" ||
    raw === "true()" ||
    raw === "=true()" ||
    raw.startsWith("yes")
  ) {
    return true;
  }
  if (
    raw === "false" ||
    raw === "false()" ||
    raw === "=false()" ||
    raw.startsWith("no")
  ) {
    return false;
  }
  return null;
}

export function asRupees(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[,₹\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function asPaise(value: unknown): Paise | null {
  const rupees = asRupees(value);
  if (rupees == null) return null;
  return rupeesToPaise(rupees);
}

export function configCellRef(formula: string | undefined): { col: string; row: number } | null {
  if (!formula) return null;
  const match = /configuration!\$?([a-z]+)\$?(\d+)/i.exec(formula);
  if (!match) return null;
  return { col: match[1].toUpperCase(), row: Number(match[2]) };
}

export function slugId(prefix: string, name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${prefix}_${slug || "unnamed"}`;
}
