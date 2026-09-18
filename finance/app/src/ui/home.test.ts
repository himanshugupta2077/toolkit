import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import type { MonthSummary } from "../engine/budget.ts";
import {
  calendarDaysLeft,
  daysLeftLabel,
  dueInLabel,
  formatPct,
  homeActionCards,
  monthTiles,
  nextDueDate,
  paceHeadline,
  savingsMonthBars,
  stackedMonthBars,
  upcomingBillHref,
  upcomingBillSubline,
  upcomingBillsTotal,
  upcomingDueCaption,
} from "./home.ts";

const TODAY = "2026-09-06";

const summary: MonthSummary = {
  month: "2026-09",
  income: rupeesToPaise(83167),
  budgetSpent: rupeesToPaise(26401.04),
  nonBudgetExp: 0,
  investments: rupeesToPaise(20000),
  emis: rupeesToPaise(0),
  rent: rupeesToPaise(10800),
  ccPayments: 0,
  estSavings: rupeesToPaise(36765.96),
};

describe("pace copy", () => {
  it("uses the empty-month headline when spent is 0", () => {
    expect(paceHeadline({ spent: 0, safePerDay: rupeesToPaise(1240) })).toBe(
      "No spending yet: ₹1,240.00 / day",
    );
    expect(paceHeadline({ spent: 100, safePerDay: rupeesToPaise(1215) })).toBe(
      "Safe to spend today ₹1,215.00 / day",
    );
  });

  it("labels days left and percents", () => {
    expect(daysLeftLabel(25)).toBe("25 days left");
    expect(daysLeftLabel(1)).toBe("1 day left");
    expect(daysLeftLabel(0)).toBe("Month ended");
    expect(calendarDaysLeft(TODAY)).toBe(25);
    expect(formatPct(0.2)).toBe("20%");
    expect(formatPct(0.404)).toBe("40%");
  });
});

describe("next due day", () => {
  it("picks this month when the due day is still ahead", () => {
    expect(nextDueDate(TODAY, 7)).toBe("2026-09-07");
    expect(dueInLabel(TODAY, 7)).toBe("due in 1 day");
  });

  it("is today when the due day is today", () => {
    expect(nextDueDate(TODAY, 6)).toBe(TODAY);
    expect(dueInLabel(TODAY, 6)).toBe("due today");
  });

  it("rolls to next month when the due day has passed", () => {
    expect(nextDueDate(TODAY, 5)).toBe("2026-10-05");
    expect(dueInLabel(TODAY, 5)).toBe("due in 29 days");
  });

  it("clamps 31 to the last day of shorter months", () => {
    expect(nextDueDate("2026-09-01", 31)).toBe("2026-09-30");
    expect(nextDueDate(TODAY, null)).toBeNull();
  });
});

describe("month tiles", () => {
  it("links budget spend to in-budget expenses this month", () => {
    const tiles = monthTiles("2026-09", summary);
    expect(tiles).toHaveLength(6);
    expect(tiles[0]?.href).toContain("type=income");
    expect(tiles[1]?.href).toContain("type=expense");
    expect(tiles[1]?.href).toContain("inBudget=1");
    expect(tiles[2]?.href).toContain("inBudget=0");
    expect(tiles[3]?.href).toContain("type=investment");
    expect(tiles[4]?.amount).toBe(summary.emis + summary.rent);
    expect(tiles[4]?.href).toBe("/ledger?month=2026-09");
  });
});

describe("stacked month bars", () => {
  it("scales height to the largest total", () => {
    const bars = stackedMonthBars([
      { month: "2026-09", loanEmi: 100, lifestyle: 50, investment: 50, total: 200 },
      { month: "2026-10", loanEmi: 50, lifestyle: 25, investment: 25, total: 100 },
      { month: "2026-11", loanEmi: 0, lifestyle: 0, investment: 0, total: 0 },
    ]);
    expect(bars[0]?.height).toBe(1);
    expect(bars[1]?.height).toBe(0.5);
    expect(bars[2]?.height).toBe(0);
    expect(bars[0]?.shares.loanEmi).toBe(0.5);
  });
});

describe("savings bars", () => {
  it("scales height to the largest absolute month", () => {
    const bars = savingsMonthBars([
      { month: "2026-07", savings: 200 },
      { month: "2026-08", savings: 100 },
      { month: "2026-09", savings: -50 },
    ]);
    expect(bars[0]?.height).toBe(1);
    expect(bars[1]?.height).toBe(0.5);
    expect(bars[2]?.height).toBe(0.25);
  });
});

describe("upcoming payments copy", () => {
  it("links recurring to Plan Recurring and one-time to Plan One-time", () => {
    expect(upcomingBillHref({ source: "recurring" })).toBe("/plan?tab=recurring");
    expect(upcomingBillHref({ source: "one_time" })).toBe("/plan?tab=one-time");
  });

  it("labels due relative to today and names the kind or cadence", () => {
    expect(upcomingDueCaption(TODAY, TODAY)).toBe("today");
    expect(upcomingDueCaption(TODAY, "2026-09-07")).toBe("tomorrow");
    expect(upcomingDueCaption(TODAY, "2026-10-01")).toBe("in 25 days");
    expect(
      upcomingBillSubline(
        { source: "recurring", frequency: "monthly", dueDate: "2026-10-01" },
        TODAY,
      ),
    ).toBe("1 Oct · Monthly · in 25 days");
    expect(
      upcomingBillSubline(
        {
          source: "recurring",
          frequency: "monthly",
          dueDate: "2026-10-01",
          kind: "investment",
        },
        TODAY,
      ),
    ).toBe("1 Oct · Investment · in 25 days");
    expect(
      upcomingBillSubline(
        { source: "recurring", frequency: "yearly", dueDate: "2026-12-01" },
        TODAY,
      ),
    ).toBe("1 Dec · Yearly · in 86 days");
    expect(
      upcomingBillSubline(
        { source: "one_time", frequency: null, dueDate: "2026-09-20", kind: null },
        TODAY,
      ),
    ).toBe("20 Sep · One-time · in 14 days");
    expect(upcomingBillsTotal([{ amount: 100 }, { amount: 50 }])).toBe(150);
  });
});

describe("home action cards", () => {
  it("flags negative free cash and skips reconcile nags", () => {
    const cards = homeActionCards({
      free: rupeesToPaise(-100),
    });
    expect(cards.map((row) => row.kind)).toEqual(["negative_free"]);
  });

  it("offers allocate when free is positive", () => {
    const cards = homeActionCards({
      free: rupeesToPaise(22400),
    });
    expect(cards.map((row) => row.kind)).toEqual(["allocate"]);
    expect(cards[0]?.disabled).toBe(false);
    expect(cards[0]?.href).toBe("/wealth/allocate");
  });
});
