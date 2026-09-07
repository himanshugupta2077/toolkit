import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import type { Category, ExpectedInflow, OneTimePlan, RecurringPlan } from "../engine/types.ts";
import {
  categoryBarWidth,
  frequencyLabel,
  inflowsSorted,
  nextDueLabel,
  oneTimeSorted,
  parsePlanSearchParams,
  planHref,
  recurringSections,
} from "./plan.ts";

const TODAY = "2026-09-06";

function cat(id: string, name: string): Category {
  return { id, name, group: "Lifestyle", defaultInBudget: true, icon: null, isArchived: false, sort: 0 };
}

function rec(partial: Partial<RecurringPlan> & Pick<RecurringPlan, "id" | "name">): RecurringPlan {
  return {
    categoryId: "cat_other",
    frequency: "monthly",
    intervalMonths: null,
    amount: rupeesToPaise(1000),
    startDate: "2026-08-01",
    endDate: null,
    active: true,
    kind: "lifestyle",
    payFromAccountId: null,
    notes: "",
    autoPost: false,
    lastPostedMonth: null,
    ...partial,
  };
}

const categories = [cat("cat_emi", "EMIs"), cat("cat_other", "Other")];

describe("plan search params", () => {
  it("defaults to budget this month", () => {
    expect(parsePlanSearchParams(new URLSearchParams(), "2026-09")).toEqual({
      tab: "budget",
      month: "2026-09",
      assumeInflows: false,
    });
  });

  it("reads forecast + assume inflows", () => {
    const params = new URLSearchParams("tab=forecast&assumeInflows=1&month=2026-10");
    expect(parsePlanSearchParams(params, "2026-09")).toEqual({
      tab: "forecast",
      month: "2026-10",
      assumeInflows: true,
    });
    expect(planHref({ tab: "forecast", month: "2026-09", assumeInflows: false })).toBe(
      "/plan?tab=forecast&month=2026-09",
    );
  });
});

describe("recurring sections", () => {
  const smart = rec({
    id: "rec_emi",
    name: "MacBook SmartEMI",
    categoryId: "cat_emi",
    kind: "loan_emi",
    amount: rupeesToPaise(38200),
  });
  const milk = rec({ id: "rec_milk", name: "Milk", kind: "lifestyle" });
  const ended = rec({
    id: "rec_rent",
    name: "Old rent",
    endDate: "2026-08-31",
    kind: "lifestyle",
  });
  const inactive = rec({
    id: "rec_gym",
    name: "Gym",
    active: false,
    kind: "lifestyle",
  });
  const yearly = rec({
    id: "rec_ins",
    name: "Scooty insurance",
    frequency: "yearly",
    startDate: "2026-12-01",
    kind: "lifestyle",
    amount: rupeesToPaise(1800),
  });
  const plans = [smart, milk, ended, inactive, yearly];

  it("All shows active live rows and folds ended", () => {
    const { live, ended: endedRows } = recurringSections(plans, "all", TODAY, categories);
    expect(live.map((row) => row.id).sort()).toEqual(["rec_emi", "rec_ins", "rec_milk"]);
    expect(endedRows.map((row) => row.id)).toEqual(["rec_rent"]);
  });

  it("Loan/EMI chip hides lifestyle", () => {
    const { live, ended: endedRows } = recurringSections(plans, "loan_emi", TODAY, categories);
    expect(live.map((row) => row.id)).toEqual(["rec_emi"]);
    expect(endedRows).toEqual([]);
  });

  it("Inactive chip is only the off switch, not ended", () => {
    const { live, ended: endedRows } = recurringSections(plans, "inactive", TODAY, categories);
    expect(live.map((row) => row.id)).toEqual(["rec_gym"]);
    expect(endedRows).toEqual([]);
  });

  it("next due for yearly insurance is the anniversary", () => {
    expect(nextDueLabel(yearly, TODAY)).toBe("Next 1 Dec");
    expect(frequencyLabel(yearly)).toBe("Yearly");
  });
});

describe("one-time and inflows lists", () => {
  it("sorts planned by date and drops other statuses", () => {
    const rows: OneTimePlan[] = [
      {
        id: "ot_b",
        name: "B",
        categoryId: "cat_other",
        expectedDate: "2026-10-01",
        amount: 1,
        priority: "low",
        status: "planned",
        payFromAccountId: null,
        notes: "",
        linkedLedgerEntryId: null,
      },
      {
        id: "ot_a",
        name: "A",
        categoryId: "cat_other",
        expectedDate: "2026-09-20",
        amount: 1,
        priority: "high",
        status: "planned",
        payFromAccountId: null,
        notes: "",
        linkedLedgerEntryId: null,
      },
      {
        id: "ot_c",
        name: "C",
        categoryId: "cat_other",
        expectedDate: "2026-09-10",
        amount: 1,
        priority: "medium",
        status: "completed",
        payFromAccountId: null,
        notes: "",
        linkedLedgerEntryId: null,
      },
    ];
    expect(oneTimeSorted(rows, "planned").map((row) => row.id)).toEqual(["ot_a", "ot_b"]);
    expect(oneTimeSorted(rows, "completed").map((row) => row.id)).toEqual(["ot_c"]);
  });

  it("inflows stay in expected until marked received", () => {
    const rows: ExpectedInflow[] = [
      {
        id: "in_1",
        name: "Bonus",
        categoryId: "",
        expectedDate: "2026-09-30",
        amount: 1,
        isLiquid: true,
        status: "expected",
        notes: "",
        linkedLedgerEntryId: null,
      },
      {
        id: "in_2",
        name: "Old",
        categoryId: "",
        expectedDate: "2026-08-01",
        amount: 1,
        isLiquid: true,
        status: "received",
        notes: "",
        linkedLedgerEntryId: null,
      },
    ];
    expect(inflowsSorted(rows, "expected").map((row) => row.id)).toEqual(["in_1"]);
  });
});

describe("category bars", () => {
  it("scales against the largest spend", () => {
    expect(categoryBarWidth(50, 100)).toBe(0.5);
    expect(categoryBarWidth(0, 100)).toBe(0);
    expect(categoryBarWidth(100, 0)).toBe(0);
  });
});
