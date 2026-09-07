import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "./money.ts";
import type { Account, Category, LedgerType } from "./types.ts";
import {
  validateLedgerEntry,
  type LedgerCatalog,
  type LedgerEntryToValidate,
} from "./validateLedgerEntry.ts";

const OPENING = "2026-08-01";

function asset(
  id: string,
  name: string,
  group: Account["group"],
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name,
    type: "asset",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: true,
    includeLiquid: group === "savings" || group === "cash",
    group,
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
    ...extra,
  };
}

function cc(id: string, name: string): Account {
  return {
    id,
    name,
    type: "liability",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: rupeesToPaise(100000),
    includeNetWorth: true,
    includeLiquid: false,
    group: "credit_card",
    bucketId: null,
    statementDay: 17,
    dueDay: 7,
    isArchived: false,
    notes: "",
    virtualKind: null,
  };
}

function virtual(
  id: string,
  name: string,
  virtualKind: NonNullable<Account["virtualKind"]>,
): Account {
  return {
    id,
    name,
    type: "virtual",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: false,
    includeLiquid: false,
    group: "virtual",
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind,
  };
}

function category(
  id: string,
  name: string,
  group: string,
  defaultInBudget: boolean,
): Category {
  return { id, name, group, defaultInBudget, icon: null, isArchived: false, sort: 0 };
}

const accounts = {
  hdfc: asset("acc_hdfc", "HDFC Savings", "savings"),
  icici: asset("acc_icici", "ICICI Savings", "savings"),
  cash: asset("acc_cash", "Cash", "cash"),
  fd: asset("acc_fd", "FD", "fd"),
  mf: asset("acc_mf", "Mutual Fund", "investment"),
  hdfcCc: cc("acc_hdfc_cc", "HDFC Credit Card"),
  employer: virtual("acc_employer", "Employer", "employer"),
  external: virtual("acc_external", "External", "external"),
  expense: virtual("acc_expense", "Expense", "expense"),
} as const;

const categories = {
  salary: category("cat_salary", "Salary", "Income", false),
  eating: category("cat_eating", "Eating outside", "Food", true),
  transfer: category("cat_transfer", "Transfer", "Finance", false),
  ccBill: category("cat_cc_bill", "Credit Card Bill", "Fixed", false),
  refund: category("cat_refund", "Refund", "Income", true),
  investment: category("cat_investment", "Investment", "Finance", false),
  recon: category("cat_recon", "Reconciliation", "Finance", false),
  other: category("cat_other", "Other", "Other", true),
} as const;

const catalog: LedgerCatalog = {
  accounts: Object.values(accounts),
  categories: Object.values(categories),
};

const happy: Record<LedgerType, LedgerEntryToValidate> = {
  income: {
    date: "2026-09-06",
    type: "income",
    amount: rupeesToPaise(140000),
    fromAccountId: accounts.employer.id,
    toAccountId: accounts.hdfc.id,
    categoryId: categories.salary.id,
  },
  expense: {
    date: "2026-09-06",
    type: "expense",
    amount: rupeesToPaise(240),
    fromAccountId: accounts.hdfc.id,
    toAccountId: accounts.expense.id,
    categoryId: categories.eating.id,
  },
  transfer: {
    date: "2026-09-06",
    type: "transfer",
    amount: rupeesToPaise(1000),
    fromAccountId: accounts.hdfc.id,
    toAccountId: accounts.icici.id,
    categoryId: categories.transfer.id,
  },
  cc_payment: {
    date: "2026-09-06",
    type: "cc_payment",
    amount: rupeesToPaise(5000),
    fromAccountId: accounts.hdfc.id,
    toAccountId: accounts.hdfcCc.id,
    categoryId: categories.ccBill.id,
  },
  refund: {
    date: "2026-09-06",
    type: "refund",
    amount: rupeesToPaise(120),
    fromAccountId: accounts.expense.id,
    toAccountId: accounts.hdfc.id,
    categoryId: categories.refund.id,
  },
  investment: {
    date: "2026-09-06",
    type: "investment",
    amount: rupeesToPaise(8000),
    fromAccountId: accounts.hdfc.id,
    toAccountId: accounts.mf.id,
    categoryId: categories.investment.id,
  },
  adjustment: {
    date: "2026-09-06",
    type: "adjustment",
    amount: rupeesToPaise(50),
    fromAccountId: accounts.cash.id,
    toAccountId: accounts.expense.id,
    categoryId: categories.recon.id,
  },
};

