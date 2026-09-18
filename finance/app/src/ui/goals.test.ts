import { describe, expect, it } from "vitest";
import { DEFAULT_BUCKET_IDS, rupeesToPaise, type GoalStatus } from "../engine/index.ts";
import {
  EMPTY_GOALS_HINT,
  FILL_TARGET_PROMPT,
  displayPill,
  fundNowAmount,
  fundTodayWhy,
  fundingNote,
  goalFillPct,
  goalNeedsTarget,
  goalsStrip,
  moveGoal,
  totalRemaining,
  type GoalCard,
} from "./goals.ts";

const SAVINGS = DEFAULT_BUCKET_IDS.savingsBuffer;

function card(
  partial: Partial<GoalCard> & Pick<GoalCard, "id" | "name">,
): GoalCard {
  return {
    targetAmount: rupeesToPaise(8_000),
    targetDate: null,
    priority: 1,
    fundingBucketId: SAVINGS,
    status: "active",
    notes: "",
    funded: 0,
    remaining: rupeesToPaise(8_000),
    availableNow: rupeesToPaise(10_000),
    monthsLeft: null,
    neededPerMonth: null,
    expectedMonthly: 0,
    pill: "affordable_now",
    pillLabel: "Affordable now",
    needsTarget: false,
    contributionCount: 0,
    ...partial,
  };
}

describe("goals copy", () => {
  it("says the first ₹8,000 is affordable now and the second is not", () => {
    const first = card({
      id: "g1",
      name: "German Exams",
      priority: 1,
      remaining: rupeesToPaise(8_000),
      availableNow: rupeesToPaise(10_000),
      pill: "affordable_now",
    });
    const second = card({
      id: "g2",
      name: "MacBook Air",
      priority: 2,
      remaining: rupeesToPaise(8_000),
      availableNow: rupeesToPaise(2_000),
      pill: "saving",
      pillLabel: "Saving",
    });
    expect(
      fundTodayWhy({
        needsTarget: false,
        remaining: first.remaining,
        availableNow: first.availableNow,
        bucketName: "Savings buffer",
        bucketBalance: rupeesToPaise(10_000),
        higherPriority: [],
        lifecycle: "active",
      }),
    ).toBe("Yes: Savings buffer has ₹10,000.00 and this goal needs ₹8,000.00.");
    expect(
      fundTodayWhy({
        needsTarget: false,
        remaining: second.remaining,
        availableNow: second.availableNow,
        bucketName: "Savings buffer",
        bucketBalance: rupeesToPaise(10_000),
        higherPriority: [{ name: "German Exams", remaining: rupeesToPaise(8_000) }],
        lifecycle: "active" satisfies GoalStatus,
      }),
    ).toContain("No:");
    expect(
      fundTodayWhy({
        needsTarget: false,
        remaining: second.remaining,
        availableNow: second.availableNow,
        bucketName: "Savings buffer",
        bucketBalance: rupeesToPaise(10_000),
        higherPriority: [{ name: "German Exams", remaining: rupeesToPaise(8_000) }],
        lifecycle: "active",
      }),
    ).toContain("German Exams still needs ₹8,000.00");
  });

  it("prompts to fill a blank imported target", () => {
    expect(goalNeedsTarget({ targetAmount: null })).toBe(true);
    expect(
      fundTodayWhy({
        needsTarget: true,
        remaining: null,
        availableNow: rupeesToPaise(10_000),
        bucketName: "Savings buffer",
        bucketBalance: rupeesToPaise(10_000),
        higherPriority: [],
        lifecycle: "active",
      }),
    ).toBe("Fill a target amount to see if this is affordable.");
    expect(FILL_TARGET_PROMPT).toBe("Fill a target amount");
    expect(EMPTY_GOALS_HINT).toContain("MacBook Air");
  });

  it("reorders by priority and totals remaining", () => {
    const rows = [
      card({ id: "g1", name: "A", priority: 1 }),
      card({ id: "g2", name: "B", priority: 2, remaining: rupeesToPaise(8_000) }),
    ];
    const moved = moveGoal(rows, "g2", -1);
    expect(moved.map((row) => row.id)).toEqual(["g2", "g1"]);
    expect(moved[0]?.priority).toBe(1);
    expect(totalRemaining(rows)).toBe(rupeesToPaise(16_000));
    expect(goalFillPct(rupeesToPaise(4_000), rupeesToPaise(8_000))).toBe(0.5);
    expect(goalFillPct(0, null)).toBeNull();
    expect(fundNowAmount(rows[0]!)).toBe(rupeesToPaise(8_000));
    expect(fundingNote(rows, [{ id: SAVINGS, name: "Savings buffer" }])).toBe(
      "Funded from Savings buffer",
    );
    expect(goalsStrip(rows, 3).map((row) => row.id)).toEqual(["g1", "g2"]);
    expect(displayPill({ status: "achieved", remaining: rupeesToPaise(100), pill: "saving", pillLabel: "Saving" }).label).toBe(
      "Achieved",
    );
  });
});
