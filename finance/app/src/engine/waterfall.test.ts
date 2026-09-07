import { describe, expect, it } from "vitest";
import { type MonthLedgerEntry } from "./budget.ts";
import { rupeesToPaise } from "./money.ts";
import type { Account, Bucket, Category } from "./types.ts";
import {
  bucketCurrentBalances,
  bucketFillPct,
  bucketMonthsFilled,
  DEFAULT_BUCKET_IDS,
  DEFAULT_EF_MONTHS,
  DEFAULT_SAVINGS_BUFFER_TARGET,
  monthEssentials,
  resolveBucketTarget,
  runWaterfall,
  seedDefaultBuckets,
  trailingEssentialsAverage,
  validateBuckets,
} from "./waterfall.ts";

const OPENING = "2026-08-01";
const EF = DEFAULT_BUCKET_IDS.emergencyFund;
const SAVINGS = DEFAULT_BUCKET_IDS.savingsBuffer;
const INVEST = DEFAULT_BUCKET_IDS.investment;

const SURPLUS = rupeesToPaise(20_000);
const EF_ROOM = rupeesToPaise(12_400);
const SAVINGS_ROOM = rupeesToPaise(10_000);

function cat(
  id: string,
  name: string,
  extra: Partial<Category> = {},
): Category {
  return {
    id,
    name,
    group: "Lifestyle",
    defaultInBudget: true,
    icon: null,
    isArchived: false,
    sort: 0,
    ...extra,
  };
}

function asset(
  id: string,
  name: string,
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
    includeLiquid: true,
    group: "savings",
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
    ...extra,
  };
}

function tx(
  date: string,
  amountRupees: number,
  extra: Partial<MonthLedgerEntry> = {},
): MonthLedgerEntry {
  return {
    date,
    type: "expense",
    amount: rupeesToPaise(amountRupees),
    inBudget: true,
    categoryId: "cat_food",
    ...extra,
  };
}

function amounts(result: ReturnType<typeof runWaterfall>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of result.lines) out[line.bucketId] = line.amount;
  return out;
}

/** Seed plan with EF as a fixed target so room is explicit. */
function fixedPlan(
  efTarget: number,
  savingsTarget: number = SAVINGS_ROOM,
  extra: {
    ef?: Partial<Bucket>;
    savings?: Partial<Bucket>;
    investment?: Partial<Bucket>;
  } = {},
): Bucket[] {
  const [ef, savings, investment] = seedDefaultBuckets();
  return [
    {
      ...ef,
      targetRule: "fixed",
      targetAmount: efTarget,
      targetMonths: null,
      ...extra.ef,
    },
    {
      ...savings,
      targetAmount: savingsTarget,
      ...extra.savings,
    },
    { ...investment, ...extra.investment },
  ];
}

describe("seedDefaultBuckets", () => {
  it("seeds EF → Savings → Investment with locked v1 defaults", () => {
    const [ef, savings, investment] = seedDefaultBuckets();
    expect(ef.id).toBe(EF);
    expect(ef.priority).toBe(1);
    expect(ef.targetRule).toBe("months_of_essentials");
    expect(ef.targetMonths).toBe(DEFAULT_EF_MONTHS);
    expect(ef.fillMode).toBe("until_target");

    expect(savings.id).toBe(SAVINGS);
    expect(savings.targetRule).toBe("fixed");
    expect(savings.targetAmount).toBe(DEFAULT_SAVINGS_BUFFER_TARGET);
    expect(savings.fillMode).toBe("until_target");

    expect(investment.id).toBe(INVEST);
    expect(investment.targetRule).toBe("none");
    expect(investment.fillMode).toBe("remainder");

    expect(validateBuckets(seedDefaultBuckets()).ok).toBe(true);
  });
});

