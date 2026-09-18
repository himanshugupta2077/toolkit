import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import type { Account, Category, LedgerEntry, LedgerType } from "../engine/types.ts";
import {
  accountsForSlot,
  amountDraftFromText,
  amountExpression,
  amountPaise,
  applyAmountKey,
  defaultAccounts,
  defaultCategoryGroup,
  defaultCategoryId,
  EMPTY_AMOUNT,
  filterCategories,
  hasExactCategory,
  quickAddHints,
  topCategoryIds,
  visibleAccountSlots,
  type AmountDraft,
} from "./quickAdd.ts";

const OPENING = "2026-08-01";

function asset(
  id: string,
  name: string,
  group: Account["group"],
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
  sort = 0,
): Category {
  return { id, name, group, defaultInBudget, icon: null, isArchived: false, sort };
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
  salary: category("cat_salary", "Salary", "Income", false, 1),
  eating: category("cat_eating", "Eating outside", "Food", true, 2),
  groceries: category("cat_groceries", "Groceries", "Food", true, 3),
  transfer: category("cat_transfer", "Transfer", "Finance", false, 4),
  investment: category("cat_investment", "Investment", "Finance", false, 5),
  recon: category("cat_recon", "Reconciliation", "Finance", false, 6),
} as const;

const catalog = {
  accounts: Object.values(accounts),
  categories: Object.values(categories),
};

function typeKeys(text: string): AmountDraft {
  let draft = EMPTY_AMOUNT;
  for (const ch of text) {
    if (ch === "+") draft = applyAmountKey(draft, "+");
    else if (ch === ".") draft = applyAmountKey(draft, ".");
    else draft = applyAmountKey(draft, ch as "0");
  }
  return draft;
}

describe("amount keypad", () => {
  it("types 240 rupees as 24000 paise", () => {
    const draft = typeKeys("240");
    expect(amountPaise(draft)).toBe(rupeesToPaise(240));
  });

  it("adds 120+80", () => {
    const draft = typeKeys("120+80");
    expect(amountExpression(draft)).toBe("120 + 80");
    expect(amountPaise(draft)).toBe(rupeesToPaise(200));
  });

  it("keeps two decimal places and ignores a third", () => {
    let draft = typeKeys("10.55");
    draft = applyAmountKey(draft, "9");
    expect(amountPaise(draft)).toBe(rupeesToPaise(10.55));
  });

  it("backspaces across a plus", () => {
    let draft = typeKeys("12+3");
    draft = applyAmountKey(draft, "back");
    draft = applyAmountKey(draft, "back");
    expect(amountPaise(draft)).toBe(rupeesToPaise(12));
  });
});

describe("amount typed field", () => {
  it("parses rupees, commas, and plus parts", () => {
    expect(amountDraftFromText("")).toEqual(EMPTY_AMOUNT);
    expect(amountPaise(amountDraftFromText("₹1,240"))).toBe(rupeesToPaise(1240));
    expect(amountExpression(amountDraftFromText("120 + 80"))).toBe("120 + 80");
    expect(amountPaise(amountDraftFromText("120 + 80"))).toBe(rupeesToPaise(200));
  });
});

describe("type defaults", () => {
  it("hides Expense as To and Refund as From", () => {
    expect(visibleAccountSlots("expense")).toEqual({ from: true, to: false });
    expect(visibleAccountSlots("refund")).toEqual({ from: false, to: true });
    expect(visibleAccountSlots("transfer")).toEqual({ from: true, to: true });
  });

  it("defaults expense from a credit card when one exists", () => {
    const ids = defaultAccounts("expense", catalog.accounts, []);
    expect(ids.fromId).toBe(accounts.hdfcCc.id);
    expect(ids.toId).toBe(accounts.expense.id);
  });

  it("uses the last expense From after one exists", () => {
    const entry = {
      id: "e1",
      date: "2026-09-05",
      time: null,
      type: "expense" as LedgerType,
      amount: 100,
      fromAccountId: accounts.hdfc.id,
      toAccountId: accounts.expense.id,
      categoryId: categories.eating.id,
      inBudget: true,
      notes: "Swiggy food",
      source: "manual",
      goalId: null,
      holdingTxnId: null,
      createdAt: "2026-09-05T10:00:00+05:30",
      updatedAt: "2026-09-05T10:00:00+05:30",
    } satisfies LedgerEntry;
    const ids = defaultAccounts("expense", catalog.accounts, [entry]);
    expect(ids.fromId).toBe(accounts.hdfc.id);
  });

  it("defaults eating-outside for a first expense", () => {
    expect(defaultCategoryId("expense", catalog.categories, [])).toBe(
      categories.eating.id,
    );
  });

  it("restricts CC payment To to credit cards", () => {
    const tos = accountsForSlot("cc_payment", "to", catalog.accounts);
    expect(tos.map((a) => a.id)).toEqual([accounts.hdfcCc.id]);
  });
});

