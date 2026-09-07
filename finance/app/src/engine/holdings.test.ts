import { describe, expect, it } from "vitest";
import { computeBalances, type BalanceEntry } from "./balances.ts";
import {
  allocationDrift,
  applyHoldingsNav,
  avgCostPaise,
  fdMaturityCaption,
  filterHistory,
  formatUnits,
  matchPlanAssetId,
  summarizeHolding,
  unitsFromAmount,
  valueFromUnits,
} from "./holdings.ts";
import { rupeesToPaise } from "./money.ts";
import { BP_SCALE, UNIT_SCALE, type Account, type InvestAsset } from "./types.ts";

const OPENING = "2026-08-01";

function asset(
  id: string,
  name: string,
  group: Account["group"],
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
    includeLiquid: group === "savings" || group === "cash",
    group,
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
    ...extra,
  };
}

function planAsset(
  id: string,
  name: string,
  targetBp: number,
  active = true,
): Pick<InvestAsset, "id" | "name" | "targetBp" | "active"> {
  return { id, name, targetBp, active };
}

describe("holding units and NAV", () => {
  it("buys units from amount / NAV and values them back", () => {
    const amount = rupeesToPaise(1_000);
    const nav = rupeesToPaise(150.25);
    const units = unitsFromAmount(amount, nav);
    expect(units).toBe(Math.round((amount * UNIT_SCALE) / nav));
    expect(valueFromUnits(units, nav)).toBe(amount);
  });

  it("average cost is paise per unit", () => {
    const units = 2 * UNIT_SCALE;
    const cost = rupeesToPaise(300);
    expect(avgCostPaise(cost, units)).toBe(rupeesToPaise(150));
  });

  it("uses NAV for value and gain when set; otherwise cost", () => {
    const nav = rupeesToPaise(20);
    const buyAmount = rupeesToPaise(1_000);
    const units = unitsFromAmount(buyAmount, nav);
    const noNav = summarizeHolding(
      [{ kind: "buy_sip", units, amount: buyAmount, nav }],
      null,
    );
    expect(noNav.value).toBe(buyAmount);
    expect(noNav.gain).toBe(0);

    const laterNav = rupeesToPaise(22);
    const marked = summarizeHolding(
      [{ kind: "buy_sip", units, amount: buyAmount, nav }],
      laterNav,
    );
    expect(marked.value).toBe(valueFromUnits(units, laterNav));
    expect(marked.gain).toBe(marked.value - buyAmount);
    expect(marked.gain).toBeGreaterThan(0);
  });

  it("sells at average cost", () => {
    const nav = rupeesToPaise(10);
    const buy = rupeesToPaise(1_000);
    const units = unitsFromAmount(buy, nav);
    const half = Math.round(units / 2);
    const summary = summarizeHolding(
      [
        { kind: "buy_sip", units, amount: buy, nav },
        { kind: "sell", units: half, amount: rupeesToPaise(600), nav: rupeesToPaise(12) },
      ],
      rupeesToPaise(12),
    );
    expect(summary.units).toBe(units - half);
    expect(summary.cost).toBe(rupeesToPaise(500));
  });

  it("ignores dividends for units and cost", () => {
    const nav = rupeesToPaise(10);
    const buy = rupeesToPaise(100);
    const units = unitsFromAmount(buy, nav);
    const summary = summarizeHolding(
      [
        { kind: "buy_dip", units, amount: buy, nav },
        { kind: "dividend", units: 0, amount: rupeesToPaise(5), nav },
      ],
      nav,
    );
    expect(summary.units).toBe(units);
    expect(summary.cost).toBe(buy);
  });
});