describe("runWaterfall — plan approval examples", () => {
  it("fills EF room then Savings; Investment gets 0 when surplus runs out", () => {
    const result = runWaterfall(SURPLUS, fixedPlan(EF_ROOM, SAVINGS_ROOM), {});
    expect(amounts(result)).toEqual({
      [EF]: EF_ROOM,
      [SAVINGS]: rupeesToPaise(7_600),
      [INVEST]: 0,
    });
    expect(result.leftover).toBe(0);
    expect(result.totalAllocated).toBe(SURPLUS);
  });

  it("sends all surplus to Investment when both targets are full", () => {
    const result = runWaterfall(SURPLUS, fixedPlan(EF_ROOM, SAVINGS_ROOM), {
      [EF]: EF_ROOM,
      [SAVINGS]: SAVINGS_ROOM,
    });
    expect(amounts(result)).toEqual({
      [EF]: 0,
      [SAVINGS]: 0,
      [INVEST]: SURPLUS,
    });
    expect(result.lines[0]?.room).toBe(0);
    expect(result.lines[1]?.room).toBe(0);
  });

  it("returns all zeros when surplus is 0", () => {
    const result = runWaterfall(0, fixedPlan(EF_ROOM), {});
    expect(amounts(result)).toEqual({ [EF]: 0, [SAVINGS]: 0, [INVEST]: 0 });
    expect(result.leftover).toBe(0);
    expect(result.totalAllocated).toBe(0);
  });

  it("returns all zeros and does not throw when surplus is negative", () => {
    const negative = rupeesToPaise(-26_297.91);
    const result = runWaterfall(negative, fixedPlan(EF_ROOM), {});
    expect(amounts(result)).toEqual({ [EF]: 0, [SAVINGS]: 0, [INVEST]: 0 });
    expect(result.leftover).toBe(negative);
    expect(result.totalAllocated).toBe(0);
  });
});

describe("runWaterfall — line overrides", () => {
  it("re-flows leftover after a smaller EF override", () => {
    const result = runWaterfall(
      SURPLUS,
      fixedPlan(EF_ROOM, SAVINGS_ROOM),
      {},
      undefined,
      { [EF]: rupeesToPaise(5_000) },
    );
    expect(amounts(result)).toEqual({
      [EF]: rupeesToPaise(5_000),
      [SAVINGS]: SAVINGS_ROOM,
      [INVEST]: rupeesToPaise(5_000),
    });
  });

  it("caps an EF override by room, then continues the plan", () => {
    const result = runWaterfall(
      SURPLUS,
      fixedPlan(EF_ROOM, SAVINGS_ROOM),
      {},
      undefined,
      { [EF]: SURPLUS },
    );
    expect(amounts(result)).toEqual({
      [EF]: EF_ROOM,
      [SAVINGS]: rupeesToPaise(7_600),
      [INVEST]: 0,
    });
  });

  it("ignores overrides when surplus is not positive", () => {
    const result = runWaterfall(0, fixedPlan(EF_ROOM), {}, undefined, {
      [EF]: EF_ROOM,
    });
    expect(amounts(result)[EF]).toBe(0);
  });
});

describe("runWaterfall — fill modes", () => {
  it("takes percent of the original surplus, then remainder gets the rest", () => {
    const buckets = fixedPlan(EF_ROOM, SAVINGS_ROOM, {
      ef: { fillMode: "percent", fillValue: 40, targetRule: "none", targetAmount: null },
      savings: { fillMode: "percent", fillValue: 25 },
    });
    const result = runWaterfall(SURPLUS, buckets, {});
    expect(amounts(result)).toEqual({
      [EF]: rupeesToPaise(8_000),
      [SAVINGS]: rupeesToPaise(5_000),
      [INVEST]: rupeesToPaise(7_000),
    });
  });

  it("caps a percent line by remaining room", () => {
    const buckets = fixedPlan(rupeesToPaise(3_000), SAVINGS_ROOM, {
      ef: { fillMode: "percent", fillValue: 40 },
    });
    const result = runWaterfall(SURPLUS, buckets, {});
    expect(amounts(result)[EF]).toBe(rupeesToPaise(3_000));
  });

  it("gives a fixed fill, capped by surplus and room", () => {
    const buckets = fixedPlan(EF_ROOM, SAVINGS_ROOM, {
      ef: { fillMode: "fixed", fillValue: rupeesToPaise(5_000) },
    });
    const result = runWaterfall(SURPLUS, buckets, {});
    expect(amounts(result)[EF]).toBe(rupeesToPaise(5_000));
    expect(amounts(result)[SAVINGS]).toBe(SAVINGS_ROOM);
    expect(amounts(result)[INVEST]).toBe(rupeesToPaise(5_000));
  });

  it("skips inactive buckets", () => {
    const buckets = fixedPlan(EF_ROOM, SAVINGS_ROOM, {
      savings: { active: false },
    });
    const result = runWaterfall(SURPLUS, buckets, {});
    expect(result.lines.map((line) => line.bucketId)).toEqual([EF, INVEST]);
    expect(amounts(result)[EF]).toBe(EF_ROOM);
    expect(amounts(result)[INVEST]).toBe(rupeesToPaise(7_600));
  });

  it("treats a missing current balance as 0", () => {
    const result = runWaterfall(SURPLUS, fixedPlan(EF_ROOM), {});
    expect(result.lines[0]?.current).toBe(0);
    expect(result.lines[0]?.room).toBe(EF_ROOM);
  });

  it("uses room = target − current when the bucket is partly filled", () => {
    const target = rupeesToPaise(20_000);
    const current = rupeesToPaise(7_600);
    const result = runWaterfall(
      SURPLUS,
      fixedPlan(target),
      { [EF]: current },
    );
    expect(result.lines[0]?.room).toBe(EF_ROOM);
    expect(amounts(result)[EF]).toBe(EF_ROOM);
  });
});

