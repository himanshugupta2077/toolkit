import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSET_IDS as IDS,
  DEFAULT_DIP_RESERVE_BP,
  DEFAULT_SIP_BP,
  DEFAULT_THEME_THRESHOLD,
  activeTargetSumBp,
  inactivateGold,
  normaliseActiveTargets,
  resolveThemeTier,
  seedDefaultInvestPlan,
  splitInvest,
  suggestDipDeploy,
  validateInvestPlan,
} from "./invest.ts";
import { rupeesToPaise } from "./money.ts";
import type { InvestAsset, InvestPlan } from "./types.ts";

const AMOUNT_1150 = rupeesToPaise(1_150);
const DIP_345 = rupeesToPaise(345);
const SIP_805 = rupeesToPaise(805);

function ordersById(result: ReturnType<typeof splitInvest>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of result.orders) out[row.assetId] = row.amount;
  return out;
}

function goldAsset(active: boolean): InvestAsset {
  return {
    id: IDS.gold,
    name: "Gold",
    kind: "core",
    targetBp: 1_000,
    dipPriority: 5,
    instrumentNote: "",
    active,
  };
}

function withGold(plan: InvestPlan, active: boolean): InvestPlan {
  return { ...plan, assets: [...plan.assets, goldAsset(active)] };
}

describe("seedDefaultInvestPlan", () => {
  it("seeds 70/30, no Gold, and the ₹20k theme threshold", () => {
    const plan = seedDefaultInvestPlan();
    expect(plan.sipBp).toBe(DEFAULT_SIP_BP);
    expect(plan.dipReserveBp).toBe(DEFAULT_DIP_RESERVE_BP);
    expect(plan.sipBp + plan.dipReserveBp).toBe(10_000);
    expect(plan.assets.some((row) => row.name === "Gold")).toBe(false);
    expect(plan.assets.every((row) => row.active)).toBe(true);

    const below = plan.themeTiers.find((tier) => tier.belowAmount != null);
    expect(below?.belowAmount).toBe(DEFAULT_THEME_THRESHOLD);
    expect(below?.allowedAssetIds).toEqual([IDS.aiInfrastructure]);

    expect(validateInvestPlan(plan).ok).toBe(true);
  });
});

describe("splitInvest — plan approval examples", () => {
  it("₹1,150 at 70/30 with gold off and below threshold: dip ₹345; SIP is core + AI only", () => {
    const result = splitInvest(AMOUNT_1150, seedDefaultInvestPlan());
    const amounts = ordersById(result);

    expect(result.dipCredit).toBe(DIP_345);
    expect(result.sipPool).toBe(SIP_805);
    expect(result.sipPool + result.dipCredit).toBe(AMOUNT_1150);
    expect(result.leftover).toBe(0);

    expect(amounts[IDS.aiInfrastructure]).toBeGreaterThan(0);
    expect(amounts[IDS.nasdaq100]).toBeGreaterThan(0);
    expect(amounts[IDS.indiaFlexicap]).toBeGreaterThan(0);
    expect(amounts[IDS.nifty50]).toBeGreaterThan(0);
    expect(amounts[IDS.niftyNext50]).toBeGreaterThan(0);

    expect(amounts[IDS.automationRobotics]).toBe(0);
    expect(amounts[IDS.electricityGrid]).toBe(0);
    expect(amounts[IDS.defenseCyber]).toBe(0);

    // 25+15+7.5+7.5+15 = 70. Rupee-round then remainder → NASDAQ (largest).
    expect(amounts[IDS.nasdaq100]).toBe(rupeesToPaise(287));
    expect(amounts[IDS.indiaFlexicap]).toBe(rupeesToPaise(173));
    expect(amounts[IDS.nifty50]).toBe(rupeesToPaise(86));
    expect(amounts[IDS.niftyNext50]).toBe(rupeesToPaise(86));
    expect(amounts[IDS.aiInfrastructure]).toBe(rupeesToPaise(173));
    expect(
      amounts[IDS.nasdaq100] +
        amounts[IDS.indiaFlexicap] +
        amounts[IDS.nifty50] +
        amounts[IDS.niftyNext50] +
        amounts[IDS.aiInfrastructure],
    ).toBe(SIP_805);
  });

  it("keeps other themes at ₹0 when Gold is present but inactive", () => {
    const plan = inactivateGold(withGold(seedDefaultInvestPlan(), true));
    const gold = plan.assets.find((row) => row.id === IDS.gold);
    expect(gold?.active).toBe(false);

    const result = splitInvest(AMOUNT_1150, plan);
    const amounts = ordersById(result);
    expect(result.dipCredit).toBe(DIP_345);
    expect(amounts[IDS.gold]).toBe(0);
    expect(amounts[IDS.automationRobotics]).toBe(0);
    expect(amounts[IDS.nasdaq100]).toBe(rupeesToPaise(287));
  });
});

