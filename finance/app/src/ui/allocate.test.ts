import { describe, expect, it } from "vitest";
import { DEFAULT_BUCKET_IDS, rupeesToPaise, type WaterfallLine } from "../engine/index.ts";
import {
  afterCaption,
  COMMITTED_BEYOND_LIQUID,
  confirmBlockedReason,
  historyLineCaption,
  historyTitle,
  picksFromSuggested,
  toConfirmLines,
} from "./allocate.ts";

const EF = DEFAULT_BUCKET_IDS.emergencyFund;

function line(partial: Partial<WaterfallLine> & Pick<WaterfallLine, "bucketId" | "name">): WaterfallLine {
  return {
    priority: 1,
    fillMode: "until_target",
    current: 0,
    target: rupeesToPaise(12_400),
    room: rupeesToPaise(12_400),
    want: rupeesToPaise(12_400),
    amount: rupeesToPaise(12_400),
    ...partial,
  };
}

describe("allocate copy", () => {
  it("captions the after-fill line", () => {
    expect(
      afterCaption(
        line({
          bucketId: EF,
          name: "Emergency Fund",
          current: 0,
          amount: rupeesToPaise(12_400),
          target: rupeesToPaise(12_400),
        }),
      ),
    ).toBe("+₹12,400.00 → ₹12,400.00 / ₹12,400.00 · full");
  });

  it("blocks confirm when free is negative or surplus is edited without a reason", () => {
    const rows = [line({ bucketId: EF, name: "Emergency Fund" })];
    expect(
      confirmBlockedReason({
        canAllocate: false,
        free: rupeesToPaise(-100),
        surplus: rupeesToPaise(-100),
        reason: "",
        lines: rows,
        picks: { [EF]: { fromAccountId: "a", toAccountId: "b" } },
      }),
    ).toBe(COMMITTED_BEYOND_LIQUID);

    expect(
      confirmBlockedReason({
        canAllocate: true,
        free: rupeesToPaise(12_400),
        surplus: rupeesToPaise(10_000),
        reason: "",
        lines: rows,
        picks: { [EF]: { fromAccountId: "a", toAccountId: "b" } },
      }),
    ).toBe("Changing the surplus needs a reason.");
  });

  it("builds confirm lines from picks", () => {
    const rows = [line({ bucketId: EF, name: "Emergency Fund" })];
    const picks = picksFromSuggested(rows, [
      { bucketId: EF, fromAccountId: "acc_hdfc", toAccountId: "acc_fd", type: "investment" },
    ]);
    expect(toConfirmLines(rows, picks)).toEqual([
      {
        bucketId: EF,
        amount: rupeesToPaise(12_400),
        fromAccountId: "acc_hdfc",
        toAccountId: "acc_fd",
      },
    ]);
  });

  it("summarises history", () => {
    expect(
      historyTitle({
        id: "r1",
        month: "2026-09",
        surplusInput: rupeesToPaise(12_400),
        overrideReason: null,
        status: "confirmed",
        createdAt: "",
        confirmedAt: "",
        lines: [],
      }),
    ).toBe("2026-09 · confirmed · ₹12,400.00");
    expect(
      historyLineCaption({
        id: "r1",
        month: "2026-09",
        surplusInput: rupeesToPaise(12_400),
        overrideReason: null,
        status: "confirmed",
        createdAt: "",
        confirmedAt: "",
        lines: [
          {
            id: "l1",
            bucketId: EF,
            name: "Emergency Fund",
            proposedAmount: rupeesToPaise(12_400),
            confirmedAmount: rupeesToPaise(12_400),
            ledgerEntryId: "e1",
            fromAccountId: "a",
            toAccountId: "b",
            type: "investment",
          },
        ],
      }),
    ).toBe("EF ₹12,400.00");
  });
});
