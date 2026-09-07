import {
  BP_SCALE,
  DEFAULT_INVEST_EFFECTIVE_FROM,
  DEFAULT_SAVINGS_BUFFER_TARGET,
  DEFAULT_THEME_THRESHOLD,
  GOLD_ASSET_NAME,
  rupeesToPaise,
  type InvestAssetKind,
  type Paise,
} from "../../src/engine/index.ts";
import {
  asPaise,
  asRupees,
  cellText,
  cellValue,
  hasHeaders,
  headerMap,
  normHeader,
  readWorkbook,
  sheetNamed,
  sheetRange,
  type Sheet,
} from "./cells.ts";
import { ImportError } from "./error.ts";
import type {
  ParsedInvestAsset,
  ParsedInvestGoal,
  ParsedInvestTier,
  ParsedInvestWorkbook,
} from "./investTypes.ts";
import type { ParseWarning } from "./types.ts";

const THEME_NAMES = new Set([
  "ai infrastructure",
  "automation & robotics",
  "automation and robotics",
  "electricity & grid",
  "electricity and grid",
  "defense & cyber",
  "defense and cyber",
  "defence & cyber",
  "defence and cyber",
]);

function warn(
  warnings: ParseWarning[],
  sheet: string,
  row: number | null,
  message: string,
): void {
  warnings.push({ sheet, row, message });
}

function compactName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const left = compactName(a);
  const right = compactName(b);
  return left === right || left.includes(right) || right.includes(left);
}

function ratioToBp(value: number): number {
  if (value <= 1) return Math.round(value * BP_SCALE);
  if (value <= 100) return Math.round(value * 100);
  return Math.round(value);
}

function parseBp(value: unknown): number | null {
  const n = asRupees(value);
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return ratioToBp(n);
}

function kindFor(name: string, themeNames: Set<string>): InvestAssetKind {
  const compact = compactName(name);
  if (themeNames.has(compact) || THEME_NAMES.has(compact)) return "theme";
  return "core";
}

function parseRupeeLabel(text: string): Paise | null {
  const match = /₹\s*([\d,]+)/.exec(text) ?? /(?:below|over|above)\s*([\d,]+)/i.exec(text);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return rupeesToPaise(n);
}

function findHeaderRow(
  ws: Sheet,
  needed: readonly string[],
  fromRow: number,
  toRow: number,
  maxCol = 8,
): { row: number; cols: Map<string, number> } | null {
  for (let row = fromRow; row <= toRow; row++) {
    const cols = headerMap(ws, row, maxCol);
    if (hasHeaders(cols, needed)) return { row, cols };
  }
  return null;
}

function parseSipDip(
  ws: Sheet,
  warnings: ParseWarning[],
): { sipBp: number; dipReserveBp: number } {
  const { rows } = sheetRange(ws);
  let sipBp: number | null = null;
  let dipReserveBp: number | null = null;
  for (let row = 1; row <= Math.min(rows, 20); row++) {
    const label = normHeader(cellValue(ws, row, 1));
    const bp = parseBp(cellValue(ws, row, 2));
    if (label === "sip" || label.startsWith("sip ")) sipBp = bp;
    if (label.includes("dip") && label.includes("reserve") && !label.includes("pool")) {
      dipReserveBp = bp;
    }
  }
  if (sipBp == null || dipReserveBp == null || sipBp + dipReserveBp !== BP_SCALE) {
    warn(
      warnings,
      "Investing",
      2,
      "SIP / dip reserve missing or not 100%; using 70/30.",
    );
    return { sipBp: 7_000, dipReserveBp: 3_000 };
  }
  return { sipBp, dipReserveBp };
}

function parseDipRanks(ws: Sheet): Map<string, number> {
  const { rows, cols } = sheetRange(ws);
  let dipCol = 10;
  for (let col = 1; col <= Math.min(cols, 12); col++) {
    if (normHeader(cellValue(ws, 1, col)).includes("dip buy")) {
      dipCol = col;
      break;
    }
  }
  const ranks = new Map<string, number>();
  for (let row = 2; row <= Math.min(rows, 20); row++) {
    const text = cellText(cellValue(ws, row, dipCol));
    const match = /^(\d+)\s+(.+)$/.exec(text.trim());
    if (!match) continue;
    ranks.set(compactName(match[2]), Number(match[1]));
  }
  return ranks;
}

