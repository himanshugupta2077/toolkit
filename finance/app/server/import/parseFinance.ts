import { rupeesToPaise } from "../../src/engine/money.ts";
import { yearMonthFromIsoDate, type IsoDate } from "../../src/engine/dates.ts";
import {
  asBool,
  asPaise,
  cellFormula,
  cellText,
  cellValue,
  configCellRef,
  hasHeaders,
  headerMap,
  normHeader,
  rawCell,
  readWorkbook,
  sheetNamed,
  sheetRange,
  type Sheet,
} from "./cells.ts";
import { cellToIsoDate, cellToTime } from "./excelDate.ts";
import { FinanceImportError } from "./error.ts";
import { assignLedgerHashes } from "./hash.ts";
import {
  isEssentialCategory,
  mapAccountGroup,
  mapAccountType,
  mapFrequency,
  mapInflowStatus,
  mapKind,
  mapLedgerType,
  mapOneTimeStatus,
  mapPayFromAlias,
  mapPriority,
  mapVirtualKind,
} from "./mapValues.ts";
import {
  OPENING_DATE,
  type ParsedAccount,
  type ParsedCategory,
  type ParsedFinanceWorkbook,
  type ParsedInflow,
  type ParsedLedgerRow,
  type ParsedMonthBudget,
  type ParsedOneTime,
  type ParsedReconcile,
  type ParsedRecurring,
  type ParseWarning,
} from "./types.ts";

function warn(
  warnings: ParseWarning[],
  sheet: string,
  row: number | null,
  message: string,
): void {
  warnings.push({ sheet, row, message });
}

function col(map: Map<string, number>, ...keys: string[]): number | null {
  for (const key of keys) {
    const found = map.get(key);
    if (found != null) return found;
  }
  return null;
}

function valueAt(ws: Sheet, row: number, map: Map<string, number>, ...keys: string[]): unknown {
  const c = col(map, ...keys);
  return c == null ? undefined : cellValue(ws, row, c);
}

function textAt(ws: Sheet, row: number, map: Map<string, number>, ...keys: string[]): string {
  return cellText(valueAt(ws, row, map, ...keys));
}

function formulaAt(
  ws: Sheet,
  row: number,
  map: Map<string, number>,
  ...keys: string[]
): string | undefined {
  const c = col(map, ...keys);
  return c == null ? undefined : cellFormula(ws, row, c);
}

function dateAt(ws: Sheet, row: number, map: Map<string, number>, ...keys: string[]): IsoDate | null {
  return cellToIsoDate(valueAt(ws, row, map, ...keys));
}

function findHeaderRow(
  ws: Sheet,
  needed: readonly string[],
  fromRow: number,
  toRow: number,
): { row: number; cols: Map<string, number> } | null {
  for (let row = fromRow; row <= toRow; row++) {
    const cols = headerMap(ws, row);
    if (hasHeaders(cols, needed)) return { row, cols };
  }
  return null;
}

function parseSettings(ws: Sheet, warnings: ParseWarning[]): {
  defaultBudget: number;
  monthlySalary: number;
} {
  const { rows } = sheetRange(ws);
  let defaultBudget: number | null = null;
  let monthlySalary: number | null = null;
  for (let row = 1; row <= Math.min(rows, 20); row++) {
    const label = normHeader(cellValue(ws, row, 1));
    const paise = asPaise(cellValue(ws, row, 2));
    if (label.includes("default monthly budget") && paise != null) defaultBudget = paise;
    if (label.includes("monthly salary") && paise != null) monthlySalary = paise;
  }
  if (defaultBudget == null) {
    warn(warnings, "Configuration", 6, "Default monthly budget missing; using ₹31,000.");
    defaultBudget = rupeesToPaise(31_000);
  }
  if (monthlySalary == null) {
    warn(warnings, "Configuration", 7, "Monthly salary missing; using ₹0.");
    monthlySalary = 0;
  }
  return { defaultBudget, monthlySalary };
}