describe("theme engine", () => {
  it("uses the below-threshold tier for ₹10,000 and the top tier at ₹20,000", () => {
    const plan = seedDefaultInvestPlan();
    const below = resolveThemeTier(rupeesToPaise(10_000), plan.themeTiers);
    expect(below?.id).toBe("below_threshold");
    expect(below?.allowedAssetIds).toEqual([IDS.aiInfrastructure]);

    const atThreshold = resolveThemeTier(DEFAULT_THEME_THRESHOLD, plan.themeTiers);
    expect(atThreshold?.id).toBe("at_or_above_threshold");
  });

  it("₹10,000 leaves Automation & Robotics at ₹0; ₹25,000 turns themes on", () => {
    const plan = seedDefaultInvestPlan();
    const ten = ordersById(splitInvest(rupeesToPaise(10_000), plan));
    expect(ten[IDS.automationRobotics]).toBe(0);
    expect(ten[IDS.aiInfrastructure]).toBeGreaterThan(0);

    const twentyFive = ordersById(splitInvest(rupeesToPaise(25_000), plan));
    expect(twentyFive[IDS.automationRobotics]).toBeGreaterThan(0);
    expect(twentyFive[IDS.electricityGrid]).toBeGreaterThan(0);
    expect(twentyFive[IDS.defenseCyber]).toBeGreaterThan(0);
  });
});

describe("splitInvest — guardrails", () => {
  it("returns zeros and does not throw when the amount is 0 or negative", () => {
    const plan = seedDefaultInvestPlan();
    const zero = splitInvest(0, plan);
    expect(zero.sipPool).toBe(0);
    expect(zero.dipCredit).toBe(0);
    expect(zero.orders.every((row) => row.amount === 0)).toBe(true);
    expect(zero.leftover).toBe(0);

    const negative = rupeesToPaise(-1_150);
    const down = splitInvest(negative, plan);
    expect(down.sipPool).toBe(0);
    expect(down.dipCredit).toBe(0);
    expect(down.leftover).toBe(negative);
  });

  it("rejects SIP + dip that do not sum to 100%", () => {
    const plan = { ...seedDefaultInvestPlan(), sipBp: 8_000, dipReserveBp: 3_000 };
    expect(validateInvestPlan(plan).ok).toBe(false);
    expect(validateInvestPlan(plan).issues.some((row) => row.code === "sip_dip_sum")).toBe(
      true,
    );
    expect(() => splitInvest(AMOUNT_1150, plan)).toThrow(/sip_dip_sum/);
  });
});

describe("normaliseActiveTargets", () => {
  it("turning Gold off re-normalises active % to 100 and SIP rupees exclude Gold", () => {
    const withActiveGold = withGold(seedDefaultInvestPlan(), true);
    expect(activeTargetSumBp(withActiveGold.assets)).toBe(10_000);

    const off = inactivateGold(withActiveGold);
    const normalised = {
      ...off,
      assets: normaliseActiveTargets(off.assets),
    };
    expect(activeTargetSumBp(normalised.assets)).toBe(10_000);
    const gold = normalised.assets.find((row) => row.id === IDS.gold);
    expect(gold?.active).toBe(false);
    expect(gold?.targetBp).toBe(1_000);

    const result = splitInvest(AMOUNT_1150, normalised);
    const amounts = ordersById(result);
    expect(amounts[IDS.gold]).toBe(0);
    expect(result.sipPool).toBe(SIP_805);
    expect(
      amounts[IDS.nasdaq100] +
        amounts[IDS.indiaFlexicap] +
        amounts[IDS.nifty50] +
        amounts[IDS.niftyNext50] +
        amounts[IDS.aiInfrastructure],
    ).toBe(SIP_805);
  });
});

describe("suggestDipDeploy", () => {
  it("splits by target weight among dip-ranked assets; remainder → priority 1", () => {
    const plan = seedDefaultInvestPlan();
    const amount = rupeesToPaise(1_000);
    const result = suggestDipDeploy(amount, plan);
    expect(result.leftover).toBe(0);
    expect(result.orders.reduce((sum, row) => sum + row.amount, 0)).toBe(amount);
    expect(result.orders[0]?.assetId).toBe(IDS.aiInfrastructure);
    expect(result.orders.some((row) => row.assetId === IDS.automationRobotics)).toBe(true);
    expect(result.orders.every((row) => row.amount >= 0)).toBe(true);
  });

  it("returns leftover when the amount is positive but nothing is dip-eligible", () => {
    const plan = seedDefaultInvestPlan();
    const none = {
      ...plan,
      assets: plan.assets.map((row) => ({ ...row, dipPriority: null })),
    };
    const result = suggestDipDeploy(rupeesToPaise(500), none);
    expect(result.orders).toEqual([]);
    expect(result.leftover).toBe(rupeesToPaise(500));
  });
});
