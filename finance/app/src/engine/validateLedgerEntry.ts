import { isClockTime, isIsoDate } from "./dates.ts";
import { isPaise } from "./money.ts";
import {
  isLedgerType,
  RECONCILIATION_CATEGORY_NAME,
  type Account,
  type Category,
  type LedgerEntry,
  type LedgerType,
} from "./types.ts";

export type LedgerIssue = {
  field: string;
  code: string;
  message: string;
};

export type LedgerCatalog = {
  accounts: readonly Account[];
  categories: readonly Category[];
};

/** Fields the Type Guide cares about. Extra LedgerEntry fields are allowed. */
export type LedgerEntryToValidate = Pick<
  LedgerEntry,
  "date" | "type" | "amount" | "fromAccountId" | "toAccountId" | "categoryId"
> &
  Partial<Pick<LedgerEntry, "time">>;

export type LedgerValidationResult = {
  ok: boolean;
  issues: LedgerIssue[];
};

function indexById<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.id, row);
  return map;
}

function isReconciliationCategory(category: Category): boolean {
  return category.name.trim().toLowerCase() === RECONCILIATION_CATEGORY_NAME.toLowerCase();
}

function isEmployerOrExternal(account: Account): boolean {
  return (
    account.type === "virtual" &&
    (account.virtualKind === "employer" || account.virtualKind === "external")
  );
}

function isExpenseSink(account: Account): boolean {
  return account.type === "virtual" && account.virtualKind === "expense";
}

function isCreditCard(account: Account): boolean {
  return account.type === "liability" && account.group === "credit_card";
}

function isInvestDestination(account: Account): boolean {
  return account.group === "fd" || account.group === "investment";
}

function typeIssues(
  type: LedgerType,
  from: Account,
  to: Account,
  category: Category,
): LedgerIssue[] {
  switch (type) {
    case "income":
      if (!isEmployerOrExternal(from)) {
        return [
          {
            field: "fromAccountId",
            code: "income_from_not_employer_or_external",
            message: "Income must come from Employer or External.",
          },
        ];
      }
      return [];
    case "expense":
      if (!isExpenseSink(to)) {
        return [
          {
            field: "toAccountId",
            code: "expense_to_not_expense",
            message: "Expense must go to the Expense account.",
          },
        ];
      }
      return [];
    case "cc_payment":
      if (!isCreditCard(to)) {
        return [
          {
            field: "toAccountId",
            code: "cc_payment_to_not_liability",
            message: "Credit card payment must go to a credit-card liability.",
          },
        ];
      }
      return [];
    case "investment":
      if (!isInvestDestination(to)) {
        return [
          {
            field: "toAccountId",
            code: "investment_to_not_fd_or_investment",
            message: "Investment must go to an FD or investment account.",
          },
        ];
      }
      return [];
    case "adjustment":
      if (!isReconciliationCategory(category)) {
        return [
          {
            field: "categoryId",
            code: "adjustment_category_not_reconciliation",
            message: "Adjustment must use the Reconciliation category.",
          },
        ];
      }
      return [];
    case "transfer":
      if (from.type === "virtual" || to.type === "virtual") {
        return [
          {
            field: from.type === "virtual" ? "fromAccountId" : "toAccountId",
            code: "transfer_involves_virtual",
            message: "Transfer must be between your own accounts.",
          },
        ];
      }
      return [];
    case "refund":
      if (!isExpenseSink(from)) {
        return [
          {
            field: "fromAccountId",
            code: "refund_from_not_expense",
            message: "Refund must come from the Expense account.",
          },
        ];
      }
      return [];
  }
}

export function validateLedgerEntry(
  entry: LedgerEntryToValidate,
  catalog: LedgerCatalog,
): LedgerValidationResult {
  const issues: LedgerIssue[] = [];

  if (!isLedgerType(entry.type)) {
    issues.push({
      field: "type",
      code: "invalid_type",
      message: "Unknown ledger type.",
    });
  }

  if (!isIsoDate(entry.date)) {
    issues.push({
      field: "date",
      code: "invalid_date",
      message: "Date must be a real YYYY-MM-DD calendar date.",
    });
  }

  if (entry.time != null && entry.time !== "" && !isClockTime(entry.time)) {
    issues.push({
      field: "time",
      code: "invalid_time",
      message: "Time must be HH:mm (24-hour).",
    });
  }

  if (!isPaise(entry.amount)) {
    issues.push({
      field: "amount",
      code: "amount_not_integer",
      message: "Amount must be integer paise.",
    });
  } else if (entry.amount <= 0) {
    issues.push({
      field: "amount",
      code: "amount_not_positive",
      message: "Amount must be greater than zero.",
    });
  }

  const accounts = indexById(catalog.accounts);
  const categories = indexById(catalog.categories);
  const from = accounts.get(entry.fromAccountId);
  const to = accounts.get(entry.toAccountId);
  const category = categories.get(entry.categoryId);

  if (!from) {
    issues.push({
      field: "fromAccountId",
      code: "unknown_from_account",
      message: "From account is not in the catalog.",
    });
  }
  if (!to) {
    issues.push({
      field: "toAccountId",
      code: "unknown_to_account",
      message: "To account is not in the catalog.",
    });
  }
  if (from && to && from.id === to.id) {
    issues.push({
      field: "toAccountId",
      code: "from_equals_to",
      message: "From and To accounts must differ.",
    });
  }
  if (!category) {
    issues.push({
      field: "categoryId",
      code: "unknown_category",
      message: "Category is not in the catalog.",
    });
  }

  if (isLedgerType(entry.type) && from && to && category) {
    issues.push(...typeIssues(entry.type, from, to, category));
  }

  return { ok: issues.length === 0, issues };
}