function parseAccounts(ws: Sheet, warnings: ParseWarning[]): ParsedAccount[] {
  const found = findHeaderRow(ws, ["account", "type", "opening balance"], 8, 16);
  if (!found) {
    throw new FinanceImportError("Configuration is missing the Accounts table.");
  }
  const { rows } = sheetRange(ws);
  const out: ParsedAccount[] = [];
  const seen = new Set<string>();
  for (let row = found.row + 1; row <= rows; row++) {
    const name = textAt(ws, row, found.cols, "account");
    if (!name) {
      if (out.length > 0 && row > found.row + 3) {
        const next = normHeader(cellValue(ws, row, 1));
        if (next === "categories" || next === "rules") break;
      }
      continue;
    }
    const next = normHeader(name);
    if (next === "categories" || next === "rules" || next === "category") break;
    const typeRaw = textAt(ws, row, found.cols, "type");
    const type = mapAccountType(typeRaw);
    if (!type) {
      warn(warnings, "Configuration", row, `Skip account ${name}: unknown type ${typeRaw}.`);
      continue;
    }
    const groupRaw = textAt(ws, row, found.cols, "account group");
    const group = mapAccountGroup(groupRaw);
    if (!group) {
      warn(warnings, "Configuration", row, `Skip account ${name}: unknown group ${groupRaw}.`);
      continue;
    }
    const opening = asPaise(valueAt(ws, row, found.cols, "opening balance")) ?? 0;
    const limit = asPaise(valueAt(ws, row, found.cols, "credit limit"));
    const nw =
      asBool(
        valueAt(ws, row, found.cols, "include in net worth"),
        formulaAt(ws, row, found.cols, "include in net worth"),
      ) ?? type !== "virtual";
    const liquid =
      asBool(
        valueAt(ws, row, found.cols, "include in liquid cash"),
        formulaAt(ws, row, found.cols, "include in liquid cash"),
      ) ?? false;
    if (seen.has(name.toLowerCase())) {
      warn(warnings, "Configuration", row, `Duplicate account ${name}; keeping the first.`);
      continue;
    }
    seen.add(name.toLowerCase());
    out.push({
      name,
      type,
      openingBalance: opening,
      openingDate: OPENING_DATE,
      creditLimit: limit,
      includeNetWorth: nw,
      includeLiquid: liquid,
      group,
      notes: textAt(ws, row, found.cols, "notes"),
      virtualKind: mapVirtualKind(name, type),
      sheetRow: row,
    });
  }
  if (out.length === 0) {
    throw new FinanceImportError("Configuration has no accounts.");
  }
  return out;
}

function parseCategories(ws: Sheet, warnings: ParseWarning[]): ParsedCategory[] {
  const { rows } = sheetRange(ws);
  let start = 1;
  for (let row = 1; row <= rows; row++) {
    if (normHeader(cellValue(ws, row, 1)) === "categories") {
      start = row;
      break;
    }
  }
  const found = findHeaderRow(ws, ["category"], start, Math.min(start + 6, rows));
  if (!found) {
    throw new FinanceImportError("Configuration is missing the Categories table.");
  }
  const out: ParsedCategory[] = [];
  const seen = new Set<string>();
  let sort = 0;
  for (let row = found.row + 1; row <= rows; row++) {
    const name = textAt(ws, row, found.cols, "category");
    if (!name) continue;
    const next = normHeader(name);
    if (next === "rules") break;
    if (seen.has(name.toLowerCase())) {
      warn(warnings, "Configuration", row, `Duplicate category ${name}; keeping the first.`);
      continue;
    }
    seen.add(name.toLowerCase());
    const group = textAt(ws, row, found.cols, "group") || "Other";
    const defaultInBudget =
      asBool(
        valueAt(ws, row, found.cols, "typical budget"),
        formulaAt(ws, row, found.cols, "typical budget"),
      ) ?? true;
    sort += 1;
    out.push({
      name,
      group,
      defaultInBudget,
      isEssential: isEssentialCategory(name, group),
      sort,
      sheetRow: row,
    });
  }
  if (out.length === 0) {
    throw new FinanceImportError("Configuration has no categories.");
  }
  return out;
}