describe("category chips", () => {
  it("ranks the five most-used categories for the type", () => {
    const extra = category("cat_fuel", "Fuel", "Transport", true, 7);
    const cats = [...catalog.categories, extra];
    const entries: LedgerEntry[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `e-eat-${i}`,
        date: "2026-09-05",
        time: null,
        type: "expense" as LedgerType,
        amount: 100,
        fromAccountId: accounts.hdfc.id,
        toAccountId: accounts.expense.id,
        categoryId: categories.eating.id,
        inBudget: true,
        notes: "",
        source: "manual" as const,
        goalId: null,
        holdingTxnId: null,
        createdAt: "2026-09-05T10:00:00+05:30",
        updatedAt: "2026-09-05T10:00:00+05:30",
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `e-groc-${i}`,
        date: "2026-09-04",
        time: null,
        type: "expense" as LedgerType,
        amount: 100,
        fromAccountId: accounts.hdfc.id,
        toAccountId: accounts.expense.id,
        categoryId: categories.groceries.id,
        inBudget: true,
        notes: "",
        source: "manual" as const,
        goalId: null,
        holdingTxnId: null,
        createdAt: "2026-09-04T10:00:00+05:30",
        updatedAt: "2026-09-04T10:00:00+05:30",
      })),
    ];
    expect(topCategoryIds(entries, "expense", cats, 5)[0]).toBe(categories.eating.id);
    expect(topCategoryIds(entries, "expense", cats, 5)[1]).toBe(categories.groceries.id);
    expect(topCategoryIds(entries, "expense", cats, 5)).toHaveLength(5);
  });

  it("filters All by name and offers create when missing", () => {
    expect(filterCategories(catalog.categories, "eat").map((row) => row.id)).toEqual([
      categories.eating.id,
    ]);
    expect(hasExactCategory(catalog.categories, "Eating outside")).toBe(true);
    expect(hasExactCategory(catalog.categories, "Milk")).toBe(false);
    expect(defaultCategoryGroup("expense")).toBe("Lifestyle");
    expect(defaultCategoryGroup("income")).toBe("Income");
  });
});

describe("inline hints", () => {
  it("explains a missing credit card instead of saving", () => {
    const noCc = catalog.accounts.filter((a) => a.group !== "credit_card");
    const ids = defaultAccounts("cc_payment", noCc, []);
    const hints = quickAddHints(
      {
        date: "2026-09-06",
        type: "cc_payment",
        amount: rupeesToPaise(240),
        fromAccountId: ids.fromId,
        toAccountId: ids.toId,
        categoryId: categories.transfer.id,
      },
      { accounts: noCc, categories: catalog.categories },
    );
    expect(hints.some((h) => /credit card/i.test(h.message))).toBe(true);
  });

  it("allows a valid HDFC CC eating-outside expense", () => {
    const ids = defaultAccounts("expense", catalog.accounts, []);
    const hints = quickAddHints(
      {
        date: "2026-09-06",
        type: "expense",
        amount: rupeesToPaise(240),
        fromAccountId: ids.fromId,
        toAccountId: ids.toId,
        categoryId: categories.eating.id,
      },
      catalog,
    );
    expect(hints).toEqual([]);
  });
});