describe("runWaterfall — months of essentials", () => {
  it("resolves EF target as months × average, then fills room", () => {
    const average = rupeesToPaise(10_000);
    const current = rupeesToPaise(47_600);
    const buckets = seedDefaultBuckets();
    expect(resolveBucketTarget(buckets[0]!, average)).toBe(rupeesToPaise(60_000));

    const result = runWaterfall(SURPLUS, buckets, { [EF]: current }, average);
    expect(result.lines[0]?.target).toBe(rupeesToPaise(60_000));
    expect(result.lines[0]?.room).toBe(EF_ROOM);
    expect(amounts(result)).toEqual({
      [EF]: EF_ROOM,
      [SAVINGS]: rupeesToPaise(7_600),
      [INVEST]: 0,
    });
  });

  it("throws if EF is months-of-essentials and no average is passed", () => {
    expect(() => runWaterfall(SURPLUS, seedDefaultBuckets(), {})).toThrow(
      /essentialsMonthlyAverage/,
    );
  });
});

describe("validateBuckets", () => {
  it("rejects two remainder buckets", () => {
    const buckets = fixedPlan(EF_ROOM, SAVINGS_ROOM, {
      savings: { fillMode: "remainder", targetRule: "none", targetAmount: null },
    });
    const result = validateBuckets(buckets);
    expect(result.ok).toBe(false);
    expect(result.issues.some((row) => row.code === "remainder_count")).toBe(true);
    expect(() => runWaterfall(SURPLUS, buckets, {})).toThrow(/remainder_count/);
  });

  it("rejects percent fills that sum above 100", () => {
    const buckets = fixedPlan(EF_ROOM, SAVINGS_ROOM, {
      ef: { fillMode: "percent", fillValue: 60, targetRule: "none", targetAmount: null },
      savings: { fillMode: "percent", fillValue: 50 },
    });
    const result = validateBuckets(buckets);
    expect(result.ok).toBe(false);
    expect(result.issues.some((row) => row.code === "percent_sum")).toBe(true);
  });

  it("allows percent fills that sum to 100", () => {
    const buckets = fixedPlan(EF_ROOM, SAVINGS_ROOM, {
      ef: { fillMode: "percent", fillValue: 70, targetRule: "none", targetAmount: null },
      savings: { fillMode: "percent", fillValue: 30 },
    });
    expect(validateBuckets(buckets).ok).toBe(true);
  });

  it("rejects until-target with no target", () => {
    const buckets = fixedPlan(EF_ROOM, SAVINGS_ROOM, {
      ef: { targetRule: "none", targetAmount: null },
    });
    expect(
      validateBuckets(buckets).issues.some(
        (row) => row.code === "until_target_needs_target",
      ),
    ).toBe(true);
  });

  it("rejects a duplicate id", () => {
    const buckets = fixedPlan(EF_ROOM, SAVINGS_ROOM, {
      savings: { id: EF },
    });
    expect(validateBuckets(buckets).issues.some((row) => row.code === "duplicate_id")).toBe(
      true,
    );
  });
});