function parseLedger(ws: Sheet, warnings: ParseWarning[]): Omit<ParsedLedgerRow, "sourceHash">[] {
  const found = findHeaderRow(ws, ["date", "type", "amount", "from account", "to account", "category"], 1, 5);
  if (!found) {
    throw new FinanceImportError("Ledger is missing the expected header row.");
  }
  const { rows } = sheetRange(ws);
  const out: Omit<ParsedLedgerRow, "sourceHash">[] = [];
  for (let row = found.row + 1; row <= rows; row++) {
    const dateVal = valueAt(ws, row, found.cols, "date");
    const typeRaw = textAt(ws, row, found.cols, "type");
    const amountVal = valueAt(ws, row, found.cols, "amount");
    if (dateVal == null && !typeRaw && amountVal == null) continue;
    const date = cellToIsoDate(dateVal);
    if (!date) {
      warn(warnings, "Ledger", row, "Skip row: date missing or invalid.");
      continue;
    }
    const type = mapLedgerType(typeRaw);
    if (!type) {
      warn(warnings, "Ledger", row, `Skip row: unknown type ${typeRaw}.`);
      continue;
    }
    const amount = asPaise(amountVal);
    if (amount == null || amount <= 0) {
      warn(warnings, "Ledger", row, "Skip row: amount must be greater than zero.");
      continue;
    }
    const fromName = textAt(ws, row, found.cols, "from account");
    const toName = textAt(ws, row, found.cols, "to account");
    const categoryName = textAt(ws, row, found.cols, "category");
    if (!fromName || !toName || !categoryName) {
      warn(warnings, "Ledger", row, "Skip row: From, To, or Category is blank.");
      continue;
    }
    const dateCell = rawCell(ws, row, col(found.cols, "date") ?? 1);
    const serial = typeof dateCell?.v === "number" ? dateCell.v : undefined;
    const time = cellToTime(valueAt(ws, row, found.cols, "time"), serial);
    const inBudget = asBool(
      valueAt(ws, row, found.cols, "include in budget"),
      formulaAt(ws, row, found.cols, "include in budget"),
    );
    out.push({
      date,
      time,
      type,
      amount,
      fromName,
      toName,
      categoryName,
      inBudget,
      notes: textAt(ws, row, found.cols, "notes"),
      sheetRow: row,
    });
  }
  return out;
}

function parseMonthBudgets(ws: Sheet | null, warnings: ParseWarning[]): ParsedMonthBudget[] {
  if (!ws) {
    warn(warnings, "Monthly Budget", null, "Sheet missing; month caps will use the default.");
    return [];
  }
  const found = findHeaderRow(ws, ["month start", "budget"], 15, 25);
  if (!found) {
    warn(warnings, "Monthly Budget", null, "Could not find the month-by-month grid.");
    return [];
  }
  const { rows } = sheetRange(ws);
  const out: ParsedMonthBudget[] = [];
  for (let row = found.row + 1; row <= rows; row++) {
    const start = cellToIsoDate(valueAt(ws, row, found.cols, "month start"));
    const cap = asPaise(valueAt(ws, row, found.cols, "budget"));
    if (!start && cap == null) {
      if (out.length > 0) break;
      continue;
    }
    if (!start || cap == null) continue;
    out.push({ month: yearMonthFromIsoDate(start), cap, sheetRow: row });
  }
  return out;
}

function parseRecurring(ws: Sheet, warnings: ParseWarning[]): ParsedRecurring[] {
  const found = findHeaderRow(ws, ["expense", "frequency", "amount", "active"], 12, 20);
  if (!found) {
    warn(warnings, "Planned Expenses", null, "Could not find the recurring table.");
    return [];
  }
  const { rows } = sheetRange(ws);
  const out: ParsedRecurring[] = [];
  for (let row = found.row + 1; row <= Math.min(rows, found.row + 55); row++) {
    const name = textAt(ws, row, found.cols, "expense");
    if (!name) continue;
    const title = normHeader(name);
    if (title.includes("upcoming one time") || title.includes("expected inflow")) break;
    const freqRaw = textAt(ws, row, found.cols, "frequency");
    const frequency = mapFrequency(freqRaw);
    if (!frequency) {
      warn(warnings, "Planned Expenses", row, `Skip recurring ${name}: unknown frequency.`);
      continue;
    }
    const amount = asPaise(valueAt(ws, row, found.cols, "amount"));
    if (amount == null || amount <= 0) {
      warn(warnings, "Planned Expenses", row, `Skip recurring ${name}: amount missing.`);
      continue;
    }
    const payRaw = textAt(ws, row, found.cols, "payment method");
    out.push({
      name,
      categoryName: textAt(ws, row, found.cols, "category") || "Other",
      frequency,
      amount,
      startDate: dateAt(ws, row, found.cols, "start"),
      endDate: dateAt(ws, row, found.cols, "end"),
      active:
        asBool(valueAt(ws, row, found.cols, "active"), formulaAt(ws, row, found.cols, "active")) ??
        true,
      kind: mapKind(textAt(ws, row, found.cols, "kind")),
      payFromName: payRaw ? mapPayFromAlias(payRaw) : null,
      notes: textAt(ws, row, found.cols, "notes"),
      sheetRow: row,
    });
  }
  return out;
}

