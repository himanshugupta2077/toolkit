import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "../engine/money.ts";
import {
  DEFAULT_BUCKET_IDS,
  seedDefaultBuckets,
  type WaterfallLine,
} from "../engine/index.ts";
import type { WealthBucketCard } from "../api/store.ts";
import {
  applyAccountToggle,
  bucketHeroCaption,
  exampleCaption,
  formatFillPct,
  monthsCaption,
  moveBucket,
  parseRupeesInput,
  ringPercent,
  rupeesInput,
  shortBucketName,
} from "./wealth.ts";

const EF = DEFAULT_BUCKET_IDS.emergencyFund;
const SAVINGS = DEFAULT_BUCKET_IDS.savingsBuffer;

function line(
  bucketId: string,
  name: string,
  amount: number,
): Pick<WaterfallLine, "bucketId" | "name" | "amount"> {
  return { bucketId, name, amount };
}

function card(partial: Partial<WealthBucketCard> & Pick<WealthBucketCard, "id" | "name">): WealthBucketCard {
  const [ef] = seedDefaultBuckets();
  return {
    ...ef,
    current: 0,
    target: rupeesToPaise(10_000),
    room: rupeesToPaise(10_000),
    fillPct: 0,
    monthsFilled: null,
    accounts: [],
    accountIds: [],
    ...partial,
  };
}

describe("wealth copy", () => {
  it("shortens the default three names", () => {
    expect(shortBucketName("Emergency Fund", EF)).toBe("EF");
    expect(shortBucketName("Savings buffer", SAVINGS)).toBe("Savings");
    expect(shortBucketName("Gold stash", "gold")).toBe("Gold stash");
  });

  it("formats fill % and months", () => {
    expect(formatFillPct(0.78)).toBe("78%");
    expect(formatFillPct(0.5)).toBe("50%");
    expect(formatFillPct(null)).toBeNull();
    expect(monthsCaption(20_000 / 4_255, 6)).toBe("≈ 4.7 of 6 months");
    expect(monthsCaption(6, 6)).toBe("≈ 6 of 6 months");
    expect(ringPercent(0.5)).toBe(50);
    expect(ringPercent(1.4)).toBe(100);
    expect(ringPercent(null)).toBe(0);
  });

  it("captions EF with months and Investment as invested cost", () => {
    expect(
      bucketHeroCaption({
        current: rupeesToPaise(20_000),
        target: rupeesToPaise(40_000),
        fillPct: 0.5,
        monthsFilled: 4.7,
        targetRule: "months_of_essentials",
        targetMonths: 6,
      }),
    ).toBe("₹20,000.00 / ₹40,000.00 (50%) · ≈ 4.7 of 6 months");
    expect(
      bucketHeroCaption({
        current: rupeesToPaise(50_000),
        target: null,
        fillPct: null,
        monthsFilled: null,
        targetRule: "none",
        targetMonths: null,
      }),
    ).toBe("₹50,000.00 invested cost");
  });

  it("writes the live example from today's surplus", () => {
    expect(
      exampleCaption(rupeesToPaise(20_000), [
        line(EF, "Emergency Fund", rupeesToPaise(12_400)),
        line(SAVINGS, "Savings buffer", rupeesToPaise(7_600)),
        line("investment", "Investment", 0),
      ]),
    ).toBe(
      "With ₹20,000.00 surplus today this plan gives EF ₹12,400.00, Savings ₹7,600.00, Investment ₹0.00.",
    );
  });
});

describe("bucket editor helpers", () => {
  it("parses rupee fields to paise", () => {
    expect(parseRupeesInput("30000")).toBe(rupeesToPaise(30_000));
    expect(parseRupeesInput("10,000")).toBeNull();
    expect(parseRupeesInput("")).toBeNull();
    expect(rupeesInput(rupeesToPaise(10_000))).toBe("10000");
  });

  it("reorders by swapping neighbors and reindexes priority", () => {
    const rows = [
      card({ id: "a", name: "A", priority: 1 }),
      card({ id: "b", name: "B", priority: 2 }),
      card({ id: "c", name: "C", priority: 3 }),
    ];
    const down = moveBucket(rows, "a", 1);
    expect(down.map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(down.map((row) => row.priority)).toEqual([1, 2, 3]);
    expect(moveBucket(rows, "a", -1).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("moves an account onto one bucket only", () => {
    const rows = [
      card({ id: EF, name: "EF", accountIds: ["acc_fd"] }),
      card({ id: SAVINGS, name: "Savings", accountIds: ["acc_icici"] }),
    ];
    const moved = applyAccountToggle(rows, SAVINGS, "acc_fd", true);
    expect(moved[0]?.accountIds).toEqual([]);
    expect(moved[1]?.accountIds).toEqual(["acc_icici", "acc_fd"]);
  });
});
