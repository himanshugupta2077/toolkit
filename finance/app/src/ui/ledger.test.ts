import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import type { Account, Category, LedgerEntry, LedgerType } from "../engine/types.ts";
import {
  accountChip,
  activeFilterCount,
  amountDraftFromPaise,
  EMPTY_LEDGER_FILTERS,
  filterLedgerEntries,
  flowKind,
  formatDayHeader,
  formatMonthTitle,
  groupLedgerByDay,
  ledgerSearchParams,
  ledgerStrip,
  parseLedgerSearchParams,
  rowTitle,
} from "./ledger.ts";

const OPENING = "2026-08-01";

function account(
  id: string,
  name: string,
  group: Account["group"],
  extra?: Partial<Account>,
): Account {
  return {
    id,
    name,
    type: group === "credit_card" ? "liability" : group === "virtual" ? "virtual" : "asset",
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
    virtualKind: group === "virtual" ? "expense" : null,
    ...extra,
  };
}

function category(id: string, name: string, defaultInBudget = true): Category {
  return {
    id,
    name,
    group: "lifestyle",
    defaultInBudget,
    icon: null,
    isArchived: false,
    sort: 1,
  };
}

function entry(
  partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "type" | "amount">,
): LedgerEntry {
  return {
    date: "2026-09-06",
    time: "12:00",
    fromAccountId: "acc_cc",
    toAccountId: "acc_expense",
    categoryId: "cat_care",
    inBudget: true,
    notes: "",
    source: "manual",
    goalId: null,
    holdingTxnId: null,
    createdAt: "2026-09-06T12:00:00+05:30",
    updatedAt: "2026-09-06T12:00:00+05:30",
    ...partial,
  };
}

const ACCOUNTS = [
  account("acc_cc", "HDFC Credit Card", "credit_card"),
  account("acc_hdfc", "HDFC Savings", "savings"),
  account("acc_expense", "Expense", "virtual", { virtualKind: "expense" }),
];
const CATEGORIES = [
  category("cat_care", "Personal care"),
  category("cat_eat", "Eating outside"),
];

describe("ledger helpers", () => {
  it("treats expense as out and income as in", () => {
    expect(flowKind("expense")).toBe("out");
    expect(flowKind("income")).toBe("in");
    expect(flowKind("transfer")).toBe("through");
  });

  it("sums in / out / budget for the current filter", () => {
    const rows = [
      entry({ id: "1", type: "expense", amount: rupeesToPaise(50), inBudget: true }),
      entry({ id: "2", type: "expense", amount: rupeesToPaise(100), inBudget: false }),
      entry({
        id: "3",
        type: "income",
        amount: rupeesToPaise(1000),
        fromAccountId: "acc_emp",
        toAccountId: "acc_hdfc",
      }),
      entry({ id: "4", type: "transfer", amount: rupeesToPaise(20) }),
    ];
    expect(ledgerStrip(rows)).toEqual({
      inflow: rupeesToPaise(1000),
      outflow: rupeesToPaise(150),
      budgetSpent: rupeesToPaise(50),
    });
  });

  it("matches search on note, category, account, and amount", () => {
    const rows = [
      entry({
        id: "pc",
        type: "expense",
        amount: rupeesToPaise(50),
        notes: "",
        categoryId: "cat_care",
      }),
      entry({
        id: "eat",
        type: "expense",
        amount: rupeesToPaise(240),
        notes: "Swiggy",
        categoryId: "cat_eat",
      }),
    ];
    const found = filterLedgerEntries(
      rows,
      { ...EMPTY_LEDGER_FILTERS, q: "50" },
      ACCOUNTS,
      CATEGORIES,
    );
    expect(found.map((row) => row.id)).toEqual(["pc"]);
    expect(
      filterLedgerEntries(
        rows,
        { ...EMPTY_LEDGER_FILTERS, q: "personal" },
        ACCOUNTS,
        CATEGORIES,
      ).map((row) => row.id),
    ).toEqual(["pc"]);
    expect(
      filterLedgerEntries(
        rows,
        { ...EMPTY_LEDGER_FILTERS, q: "swiggy" },
        ACCOUNTS,
        CATEGORIES,
      ).map((row) => row.id),
    ).toEqual(["eat"]);
    expect(
      filterLedgerEntries(
        rows,
        { ...EMPTY_LEDGER_FILTERS, type: "expense" as LedgerType, categoryId: "cat_care" },
        ACCOUNTS,
        CATEGORIES,
      ).map((row) => row.id),
    ).toEqual(["pc"]);
  });

  it("groups 160 rows by day newest first without dropping any", () => {
    const rows = Array.from({ length: 160 }, (_, i) =>
      entry({
        id: `r${i}`,
        type: "expense",
        amount: rupeesToPaise(1),
        date: i < 80 ? "2026-08-01" : "2026-08-02",
        createdAt: `2026-08-01T00:${String(i % 60).padStart(2, "0")}:00+05:30`,
      }),
    );
    const groups = groupLedgerByDay(rows);
    expect(groups.map((g) => g.date)).toEqual(["2026-08-02", "2026-08-01"]);
    expect(groups[0]?.entries).toHaveLength(80);
    expect(groups[1]?.entries).toHaveLength(80);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(160);
  });

  it("formats month and day labels in en-GB", () => {
    expect(formatMonthTitle("2026-09")).toBe("September 2026");
    expect(formatDayHeader("2026-09-06")).toBe("Sun 6 Sep");
  });

  it("uses the note as the row title, else the category", () => {
    const withNote = entry({
      id: "n",
      type: "expense",
      amount: 1,
      notes: "haircut",
    });
    const noNote = entry({ id: "c", type: "expense", amount: 1, notes: "  " });
    expect(rowTitle(withNote, CATEGORIES)).toBe("haircut");
    expect(rowTitle(noNote, CATEGORIES)).toBe("Personal care");
    expect(accountChip(noNote, ACCOUNTS)).toBe("HDFC Credit Card");
  });

  it("round-trips search params and counts sheet filters (not q)", () => {
    const params = ledgerSearchParams("2026-09", {
      q: "care",
      type: "expense",
      accountId: "acc_cc",
      categoryId: "cat_care",
      inBudget: true,
      source: "manual",
    });
    expect(activeFilterCount(parseLedgerSearchParams(params, "2026-01").filters)).toBe(5);
    const parsed = parseLedgerSearchParams(params, "2026-01");
    expect(parsed.month).toBe("2026-09");
    expect(parsed.filters.q).toBe("care");
    expect(parsed.filters.inBudget).toBe(true);
  });

  it("rebuilds a keypad draft from paise", () => {
    expect(amountDraftFromPaise(rupeesToPaise(50))).toEqual({ parts: [], buffer: "50" });
    expect(amountDraftFromPaise(12345)).toEqual({ parts: [], buffer: "123.45" });
  });
});
