import { describe, expect, it } from "vitest";
import { goalAffordability } from "./goals.ts";
import { formatInr, rupeesToPaise } from "./money.ts";
import type { Goal, GoalContribution } from "./types.ts";
import { DEFAULT_BUCKET_IDS } from "./waterfall.ts";

const TODAY = "2026-09-06";
const SAVINGS = DEFAULT_BUCKET_IDS.savingsBuffer;
const SAVINGS_10K = rupeesToPaise(10_000);

function goal(
  id: string,
  name: string,
  extra: Partial<Goal> = {},
): Goal {
  return {
    id,
    name,
    targetAmount: rupeesToPaise(8_000),
    targetDate: "2027-03-06",
    priority: 1,
    fundingBucketId: SAVINGS,
    status: "active",
    notes: "",
    ...extra,
  };
}

function contribution(
  goalId: string,
  amountRupees: number,
  extra: Partial<GoalContribution> = {},
): GoalContribution {
  return {
    id: `${goalId}_c`,
    goalId,
    date: TODAY,
    amount: rupeesToPaise(amountRupees),
    note: "",
    ledgerEntryId: null,
    ...extra,
  };
}

function run(
  goals: Goal[],
  extra: {
    contributions?: GoalContribution[];
    bucket?: number;
    expected?: number;
  } = {},
) {
  return goalAffordability({
    goals,
    contributions: extra.contributions ?? [],
    bucketBalances: { [SAVINGS]: extra.bucket ?? SAVINGS_10K },
    expectedMonthlyByBucket:
      extra.expected == null ? undefined : { [SAVINGS]: rupeesToPaise(extra.expected) },
    today: TODAY,
  });
}

describe("goalAffordability — plan approval examples", () => {
  it("₹8,000 is affordable now on ₹10,000 savings; a second ₹8,000 is not", () => {
    const rows = run([
      goal("g1", "German Exams", {
        priority: 1,
        targetAmount: rupeesToPaise(8_000),
        targetDate: null,
      }),
      goal("g2", "MacBook Air", {
        priority: 2,
        targetAmount: rupeesToPaise(8_000),
        targetDate: null,
      }),
    ]);
    expect(rows[0]?.status).toBe("affordable_now");
    expect(rows[0]?.availableNow).toBe(SAVINGS_10K);
    expect(rows[1]?.status).not.toBe("affordable_now");
    expect(rows[1]?.availableNow).toBe(rupeesToPaise(2_000));
    expect(rows[1]?.status).toBe("saving");
  });

  it("higher-priority remaining ₹8,000 leaves the lower goal ₹2,000 available now", () => {
    const rows = run([
      goal("g1", "German Exams", { priority: 1, targetAmount: rupeesToPaise(8_000) }),
      goal("g2", "Germany Relocation", {
        priority: 2,
        targetAmount: rupeesToPaise(5_000),
      }),
    ]);

    expect(rows[0]?.remaining).toBe(rupeesToPaise(8_000));
    expect(rows[0]?.availableNow).toBe(SAVINGS_10K);
    expect(rows[1]?.availableNow).toBe(rupeesToPaise(2_000));
    expect(rows[1]?.remaining).toBe(rupeesToPaise(5_000));
  });
});

describe("goalAffordability — status pills (§5.10 / UX §3.6.4)", () => {
  it("marks affordable now when the bucket can cover remaining", () => {
    const [row] = run([
      goal("g1", "German Exams", { targetAmount: rupeesToPaise(8_000), targetDate: null }),
    ]);
    expect(row?.status).toBe("affordable_now");
    expect(row?.label).toBe("Affordable now");
  });

  it("marks on track when needed-per-month is within expected inflow", () => {
    const [row] = run(
      [goal("g1", "German Exams", { targetAmount: rupeesToPaise(12_000) })],
      { bucket: 0, expected: 3_000 },
    );
    // 6 months left, remaining ₹12,000 → ₹2,000/mo ≤ ₹3,000 expected.
    expect(row?.monthsLeft).toBe(6);
    expect(row?.neededPerMonth).toBe(rupeesToPaise(2_000));
    expect(row?.status).toBe("on_track");
    expect(row?.label).toBe("On track");
  });

  it("marks behind when needed-per-month exceeds expected inflow", () => {
    const [row] = run(
      [goal("g1", "German Exams", { targetAmount: rupeesToPaise(12_000) })],
      { bucket: 0, expected: 1_000 },
    );
    expect(row?.status).toBe("behind");
    expect(row?.label).toBe(`Behind: ${formatInr(rupeesToPaise(2_000))}/mo needed`);
  });

  it("marks achieved when remaining is 0", () => {
    const [row] = run([goal("g1", "German Exams", { targetAmount: rupeesToPaise(8_000) })], {
      contributions: [contribution("g1", 8_000)],
    });
    expect(row?.funded).toBe(rupeesToPaise(8_000));
    expect(row?.remaining).toBe(0);
    expect(row?.status).toBe("achieved");
    expect(row?.label).toBe("Achieved");
  });

  it("leaves remaining null when the imported target is blank", () => {
    const [row] = run([
      goal("g1", "iPhone", { targetAmount: null, targetDate: null }),
    ]);
    expect(row?.target).toBeNull();
    expect(row?.remaining).toBeNull();
    expect(row?.status).toBe("saving");
  });

  it("marks saving when there is no target date and it is not affordable now", () => {
    const [row] = run([
      goal("g1", "MacBook Air", {
        targetAmount: rupeesToPaise(80_000),
        targetDate: null,
      }),
    ]);
    expect(row?.monthsLeft).toBeNull();
    expect(row?.status).toBe("saving");
    expect(row?.label).toBe("Saving");
  });
});

describe("goalAffordability — reservation", () => {
  it("does not let a paused goal reserve cash from a lower-priority goal", () => {
    const rows = run([
      goal("g1", "Paused trip", {
        priority: 1,
        status: "paused",
        targetAmount: rupeesToPaise(8_000),
      }),
      goal("g2", "Germany Relocation", {
        priority: 2,
        targetAmount: rupeesToPaise(5_000),
      }),
    ]);
    expect(rows[1]?.availableNow).toBe(SAVINGS_10K);
  });
});