function parseThemeWeights(ws: Sheet): Map<string, { bp: number; row: number }> {
  const { rows } = sheetRange(ws);
  const out = new Map<string, { bp: number; row: number }>();
  let headerRow: number | null = null;
  for (let row = 1; row <= Math.min(rows, 20); row++) {
    if (normHeader(cellValue(ws, row, 6)) === "theme") {
      headerRow = row;
      break;
    }
  }
  if (headerRow == null) return out;
  for (let row = headerRow + 1; row <= Math.min(rows, headerRow + 12); row++) {
    const name = cellText(cellValue(ws, row, 6));
    if (!name) continue;
    if (normHeader(name) === "theme") continue;
    const bp = parseBp(cellValue(ws, row, 7));
    if (bp == null) continue;
    out.set(compactName(name), { bp, row });
  }
  return out;
}

function parseThemeTiers(
  ws: Sheet,
  themeNames: string[],
  warnings: ParseWarning[],
): ParsedInvestTier[] {
  const { rows } = sheetRange(ws);
  const tiers: ParsedInvestTier[] = [];
  for (let row = 1; row <= Math.min(rows, 12); row++) {
    const label = cellText(cellValue(ws, row, 6));
    const allowedRaw = cellText(cellValue(ws, row, 7));
    const compact = normHeader(label);
    if (!compact.includes("below") && !compact.includes("20 000") && !compact.includes("investment")) {
      continue;
    }
    if (!allowedRaw) continue;
    const belowAmount = compact.includes("below") ? parseRupeeLabel(label) : null;
    const allowedLower = allowedRaw.toLowerCase();
    const allowedNames = allowedLower.includes("all theme")
      ? themeNames
      : [allowedRaw.replace(/\bonly\b/gi, "").trim()].filter(Boolean);
    const id = belowAmount == null ? "at_or_above_threshold" : "below_threshold";
    if (tiers.some((tier) => tier.id === id)) continue;
    tiers.push({ id, belowAmount, allowedNames });
  }
  if (tiers.length === 0) {
    warn(warnings, "Investing", 2, "Theme engine missing; using ₹20,000 AI-only / all themes.");
    return [
      { id: "below_threshold", belowAmount: DEFAULT_THEME_THRESHOLD, allowedNames: ["AI Infrastructure"] },
      { id: "at_or_above_threshold", belowAmount: null, allowedNames: themeNames },
    ];
  }
  if (!tiers.some((tier) => tier.belowAmount == null)) {
    tiers.push({ id: "at_or_above_threshold", belowAmount: null, allowedNames: themeNames });
  }
  if (!tiers.some((tier) => tier.belowAmount != null)) {
    tiers.unshift({
      id: "below_threshold",
      belowAmount: DEFAULT_THEME_THRESHOLD,
      allowedNames: ["AI Infrastructure"],
    });
  }
  return tiers;
}

function parseAssets(ws: Sheet, warnings: ParseWarning[]): ParsedInvestAsset[] {
  const { rows } = sheetRange(ws);
  const found = findHeaderRow(ws, ["asset", "target"], 1, 16, 4);
  if (!found) {
    throw new ImportError("Investing sheet is missing the Asset table.");
  }
  const themeWeights = parseThemeWeights(ws);
  const themeNames = new Set(themeWeights.keys());
  const dipRanks = parseDipRanks(ws);
  const out: ParsedInvestAsset[] = [];
  const seen = new Set<string>();

  const add = (
    name: string,
    targetBp: number,
    instrumentNote: string,
    row: number,
    kindHint?: InvestAssetKind,
  ) => {
    const key = compactName(name);
    if (!name || seen.has(key)) return;
    seen.add(key);
    let dipPriority: number | null = null;
    for (const [dipName, rank] of dipRanks) {
      if (namesMatch(dipName, name)) {
        dipPriority = rank;
        break;
      }
    }
    const kind = kindHint ?? kindFor(name, themeNames);
    const isGold = compactName(name) === compactName(GOLD_ASSET_NAME);
    out.push({
      name,
      kind,
      targetBp,
      dipPriority,
      instrumentNote,
      active: !isGold,
      sheetRow: row,
    });
  };

  for (let row = found.row + 1; row <= Math.min(rows, found.row + 20); row++) {
    const name = cellText(cellValue(ws, row, found.cols.get("asset") ?? 1));
    if (!name) {
      if (out.length > 0) break;
      continue;
    }
    const bp = parseBp(cellValue(ws, row, found.cols.get("target") ?? 2));
    if (bp == null) {
      warn(warnings, "Investing", row, `Skip asset ${name}: no target %.`);
      continue;
    }
    add(name, bp, cellText(cellValue(ws, row, 4)), row);
  }

  for (const [key, info] of themeWeights) {
    if (seen.has(key)) continue;
    const display = [...THEME_NAMES].includes(key)
      ? key.replace(/\b\w/g, (ch) => ch.toUpperCase())
      : key;
    const named = cellText(cellValue(ws, info.row, 6)) || display;
    add(named, info.bp, "", info.row, "theme");
  }

  if (out.length === 0) {
    throw new ImportError("Investing sheet has no assets.");
  }
  return out;
}

