import { rupeesToPaise, type Paise } from "../engine/money.ts";
import {
  RECONCILIATION_CATEGORY_NAME,
  type Account,
  type Books,
  type Category,
  type LedgerEntry,
  type LedgerType,
} from "../engine/types.ts";
import {
  validateLedgerEntry,
  type LedgerIssue,
} from "../engine/validateLedgerEntry.ts";

export const QUICK_ADD_TYPES: {
  id: LedgerType;
  label: string;
  more?: boolean;
}[] = [
  { id: "expense", label: "Expense" },
  { id: "income", label: "Income" },
  { id: "transfer", label: "Transfer" },
  { id: "cc_payment", label: "CC pay" },
  { id: "refund", label: "Refund" },
  { id: "investment", label: "Invest" },
  { id: "adjustment", label: "Adjust", more: true },
];

export type AmountDraft = {
  parts: string[];
  buffer: string;
};

export const EMPTY_AMOUNT: AmountDraft = { parts: [], buffer: "" };

const MAX_WHOLE_DIGITS = 8;

function parseRupeeText(text: string): number | null {
  if (text === "" || text === "." || text === "0.") return 0;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function amountPaise(draft: AmountDraft): Paise {
  const texts =
    draft.buffer === "" || parseRupeeText(draft.buffer) == null
      ? draft.parts
      : [...draft.parts, draft.buffer];
  let total = 0;
  for (const text of texts) {
    const n = parseRupeeText(text);
    if (n == null) continue;
    total += rupeesToPaise(n);
  }
  return total;
}

export function amountExpression(draft: AmountDraft): string {
  if (draft.parts.length === 0) return draft.buffer;
  const tail = draft.buffer === "" ? "" : ` + ${draft.buffer}`;
  return `${draft.parts.join(" + ")}${tail}`;
}

function appendDigit(buffer: string, digit: string): string {
  if (buffer.includes(".")) {
    const frac = buffer.split(".")[1] ?? "";
    if (frac.length >= 2) return buffer;
    return buffer + digit;
  }
  if (buffer === "" || buffer === "0") return digit;
  const whole = buffer;
  if (whole.length >= MAX_WHOLE_DIGITS) return buffer;
  return buffer + digit;
}

function appendDot(buffer: string): string {
  if (buffer.includes(".")) return buffer;
  if (buffer === "") return "0.";
  return `${buffer}.`;
}

function normalizePart(text: string): string {
  if (text.endsWith(".")) return text.slice(0, -1);
  return text;
}

export type AmountKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "+" | "back";

export function applyAmountKey(draft: AmountDraft, key: AmountKey): AmountDraft {
  if (key === "back") {
    if (draft.buffer !== "") {
      return { ...draft, buffer: draft.buffer.slice(0, -1) };
    }
    if (draft.parts.length === 0) return draft;
    const parts = draft.parts.slice(0, -1);
    const buffer = draft.parts[draft.parts.length - 1] ?? "";
    return { parts, buffer };
  }
  if (key === "+") {
    const n = parseRupeeText(draft.buffer);
    if (n == null || n === 0) return draft;
    return { parts: [...draft.parts, normalizePart(draft.buffer)], buffer: "" };
  }
  if (key === ".") {
    return { ...draft, buffer: appendDot(draft.buffer) };
  }
  return { ...draft, buffer: appendDigit(draft.buffer, key) };
}

function isLiveAccount(account: Account): boolean {
  return !account.isArchived;
}

function isLiveCategory(category: Category): boolean {
  return !category.isArchived;
}

function isPaymentAccount(account: Account): boolean {
  if (!isLiveAccount(account) || account.type === "virtual") return false;
  return (
    account.group === "savings" ||
    account.group === "cash" ||
    account.group === "credit_card"
  );
}

function isOwnReal(account: Account): boolean {
  return isLiveAccount(account) && account.type !== "virtual";
}

function isReconciliation(category: Category): boolean {
  return category.name.trim().toLowerCase() === RECONCILIATION_CATEGORY_NAME.toLowerCase();
}

export function accountsForSlot(
  type: LedgerType,
  slot: "from" | "to",
  accounts: readonly Account[],
): Account[] {
  const live = accounts.filter(isLiveAccount);
  switch (type) {
    case "expense":
      return slot === "from"
        ? live.filter(isPaymentAccount)
        : live.filter((a) => a.virtualKind === "expense");
    case "income":
      return slot === "from"
        ? live.filter(
            (a) => a.virtualKind === "employer" || a.virtualKind === "external",
          )
        : live.filter(
            (a) =>
              a.type === "asset" &&
              (a.group === "savings" || a.group === "cash"),
          );
    case "transfer":
      return live.filter(isOwnReal);
    case "cc_payment":
      return slot === "from"
        ? live.filter(
            (a) =>
              a.type === "asset" &&
              (a.group === "savings" || a.group === "cash"),
          )
        : live.filter((a) => a.type === "liability" && a.group === "credit_card");
    case "refund":
      return slot === "from"
        ? live.filter((a) => a.virtualKind === "expense")
        : live.filter(isPaymentAccount);
    case "investment":
      return slot === "from"
        ? live.filter(
            (a) =>
              a.type === "asset" &&
              (a.group === "savings" || a.group === "cash"),
          )
        : live.filter((a) => a.group === "fd" || a.group === "investment");
    case "adjustment":
      return live;
  }
}

export function visibleAccountSlots(type: LedgerType): { from: boolean; to: boolean } {
  return {
    from: type !== "refund",
    to: type !== "expense",
  };
}

function preferName(rows: readonly Account[], names: readonly string[]): Account | undefined {
  const want = names.map((n) => n.toLowerCase());
  return rows.find((row) => want.includes(row.name.trim().toLowerCase()));
}

function newestFirst(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function lastExpenseFromId(entries: readonly LedgerEntry[]): string | null {
  const row = newestFirst(entries).find((e) => e.type === "expense");
  return row?.fromAccountId ?? null;
}

export function lastIncomeToId(entries: readonly LedgerEntry[]): string | null {
  const row = newestFirst(entries).find((e) => e.type === "income");
  return row?.toAccountId ?? null;
}

export function recentCategoryIds(
  entries: readonly LedgerEntry[],
  type: LedgerType,
  limit = 8,
): string[] {
  const ids: string[] = [];
  for (const entry of newestFirst(entries)) {
    if (entry.type !== type) continue;
    if (ids.includes(entry.categoryId)) continue;
    ids.push(entry.categoryId);
    if (ids.length >= limit) break;
  }
  return ids;
}

export function lastNoteForCategory(
  entries: readonly LedgerEntry[],
  categoryId: string,
): string {
  for (const entry of newestFirst(entries)) {
    if (entry.categoryId !== categoryId) continue;
    const note = entry.notes.trim();
    if (note) return note;
  }
  return "";
}

export function defaultAccounts(
  type: LedgerType,
  accounts: readonly Account[],
  entries: readonly LedgerEntry[],
): { fromId: string; toId: string } {
  const froms = accountsForSlot(type, "from", accounts);
  const tos = accountsForSlot(type, "to", accounts);
  const lastFrom = lastExpenseFromId(entries);
  const lastTo = lastIncomeToId(entries);

  const pickFrom = (preferred: readonly string[], recentId?: string | null) =>
    (recentId ? froms.find((a) => a.id === recentId) : undefined) ??
    preferName(froms, preferred) ??
    froms[0];
  const pickTo = (preferred: readonly string[], recentId?: string | null) =>
    (recentId ? tos.find((a) => a.id === recentId) : undefined) ??
    preferName(tos, preferred) ??
    tos[0];

  switch (type) {
    case "expense": {
      const recent = lastFrom ? froms.find((a) => a.id === lastFrom) : undefined;
      const cc = froms.find((a) => a.group === "credit_card");
      const from = recent ?? cc ?? pickFrom(["HDFC Savings", "HDFC Credit Card"]);
      return { fromId: from?.id ?? "", toId: tos[0]?.id ?? "" };
    }
    case "income": {
      const from = pickFrom(["Employer"]);
      const to = pickTo(["HDFC Savings"], lastTo);
      return { fromId: from?.id ?? "", toId: to?.id ?? "" };
    }
    case "transfer": {
      const from = pickFrom(["HDFC Savings"]);
      const to =
        tos.find((a) => a.id !== from?.id && a.group === "savings") ??
        tos.find((a) => a.id !== from?.id) ??
        tos[0];
      return { fromId: from?.id ?? "", toId: to && to.id !== from?.id ? to.id : "" };
    }
    case "cc_payment": {
      const from = pickFrom(["HDFC Savings"]);
      const to = pickTo(["HDFC Credit Card"]);
      return { fromId: from?.id ?? "", toId: to?.id ?? "" };
    }
    case "refund": {
      const from = froms[0];
      const to = pickTo(["HDFC Savings"], lastFrom);
      return { fromId: from?.id ?? "", toId: to?.id ?? "" };
    }
    case "investment": {
      const from = pickFrom(["HDFC Savings"]);
      const to = pickTo(["FD", "Mutual Fund"]);
      return { fromId: from?.id ?? "", toId: to?.id ?? "" };
    }
    case "adjustment": {
      const from = pickFrom(["HDFC Savings"]);
      const to =
        tos.find((a) => a.id !== from?.id && a.virtualKind === "external") ??
        tos.find((a) => a.id !== from?.id) ??
        tos[0];
      return { fromId: from?.id ?? "", toId: to && to.id !== from?.id ? to.id : "" };
    }
  }
}

export function categoriesForType(
  type: LedgerType,
  categories: readonly Category[],
): Category[] {
  const live = categories.filter(isLiveCategory).slice().sort((a, b) => a.sort - b.sort);
  if (type === "adjustment") return live.filter(isReconciliation);
  return live.filter((c) => !isReconciliation(c));
}

function preferCategoryName(
  rows: readonly Category[],
  names: readonly string[],
): Category | undefined {
  const want = names.map((n) => n.toLowerCase());
  return rows.find((row) => want.includes(row.name.trim().toLowerCase()));
}

export function defaultCategoryId(
  type: LedgerType,
  categories: readonly Category[],
  entries: readonly LedgerEntry[],
): string {
  const rows = categoriesForType(type, categories);
  const recent = recentCategoryIds(entries, type, 1)[0];
  if (recent && rows.some((c) => c.id === recent)) return recent;
  switch (type) {
    case "income":
      return preferCategoryName(rows, ["Salary"])?.id ?? rows[0]?.id ?? "";
    case "investment":
      return preferCategoryName(rows, ["Investment"])?.id ?? rows[0]?.id ?? "";
    case "cc_payment":
      return (
        preferCategoryName(rows, ["Credit Card Bill", "EMIs"])?.id ??
        rows[0]?.id ??
        ""
      );
    case "transfer":
      return preferCategoryName(rows, ["Transfer"])?.id ?? rows[0]?.id ?? "";
    case "adjustment":
      return rows[0]?.id ?? "";
    default:
      return (
        preferCategoryName(rows, ["Eating outside", "Groceries"])?.id ??
        rows[0]?.id ??
        ""
      );
  }
}

export function groupCategories(
  categories: readonly Category[],
): { group: string; rows: Category[] }[] {
  const map = new Map<string, Category[]>();
  for (const row of categories) {
    const list = map.get(row.group) ?? [];
    list.push(row);
    map.set(row.group, list);
  }
  return [...map.entries()].map(([group, rows]) => ({
    group,
    rows: rows.slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
  }));
}

const FRIENDLY_HINT: Record<string, string> = {
  expense_to_not_expense: "Expenses go to the Expense account — pick a category instead.",
  income_from_not_employer_or_external: "Income usually comes from Employer or External.",
  cc_payment_to_not_liability: "Credit card payments go to a credit card.",
  investment_to_not_fd_or_investment: "Investments go to an FD or investment account.",
  refund_from_not_expense: "Refunds usually go to an account.",
  transfer_involves_virtual: "Transfer must be between your own accounts.",
  from_equals_to: "From and To must differ.",
  adjustment_category_not_reconciliation: "Adjustment must use Reconciliation.",
  amount_not_positive: "Enter an amount.",
  unknown_from_account: "Pick a From account.",
  unknown_to_account: "Pick a To account.",
  unknown_category: "Pick a category.",
};

export type QuickAddHint = { field: string; message: string };

export function quickAddHints(
  input: {
    date: string;
    type: LedgerType;
    amount: Paise;
    fromAccountId: string;
    toAccountId: string;
    categoryId: string;
  },
  catalog: Pick<Books, "accounts" | "categories">,
): QuickAddHint[] {
  const hints: QuickAddHint[] = [];
  if (!input.fromAccountId) {
    if (input.type === "cc_payment") {
      hints.push({ field: "fromAccountId", message: "Pick a savings account to pay from." });
    } else if (input.type === "investment") {
      hints.push({ field: "fromAccountId", message: "Pick a savings account to invest from." });
    } else {
      hints.push({ field: "fromAccountId", message: "Pick a From account." });
    }
  }
  if (!input.toAccountId) {
    if (input.type === "cc_payment") {
      hints.push({ field: "toAccountId", message: "No credit card account to pay." });
    } else if (input.type === "investment") {
      hints.push({ field: "toAccountId", message: "No FD or investment account yet." });
    } else if (input.type === "transfer") {
      hints.push({ field: "toAccountId", message: "Need another account to transfer." });
    } else {
      hints.push({ field: "toAccountId", message: "Pick a To account." });
    }
  }
  if (!input.categoryId) {
    hints.push({ field: "categoryId", message: "Pick a category." });
  }
  if (hints.length > 0) return hints;

  const result = validateLedgerEntry(input, catalog);
  return result.issues.map((issue: LedgerIssue) => ({
    field: issue.field,
    message: FRIENDLY_HINT[issue.code] ?? issue.message,
  }));
}

export function showsInBudget(type: LedgerType): boolean {
  return type === "expense" || type === "refund";
}

export function sortRecentFirst<T extends { id: string }>(
  rows: readonly T[],
  recentIds: readonly string[],
): T[] {
  const rank = new Map(recentIds.map((id, i) => [id, i]));
  return rows.slice().sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return 0;
  });
}