describe("monthEssentials / trailingEssentialsAverage", () => {
  const food = cat("cat_food", "Groceries");
  const rent = cat("cat_rent", "Rent", { group: "Housing", defaultInBudget: false });
  const emi = cat("cat_emi", "EMIs", { group: "Loan", defaultInBudget: false });
  const fun = cat("cat_fun", "Entertainment");
  const categories = [food, rent, emi, fun];
  const essentials = [food.id];

  it("adds in-budget essentials + rent + EMIs", () => {
    const entries = [
      tx("2026-08-04", 5_000),
      tx("2026-08-10", 10_800, { categoryId: rent.id, inBudget: false }),
      tx("2026-08-12", 2_000, { categoryId: emi.id, inBudget: false }),
      tx("2026-08-20", 900, { categoryId: fun.id }),
    ];
    expect(monthEssentials("2026-08", entries, categories, essentials)).toBe(
      rupeesToPaise(17_800),
    );
  });

  it("does not double-count rent or EMIs when those categories are essential", () => {
    const entries = [
      tx("2026-08-10", 10_800, { categoryId: rent.id, inBudget: true }),
      tx("2026-08-12", 2_000, { categoryId: emi.id, inBudget: true }),
    ];
    expect(
      monthEssentials("2026-08", entries, categories, [food.id, rent.id, emi.id]),
    ).toBe(rupeesToPaise(12_800));
  });

  it("nets in-budget refunds in essentials categories", () => {
    const entries = [
      tx("2026-08-04", 5_000),
      tx("2026-08-20", 1_000, { type: "refund" }),
    ];
    expect(monthEssentials("2026-08", entries, categories, essentials)).toBe(
      rupeesToPaise(4_000),
    );
  });

  it("averages completed months we have, not a padded 3", () => {
    const entries = [
      tx("2026-07-28", 10_000),
      tx("2026-07-31", 10_800, { categoryId: rent.id, inBudget: false }),
      tx("2026-08-04", 12_000),
      tx("2026-08-10", 10_800, { categoryId: rent.id, inBudget: false }),
      tx("2026-08-12", 2_000, { categoryId: emi.id, inBudget: false }),
      tx("2026-09-02", 3_000),
    ];
    const trailing = trailingEssentialsAverage(
      "2026-09-06",
      entries,
      categories,
      essentials,
    );
    expect(trailing.months.map((row) => row.month)).toEqual(["2026-07", "2026-08"]);
    expect(trailing.monthsUsed).toBe(2);
    expect(trailing.months[0]?.amount).toBe(rupeesToPaise(20_800));
    expect(trailing.months[1]?.amount).toBe(rupeesToPaise(24_800));
    expect(trailing.average).toBe(rupeesToPaise(22_800));
  });

  it("returns 0 when there is no completed month yet", () => {
    const trailing = trailingEssentialsAverage(
      "2026-09-06",
      [tx("2026-09-02", 3_000)],
      categories,
      essentials,
    );
    expect(trailing.monthsUsed).toBe(0);
    expect(trailing.average).toBe(0);
  });
});

describe("bucketCurrentBalances", () => {
  it("sums tagged accounts and ignores unassigned liquid", () => {
    const accounts = [
      asset("fd", "FD", { group: "fd", includeLiquid: false, bucketId: EF }),
      asset("icici", "ICICI Savings", { bucketId: SAVINGS }),
      asset("mf", "Mutual Fund", {
        group: "investment",
        includeLiquid: false,
        bucketId: INVEST,
      }),
      asset("hdfc", "HDFC Savings"),
    ];
    const totals = bucketCurrentBalances(accounts, [
      { accountId: "fd", balance: rupeesToPaise(20_000) },
      { accountId: "icici", balance: rupeesToPaise(2_400) },
      { accountId: "mf", balance: rupeesToPaise(50_000) },
      { accountId: "hdfc", balance: rupeesToPaise(5_000) },
    ]);
    expect(totals).toEqual({
      [EF]: rupeesToPaise(20_000),
      [SAVINGS]: rupeesToPaise(2_400),
      [INVEST]: rupeesToPaise(50_000),
    });
  });
});

describe("bucketFillPct / bucketMonthsFilled", () => {
  it("uses tagged current over target, including over-full", () => {
    expect(bucketFillPct(rupeesToPaise(20_000), rupeesToPaise(40_000))).toBe(0.5);
    expect(bucketFillPct(rupeesToPaise(20_000), rupeesToPaise(20_000))).toBe(1);
    expect(bucketFillPct(rupeesToPaise(25_000), rupeesToPaise(20_000))).toBe(1.25);
    expect(bucketFillPct(rupeesToPaise(20_000), null)).toBeNull();
    expect(bucketFillPct(rupeesToPaise(20_000), 0)).toBeNull();
  });

  it("covers months of essentials from current / average", () => {
    expect(bucketMonthsFilled(rupeesToPaise(20_000), rupeesToPaise(4_255))).toBeCloseTo(
      20000 / 4255,
    );
    expect(bucketMonthsFilled(rupeesToPaise(20_000), 0)).toBeNull();
  });
});
