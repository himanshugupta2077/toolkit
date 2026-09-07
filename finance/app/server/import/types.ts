import type { LedgerIssue } from "../../src/engine/validateLedgerEntry.ts";
import type {
  AccountGroup,
  AccountType,
  ClockTime,
  InflowStatus,
  IsoDate,
  LedgerType,
  OneTimeStatus,
  Paise,
  PlanPriority,
  RecurringFrequency,
  RecurringKind,
  VirtualKind,
  YearMonth,
} from "../../src/engine/index.ts";

export type ParseWarning = {
  sheet: string;
  row: number | null;
  message: string;
};

export type ParsedAccount = {
  name: string;
  type: AccountType;
  openingBalance: Paise;
  openingDate: IsoDate;
  creditLimit: Paise | null;
  includeNetWorth: boolean;
  includeLiquid: boolean;
  group: AccountGroup;
  notes: string;
  virtualKind: VirtualKind | null;
  sheetRow: number;
};

export type ParsedCategory = {
  name: string;
  group: string;
  defaultInBudget: boolean;
  isEssential: boolean;
  sort: number;
  sheetRow: number;
};

export type ParsedLedgerRow = {
  date: IsoDate;
  time: ClockTime | null;
  type: LedgerType;
  amount: Paise;
  fromName: string;
  toName: string;
  categoryName: string;
  inBudget: boolean | null;
  notes: string;
  sheetRow: number;
  sourceHash: string;
};

export type ParsedMonthBudget = {
  month: YearMonth;
  cap: Paise;
  sheetRow: number;
};

export type ParsedRecurring = {
  name: string;
  categoryName: string;
  frequency: RecurringFrequency;
  amount: Paise;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  active: boolean;
  kind: RecurringKind | null;
  payFromName: string | null;
  notes: string;
  sheetRow: number;
};

export type ParsedOneTime = {
  name: string;
  categoryName: string;
  expectedDate: IsoDate;
  amount: Paise;
  priority: PlanPriority;
  status: OneTimeStatus;
  notes: string;
  sheetRow: number;
};

export type ParsedInflow = {
  name: string;
  categoryName: string | null;
  expectedDate: IsoDate;
  amount: Paise;
  isLiquid: boolean;
  status: InflowStatus;
  notes: string;
  sheetRow: number;
};

export type ParsedReconcile = {
  accountName: string;
  actual: Paise | null;
  lastChecked: IsoDate | null;
  notes: string;
  sheetRow: number;
};

export type ParsedFinanceWorkbook = {
  settings: { defaultBudget: Paise; monthlySalary: Paise };
  accounts: ParsedAccount[];
  categories: ParsedCategory[];
  ledger: ParsedLedgerRow[];
  monthBudgets: ParsedMonthBudget[];
  recurring: ParsedRecurring[];
  oneTime: ParsedOneTime[];
  inflows: ParsedInflow[];
  reconciles: ParsedReconcile[];
  warnings: ParseWarning[];
};

export const MATCH_TOLERANCE_PAISE = 100;
export const OPENING_DATE: IsoDate = "2026-08-01";
export const APPROVAL_MONTH: YearMonth = "2026-09";
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type ImportedLedgerLine = {
  id: string;
  date: IsoDate;
  type: LedgerType;
  amount: Paise;
  fromAccountId: string;
  toAccountId: string;
  fromName: string;
  toName: string;
  categoryName: string;
  notes: string;
  sheetRow: number | null;
  skipped: boolean;
};

export type BalanceMatchLine = {
  accountId: string;
  name: string;
  type: AccountType;
  group: AccountGroup;
  sheetPaise: Paise;
  enginePaise: Paise;
  deltaPaise: Paise;
  match: boolean;
  actualPaise: Paise | null;
};

export type ImportReport = {
  filename: string;
  replace: boolean;
  ok: boolean;
  counts: {
    accounts: number;
    categories: number;
    ledgerInserted: number;
    ledgerSkipped: number;
    monthBudgets: number;
    recurring: number;
    oneTime: number;
    inflows: number;
    reconciliations: number;
    extraManualLedger: number;
  };
  balances: BalanceMatchLine[];
  mismatches: BalanceMatchLine[];
  ledger: ImportedLedgerLine[];
  warnings: ParseWarning[];
  typeGuideIssues: { sheetRow: number; notes: string; issues: LedgerIssue[] }[];
  recurringCheck: {
    month: YearMonth;
    loanEmi: Paise;
    includesSmartEmi: boolean;
    lines: { name: string; kind: string; amount: Paise }[];
  };
};
