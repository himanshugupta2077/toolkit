import { describe, expect, it } from "vitest";
import type { Books } from "../engine/types.ts";
import { rupeesToPaise } from "../engine/money.ts";
import {
  catalogFromBooks,
  extForMime,
  isAddMode,
  toLedgerPostBody,
} from "./ledgerParse.ts";

const books = {
  today: "2026-09-18",
  accounts: [
    {
      id: "acc_hdfc",
      name: "HDFC Savings",
      type: "asset",
      openingBalance: 0,
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: true,
      group: "savings",
      bucketId: null,
      statementDay: null,
      dueDay: null,
      isArchived: false,
      notes: "",
      virtualKind: null,
    },
  ],
  categories: [
    {
      id: "cat_groceries",
      name: "Groceries",
      group: "Food",
      defaultInBudget: true,
      icon: null,
      isArchived: false,
      sort: 1,
    },
  ],
  entries: [],
  monthBudgets: [],
  settings: { defaultBudget: 0, monthlySalary: 0, salaryDay: 1 },
  recurringPlans: [],
  oneTimePlans: [],
  inflows: [],
  buckets: [],
} as Books;

describe("ledger parse helpers", () => {
  it("builds a catalog from books", () => {
    const cat = catalogFromBooks(books);
    expect(cat.today).toBe("2026-09-18");
    expect(cat.accounts[0]?.name).toBe("HDFC Savings");
    expect(cat.categories[0]?.id).toBe("cat_groceries");
    expect(cat.types).toContain("expense");
  });

  it("maps a parsed entry onto a ledger post body with source ai", () => {
    const body = toLedgerPostBody(
      {
        date: "2026-09-18",
        time: null,
        type: "expense",
        amount: rupeesToPaise(20),
        fromAccountId: "acc_hdfc",
        toAccountId: "acc_expense",
        categoryId: "cat_groceries",
        inBudget: true,
        notes: "curd",
        source: "ai",
        categoryName: "Groceries",
      },
      "2026-09-18",
    );
    expect(body.source).toBe("ai");
    expect(body.amount).toBe(2000);
    expect(body.notes).toBe("curd");
    expect(body.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("picks an audio extension from mime", () => {
    expect(extForMime("audio/webm;codecs=opus")).toBe("webm");
    expect(extForMime("audio/ogg")).toBe("ogg");
    expect(isAddMode("type")).toBe(true);
    expect(isAddMode("receipt")).toBe(false);
  });
});