describe("applyHoldingsNav", () => {
  it("replaces ledger cost with current value on the investment account", () => {
    const savings = asset("sav", "HDFC Savings", "savings", {
      openingBalance: rupeesToPaise(10_000),
    });
    const mf = asset("mf", "Mutual Fund", "investment", {
      openingBalance: 0,
    });
    const entries: BalanceEntry[] = [
      {
        date: "2026-09-01",
        amount: rupeesToPaise(5_000),
        fromAccountId: savings.id,
        toAccountId: mf.id,
      },
    ];
    const snap = computeBalances([savings, mf], entries);
    expect(snap.assets).toBe(rupeesToPaise(10_000));
    expect(snap.netWorth).toBe(rupeesToPaise(10_000));

    const marked = applyHoldingsNav(snap, [savings, mf], [
      { accountId: mf.id, cost: rupeesToPaise(5_000), value: rupeesToPaise(5_500) },
    ]);
    expect(marked.positions.find((row) => row.accountId === mf.id)?.balance).toBe(
      rupeesToPaise(5_500),
    );
    expect(marked.assets).toBe(rupeesToPaise(10_500));
    expect(marked.netWorth).toBe(rupeesToPaise(10_500));
    expect(marked.liquid).toBe(rupeesToPaise(5_000));
  });

  it("leaves net worth unchanged when NAV is missing (value = cost)", () => {
    const mf = asset("mf", "Mutual Fund", "investment", {
      openingBalance: rupeesToPaise(2_000),
    });
    const snap = computeBalances([mf], []);
    const marked = applyHoldingsNav(snap, [mf], [
      { accountId: mf.id, cost: rupeesToPaise(2_000), value: rupeesToPaise(2_000) },
    ]);
    expect(marked.netWorth).toBe(snap.netWorth);
  });
});

describe("allocationDrift", () => {
  it("hints when a holding is more than 5pp off the plan weight", () => {
    const assets = [
      planAsset("a", "NASDAQ-100", 5_000),
      planAsset("b", "Flexicap", 5_000),
    ];
    const even = allocationDrift(assets, {
      a: rupeesToPaise(5_000),
      b: rupeesToPaise(5_000),
    });
    expect(even.map((row) => row.actualBp)).toEqual([5_000, 5_000]);
    expect(even.every((row) => row.hint === false)).toBe(true);

    const skewed = allocationDrift(assets, {
      a: rupeesToPaise(8_000),
      b: rupeesToPaise(2_000),
    });
    const nasdaq = skewed.find((row) => row.assetId === "a");
    const flex = skewed.find((row) => row.assetId === "b");
    expect(nasdaq?.actualBp).toBe(8_000);
    expect(nasdaq?.targetBp).toBe(5_000);
    expect(nasdaq?.driftPp).toBe(30);
    expect(nasdaq?.hint).toBe(true);
    expect(flex?.driftPp).toBe(-30);
    expect(flex?.hint).toBe(true);
  });

  it("matches holdings to a new plan version by name slug", () => {
    const plan = [planAsset("new_nasdaq", "NASDAQ-100", 10_000)];
    expect(matchPlanAssetId(plan, "old_nasdaq", "NASDAQ-100")).toBe("new_nasdaq");
    expect(matchPlanAssetId(plan, "new_nasdaq", "NASDAQ-100")).toBe("new_nasdaq");
  });

  it("normalises targets over the active set (Gold off)", () => {
    const assets = [
      planAsset("core", "Nifty 50", 9_000),
      planAsset("gold", "Gold", 1_000, false),
    ];
    const rows = allocationDrift(assets, { core: rupeesToPaise(1_000) });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetBp).toBe(BP_SCALE);
    expect(rows[0]?.actualBp).toBe(BP_SCALE);
  });
});

describe("history and FD captions", () => {
  it("filters 1M to the last 30 days", () => {
    const rows = [
      { date: "2026-07-01" as const, netWorth: 1 },
      { date: "2026-08-10" as const, netWorth: 2 },
      { date: "2026-09-01" as const, netWorth: 3 },
    ];
    expect(filterHistory(rows, "2026-09-06", "1M").map((row) => row.date)).toEqual([
      "2026-08-10",
      "2026-09-01",
    ]);
    expect(filterHistory(rows, "2026-09-06", "All")).toHaveLength(3);
  });

  it("captions FD maturity", () => {
    expect(fdMaturityCaption("2026-09-06", "2026-09-16")).toBe("matures in 10 days");
    expect(fdMaturityCaption("2026-09-06", "2026-09-07")).toBe("matures in 1 day");
    expect(fdMaturityCaption("2026-09-06", "2026-09-06")).toBe("matures today");
    expect(fdMaturityCaption("2026-09-06", "2026-09-05")).toBe("matured 1 day ago");
    expect(fdMaturityCaption("2026-09-06", null)).toBeNull();
  });

  it("formats micro-units without trailing zeros", () => {
    expect(formatUnits(UNIT_SCALE)).toBe("1");
    expect(formatUnits(1_500_000)).toBe("1.5");
    expect(formatUnits(6_655_574)).toBe("6.655574");
  });
});
