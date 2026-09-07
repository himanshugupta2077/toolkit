import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSET_IDS as IDS,
  GOLD_ASSET_NAME,
  inactivateGold,
  rupeesToPaise,
  seedDefaultInvestPlan,
  type InvestAsset,
  type InvestPlan,
} from "../engine/index.ts";
import {
  activeThemeTierId,
  automationSip,
  sipForDraft,
  sipPct,
  themeTierCaption,
  toggleAssetActive,
  turnGoldOff,
  weightSumLabel,
} from "./invest.ts";

function goldAsset(active: boolean): InvestAsset {
  return {
    id: IDS.gold,
    name: GOLD_ASSET_NAME,
    kind: "core",
    targetBp: 1_000,
    dipPriority: 9,
    instrumentNote: "",
    active,
  };
}

function withGold(plan: InvestPlan, active: boolean): InvestPlan {
  return { ...plan, assets: [...plan.assets, goldAsset(active)] };
}

describe("invest editor helpers", () => {
  it("turning Gold off re-normalises % to 100 and SIP rupees exclude Gold", () => {
    const plan = withGold(seedDefaultInvestPlan(), true);
    expect(sipPct(plan)).toBe(70);
    const off = turnGoldOff(plan);
    expect(weightSumLabel(off.assets)).toBe("sum = 100% ✓");
    const gold = off.assets.find((row) => row.id === IDS.gold);
    expect(gold?.active).toBe(false);

    const split = sipForDraft(off, rupeesToPaise(1_150));
    expect(split?.orders.find((row) => row.assetId === IDS.gold)?.amount).toBe(0);
    expect(split?.sipPool).toBe(rupeesToPaise(805));
  });

  it("toggle off also re-normalises the remaining active weights", () => {
    const plan = withGold(seedDefaultInvestPlan(), true);
    const gold = plan.assets.find((row) => row.id === IDS.gold);
    expect(gold).toBeTruthy();
    const next = toggleAssetActive(plan, gold!.id);
    expect(weightSumLabel(next.assets)).toBe("sum = 100% ✓");
    expect(inactivateGold(next).assets.find((row) => row.id === IDS.gold)?.active).toBe(false);
  });

  it("₹10,000 leaves Automation SIP at ₹0; ₹25,000 turns themes on", () => {
    const plan = seedDefaultInvestPlan();
    expect(automationSip(sipForDraft(plan, rupeesToPaise(10_000)))).toBe(0);
    expect(automationSip(sipForDraft(plan, rupeesToPaise(25_000)))).toBeGreaterThan(0);
    expect(activeThemeTierId(plan, rupeesToPaise(10_000))).toBe("below_threshold");
    expect(activeThemeTierId(plan, rupeesToPaise(25_000))).toBe("at_or_above_threshold");
  });

  it("labels the default theme tiers", () => {
    const plan = seedDefaultInvestPlan();
    const below = plan.themeTiers[0]!;
    const above = plan.themeTiers[1]!;
    expect(themeTierCaption(below, plan.assets, plan.themeTiers)).toMatch(/Below/);
    expect(themeTierCaption(above, plan.assets, plan.themeTiers)).toMatch(/\+/);
  });
});