function parseOneTime(ws: Sheet, warnings: ParseWarning[]): ParsedOneTime[] {
  const found = findHeaderRow(ws, ["expense", "amount", "priority", "status"], 60, 80);
  if (!found) {
    warn(warnings, "Planned Expenses", null, "Could not find the one-time table.");
    return [];
  }
  const { rows } = sheetRange(ws);
  const out: ParsedOneTime[] = [];
  for (let row = found.row + 1; row <= Math.min(rows, found.row + 40); row++) {
    const name = textAt(ws, row, found.cols, "expense");
    if (!name) continue;
    const title = normHeader(name);
    if (title.includes("expected inflow") || title.startsWith("tips")) break;
    const amount = asPaise(valueAt(ws, row, found.cols, "amount"));
    if (amount == null || amount <= 0) {
      warn(warnings, "Planned Expenses", row, `Skip one-time ${name}: amount missing.`);
      continue;
    }
    const expected =
      dateAt(ws, row, found.cols, "expected date") ??
      dateAt(ws, row, found.cols, "expected month") ??
      dateAt(ws, row, found.cols, "effective date");
    if (!expected) {
      warn(warnings, "Planned Expenses", row, `Skip one-time ${name}: no date.`);
      continue;
    }
    out.push({
      name,
      categoryName: textAt(ws, row, found.cols, "category") || "Other",
      expectedDate: expected,
      amount,
      priority: mapPriority(textAt(ws, row, found.cols, "priority")) ?? "medium",
      status: mapOneTimeStatus(textAt(ws, row, found.cols, "status")) ?? "planned",
      notes: textAt(ws, row, found.cols, "notes"),
      sheetRow: row,
    });
  }
  return out;
}

function parseInflows(ws: Sheet, warnings: ParseWarning[]): ParsedInflow[] {
  const found = findHeaderRow(ws, ["amount", "status"], 95, 110);
  if (!found || (!found.cols.has("item") && !found.cols.has("expense"))) {
    return [];
  }
  if (!found.cols.has("liquid") && !normHeader(cellValue(ws, found.row - 1, 1)).includes("inflow")) {
    return [];
  }
  const { rows } = sheetRange(ws);
  const out: ParsedInflow[] = [];
  for (let row = found.row + 1; row <= Math.min(rows, found.row + 20); row++) {
    const name = textAt(ws, row, found.cols, "item", "expense");
    if (!name) continue;
    if (name.length > 80 && !asPaise(valueAt(ws, row, found.cols, "amount"))) break;
    const amount = asPaise(valueAt(ws, row, found.cols, "amount"));
    if (amount == null || amount <= 0) continue;
    const expected =
      dateAt(ws, row, found.cols, "expected date") ??
      dateAt(ws, row, found.cols, "expected month");
    if (!expected) {
      warn(warnings, "Planned Expenses", row, `Skip inflow ${name}: no date.`);
      continue;
    }
    const liquidRaw = textAt(ws, row, found.cols, "liquid");
    const liquid = asBool(liquidRaw) ?? !compactStartsNo(liquidRaw);
    out.push({
      name,
      categoryName: textAt(ws, row, found.cols, "category") || null,
      expectedDate: expected,
      amount,
      isLiquid: liquid,
      status: mapInflowStatus(textAt(ws, row, found.cols, "status")) ?? "expected",
      notes: textAt(ws, row, found.cols, "notes"),
      sheetRow: row,
    });
  }
  return out;
}

function compactStartsNo(value: string): boolean {
  return value.trim().toLowerCase().startsWith("no");
}