function parseGoals(ws: Sheet | null, warnings: ParseWarning[]): ParsedInvestGoal[] {
  if (!ws) {
    warn(warnings, "Goal Fund", null, "Sheet missing; no goals imported.");
    return [];
  }
  const found = findHeaderRow(ws, ["goal"], 1, 6, 4);
  if (!found) {
    warn(warnings, "Goal Fund", null, "Could not find the Goal table.");
    return [];
  }
  const { rows } = sheetRange(ws);
  const out: ParsedInvestGoal[] = [];
  for (let row = found.row + 1; row <= Math.min(rows, found.row + 20); row++) {
    const name = cellText(cellValue(ws, row, found.cols.get("goal") ?? 1));
    if (!name) {
      if (out.length > 0) break;
      continue;
    }
    const alloc = asRupees(cellValue(ws, row, found.cols.get("target allocation") ?? 2));
    let notes = "";
    if (alloc != null && alloc > 0) {
      const pct = alloc <= 1 ? alloc * 100 : alloc;
      notes = `sheet allocation ${pct}%`;
    }
    out.push({
      name,
      targetAmount: null,
      notes,
      sheetRow: row,
    });
  }
  return out;
}

function parseSavingsTarget(ws: Sheet | null, warnings: ParseWarning[]): Paise {
  if (!ws) {
    warn(warnings, "Config", null, "Sheet missing; Savings target ₹10,000.");
    return DEFAULT_SAVINGS_BUFFER_TARGET;
  }
  const { rows } = sheetRange(ws);
  for (let row = 1; row <= Math.min(rows, 40); row++) {
    const label = normHeader(cellValue(ws, row, 1));
    if (!label.includes("hard cash")) continue;
    const amount = asPaise(cellValue(ws, row, 3)) ?? asPaise(cellValue(ws, row, 2));
    if (amount != null && amount >= 0) return amount;
  }
  warn(warnings, "Config", 6, "Hard cash amount missing; Savings target ₹10,000.");
  return DEFAULT_SAVINGS_BUFFER_TARGET;
}

export function parseInvestWorkbook(buf: Buffer): ParsedInvestWorkbook {
  const wb = readWorkbook(buf);
  const investing = sheetNamed(wb, "Investing");
  if (!investing) throw new ImportError("Workbook has no Investing sheet.");
  const warnings: ParseWarning[] = [];
  const { sipBp, dipReserveBp } = parseSipDip(investing, warnings);
  const assets = parseAssets(investing, warnings);
  const themeNames = assets.filter((row) => row.kind === "theme").map((row) => row.name);
  const themeTiers = parseThemeTiers(investing, themeNames, warnings);
  const goals = parseGoals(sheetNamed(wb, "Goal Fund"), warnings);
  const savingsTarget = parseSavingsTarget(sheetNamed(wb, "Config"), warnings);
  return {
    sipBp,
    dipReserveBp,
    savingsTarget,
    effectiveFrom: DEFAULT_INVEST_EFFECTIVE_FROM,
    assets,
    themeTiers,
    goals,
    warnings,
  };
}