function codes(entry: LedgerEntryToValidate, cat: LedgerCatalog = catalog): string[] {
  return validateLedgerEntry(entry, cat).issues.map((issue) => issue.code);
}

describe("happy paths", () => {
  it.each(Object.keys(happy) as LedgerType[])("%s is legal", (type) => {
    const result = validateLedgerEntry(happy[type], catalog);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("allows income from External as well as Employer", () => {
    const result = validateLedgerEntry(
      { ...happy.income, fromAccountId: accounts.external.id },
      catalog,
    );
    expect(result.ok).toBe(true);
  });

  it("allows investment into FD", () => {
    const result = validateLedgerEntry(
      { ...happy.investment, toAccountId: accounts.fd.id },
      catalog,
    );
    expect(result.ok).toBe(true);
  });
});

describe("shared illegal shape", () => {
  it("rejects amount 0 and negative", () => {
    expect(codes({ ...happy.expense, amount: 0 })).toContain("amount_not_positive");
    expect(codes({ ...happy.expense, amount: -100 })).toContain("amount_not_positive");
  });

  it("rejects non-integer paise", () => {
    expect(codes({ ...happy.expense, amount: 240.5 })).toContain("amount_not_integer");
  });

  it("rejects from === to", () => {
    expect(
      codes({
        ...happy.transfer,
        fromAccountId: accounts.hdfc.id,
        toAccountId: accounts.hdfc.id,
      }),
    ).toContain("from_equals_to");
  });

  it("rejects unknown accounts and categories", () => {
    expect(codes({ ...happy.expense, fromAccountId: "missing" })).toContain(
      "unknown_from_account",
    );
    expect(codes({ ...happy.expense, toAccountId: "missing" })).toContain(
      "unknown_to_account",
    );
    expect(codes({ ...happy.expense, categoryId: "missing" })).toContain(
      "unknown_category",
    );
  });

  it("rejects impossible dates", () => {
    expect(codes({ ...happy.expense, date: "2026-02-29" })).toContain("invalid_date");
  });
});

describe("illegal From/To by type", () => {
  it("income cannot come from a bank or the Expense sink", () => {
    expect(
      codes({ ...happy.income, fromAccountId: accounts.icici.id }),
    ).toContain("income_from_not_employer_or_external");
    expect(
      codes({ ...happy.income, fromAccountId: accounts.expense.id }),
    ).toContain("income_from_not_employer_or_external");
  });

  it("expense cannot go to a bank", () => {
    expect(
      codes({ ...happy.expense, toAccountId: accounts.icici.id }),
    ).toContain("expense_to_not_expense");
  });

  it("cc_payment cannot go to savings", () => {
    expect(
      codes({ ...happy.cc_payment, toAccountId: accounts.icici.id }),
    ).toContain("cc_payment_to_not_liability");
  });

  it("investment cannot go to cash", () => {
    expect(
      codes({ ...happy.investment, toAccountId: accounts.cash.id }),
    ).toContain("investment_to_not_fd_or_investment");
  });

  it("adjustment cannot use a non-Reconciliation category", () => {
    expect(
      codes({ ...happy.adjustment, categoryId: categories.other.id }),
    ).toContain("adjustment_category_not_reconciliation");
  });

  it("transfer cannot involve a virtual account", () => {
    expect(
      codes({ ...happy.transfer, toAccountId: accounts.expense.id }),
    ).toContain("transfer_involves_virtual");
    expect(
      codes({ ...happy.transfer, fromAccountId: accounts.employer.id }),
    ).toContain("transfer_involves_virtual");
  });

  it("refund cannot come from a bank", () => {
    expect(
      codes({ ...happy.refund, fromAccountId: accounts.icici.id }),
    ).toContain("refund_from_not_expense");
  });
});