function parseReconciles(
  ws: Sheet | null,
  cfg: Sheet,
  accounts: ParsedAccount[],
  warnings: ParseWarning[],
): ParsedReconcile[] {
  if (!ws) {
    warn(warnings, "Reconciliation", null, "Sheet missing; no last-checked records.");
    return [];
  }
  const found = findHeaderRow(ws, ["account", "actual"], 3, 8);
  if (!found) {
    warn(warnings, "Reconciliation", null, "Could not find the account table.");
    return [];
  }
  const { rows } = sheetRange(ws);
  const byName = new Map(accounts.map((a) => [a.name.toLowerCase(), a.name]));
  const out: ParsedReconcile[] = [];
  for (let row = found.row + 1; row <= Math.min(rows, found.row + 40); row++) {
    let name = textAt(ws, row, found.cols, "account");
    const formula = formulaAt(ws, row, found.cols, "account");
    if (!name) {
      const ref = configCellRef(formula);
      if (ref) name = cellText(cellValue(cfg, ref.row, 1));
    }
    if (!name) continue;
    const resolved = byName.get(name.toLowerCase());
    if (!resolved) continue;
    const actual = asPaise(valueAt(ws, row, found.cols, "actual"));
    const lastChecked = dateAt(ws, row, found.cols, "last reconciled");
    const notes = textAt(ws, row, found.cols, "notes");
    if (actual == null && !lastChecked && !notes) continue;
    out.push({
      accountName: resolved,
      actual,
      lastChecked,
      notes,
      sheetRow: row,
    });
  }
  return out;
}

function ensureLedgerCategories(
  categories: ParsedCategory[],
  ledger: Omit<ParsedLedgerRow, "sourceHash">[],
  plans: { categoryName: string; sheetRow: number }[],
  warnings: ParseWarning[],
): ParsedCategory[] {
  const have = new Set(categories.map((c) => c.name.toLowerCase()));
  const extra: ParsedCategory[] = [];
  let sort = categories.length;
  const add = (name: string, row: number, sheet: string) => {
    if (!name || have.has(name.toLowerCase())) return;
    have.add(name.toLowerCase());
    sort += 1;
    extra.push({
      name,
      group: "Other",
      defaultInBudget: true,
      isEssential: false,
      sort,
      sheetRow: row,
    });
    warn(warnings, sheet, row, `Category ${name} was not in Configuration; added as Other.`);
  };
  for (const row of ledger) add(row.categoryName, row.sheetRow, "Ledger");
  for (const row of plans) add(row.categoryName, row.sheetRow, "Planned Expenses");
  return extra.length ? [...categories, ...extra] : categories;
}

export function parseFinanceWorkbook(buf: Buffer): ParsedFinanceWorkbook {
  const wb = readWorkbook(buf);
  const cfg = sheetNamed(wb, "Configuration");
  const led = sheetNamed(wb, "Ledger");
  if (!cfg) throw new FinanceImportError("Workbook has no Configuration sheet.");
  if (!led) throw new FinanceImportError("Workbook has no Ledger sheet.");

  const warnings: ParseWarning[] = [];
  const settings = parseSettings(cfg, warnings);
  const accounts = parseAccounts(cfg, warnings);
  let categories = parseCategories(cfg, warnings);
  const ledgerRaw = parseLedger(led, warnings);
  const pe = sheetNamed(wb, "Planned Expenses");
  const recurring = pe ? parseRecurring(pe, warnings) : [];
  const oneTime = pe ? parseOneTime(pe, warnings) : [];
  const inflows = pe ? parseInflows(pe, warnings) : [];
  if (!pe) warn(warnings, "Planned Expenses", null, "Sheet missing; no plans imported.");

  const planCats = [
    ...recurring.map((r) => ({ categoryName: r.categoryName, sheetRow: r.sheetRow })),
    ...oneTime.map((r) => ({ categoryName: r.categoryName, sheetRow: r.sheetRow })),
    ...inflows
      .filter((r) => r.categoryName)
      .map((r) => ({ categoryName: r.categoryName as string, sheetRow: r.sheetRow })),
  ];
  categories = ensureLedgerCategories(categories, ledgerRaw, planCats, warnings);

  const names = new Set(accounts.map((a) => a.name.toLowerCase()));
  const unknown: { row: number; from: string; to: string }[] = [];
  for (const row of ledgerRaw) {
    if (!names.has(row.fromName.toLowerCase()) || !names.has(row.toName.toLowerCase())) {
      unknown.push({ row: row.sheetRow, from: row.fromName, to: row.toName });
    }
  }
  if (unknown.length > 0) {
    throw new FinanceImportError(
      "Ledger rows reference accounts that are not in Configuration.",
      { unknown },
    );
  }

  const monthBudgets = parseMonthBudgets(sheetNamed(wb, "Monthly Budget"), warnings);
  const reconciles = parseReconciles(sheetNamed(wb, "Reconciliation"), cfg, accounts, warnings);
  const ledger = assignLedgerHashes(ledgerRaw);

  return {
    settings,
    accounts,
    categories,
    ledger,
    monthBudgets,
    recurring,
    oneTime,
    inflows,
    reconciles,
    warnings,
  };
}
