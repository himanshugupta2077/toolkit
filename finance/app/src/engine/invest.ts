import { isIsoDate, type IsoDate } from "./dates.ts";
import { isPaise, rupeesToPaise, ZERO_PAISE, type Paise } from "./money.ts";
import {
  BP_SCALE,
  isInvestAssetKind,
  type InvestAsset,
  type InvestAssetKind,
  type InvestPlan,
  type InvestThemeTier,
} from "./types.ts";

export const DEFAULT_INVEST_PLAN_ID = "invest_plan_v1";
export const DEFAULT_INVEST_EFFECTIVE_FROM: IsoDate = "2026-09-01";
/** Locked v1: 70% SIP / 30% dip reserve. */
export const DEFAULT_SIP_BP = 7_000;
export const DEFAULT_DIP_RESERVE_BP = 3_000;
/** Locked v1: below this, only AI Infrastructure among themes. */
export const DEFAULT_THEME_THRESHOLD: Paise = rupeesToPaise(20_000);

export const DEFAULT_ASSET_IDS = {
  nasdaq100: "nasdaq_100",
  indiaFlexicap: "india_flexicap",
  nifty50: "nifty_50",
  niftyNext50: "nifty_next_50",
  aiInfrastructure: "ai_infrastructure",
  automationRobotics: "automation_robotics",
  electricityGrid: "electricity_grid",
  defenseCyber: "defense_cyber",
  gold: "gold",
} as const;

export const GOLD_ASSET_NAME = "Gold";

export type InvestIssue = {
  field: string;
  code: string;
  message: string;
};

export type InvestValidationResult = {
  ok: boolean;
  issues: InvestIssue[];
};

export type SipOrder = {
  assetId: string;
  name: string;
  kind: InvestAssetKind;
  /** True when this asset receives a SIP share this run. */
  activeForSplit: boolean;
  targetBp: number;
  /** Normalised share of the SIP pool (0 if excluded). */
  weightBp: number;
  amount: Paise;
  dipPriority: number | null;
};

export type InvestSplit = {
  amount: Paise;
  sipPool: Paise;
  dipCredit: Paise;
  themeTier: InvestThemeTier | null;
  orders: readonly SipOrder[];
  leftover: Paise;
};

function requirePaise(value: Paise, label: string): Paise {
  if (!isPaise(value)) {
    throw new Error(`${label} must be integer paise`);
  }
  return value;
}

function issue(field: string, code: string, message: string): InvestIssue {
  return { field, code, message };
}

function isGoldName(name: string): boolean {
  return name.trim().toLowerCase() === GOLD_ASSET_NAME.toLowerCase();
}

function asset(
  id: string,
  name: string,
  kind: InvestAssetKind,
  targetBp: number,
  dipPriority: number | null,
  instrumentNote: string = "",
): InvestAsset {
  return {
    id,
    name,
    kind,
    targetBp,
    dipPriority,
    instrumentNote,
    active: true,
  };
}

/**
 * Default plan: 70/30, Gold omitted, theme engine below ₹20,000 → AI
 * Infrastructure only. Weights are the sheet's targets without Gold (sum 90%).
 */
export function seedDefaultInvestPlan(): InvestPlan {
  const ids = DEFAULT_ASSET_IDS;
  const assets: InvestAsset[] = [
    asset(ids.nasdaq100, "NASDAQ-100", "core", 2_500, 2, "Motilal Oswal Nasdaq 100 FoF"),
    asset(ids.indiaFlexicap, "India Flexicap", "core", 1_500, 4),
    asset(ids.nifty50, "Nifty 50", "core", 750, 5),
    asset(ids.niftyNext50, "Nifty Next 50", "core", 750, 3),
    asset(ids.aiInfrastructure, "AI Infrastructure", "theme", 1_500, 1),
    asset(ids.automationRobotics, "Automation & Robotics", "theme", 900, 6),
    asset(ids.electricityGrid, "Electricity & Grid", "theme", 600, 7),
    asset(ids.defenseCyber, "Defense & Cyber", "theme", 500, 8),
  ];
  const themeIds = assets.filter((row) => row.kind === "theme").map((row) => row.id);
  return {
    id: DEFAULT_INVEST_PLAN_ID,
    effectiveFrom: DEFAULT_INVEST_EFFECTIVE_FROM,
    sipBp: DEFAULT_SIP_BP,
    dipReserveBp: DEFAULT_DIP_RESERVE_BP,
    notes: "",
    assets,
    themeTiers: [
      {
        id: "below_threshold",
        belowAmount: DEFAULT_THEME_THRESHOLD,
        allowedAssetIds: [ids.aiInfrastructure],
      },
      {
        id: "at_or_above_threshold",
        belowAmount: null,
        allowedAssetIds: themeIds,
      },
    ],
  };
}

/** If a Gold row is present, mark it inactive so split re-normalises the rest. */
export function inactivateGold(plan: InvestPlan): InvestPlan {
  return {
    ...plan,
    assets: plan.assets.map((row) =>
      isGoldName(row.name) ? { ...row, active: false } : row,
    ),
  };
}

export function validateInvestPlan(plan: InvestPlan): InvestValidationResult {
  const issues: InvestIssue[] = [];

  if (!plan.id.trim()) {
    issues.push(issue("id", "empty_id", "Invest plan id is required."));
  }
  if (!isIsoDate(plan.effectiveFrom)) {
    issues.push(
      issue(
        "effectiveFrom",
        "invalid_effective_from",
        `Invalid effective_from date: ${plan.effectiveFrom}.`,
      ),
    );
  }

  if (!Number.isInteger(plan.sipBp) || plan.sipBp < 0 || plan.sipBp > BP_SCALE) {
    issues.push(
      issue("sipBp", "invalid_sip_bp", "SIP % must be an integer 0–10000 bp."),
    );
  }
  if (
    !Number.isInteger(plan.dipReserveBp) ||
    plan.dipReserveBp < 0 ||
    plan.dipReserveBp > BP_SCALE
  ) {
    issues.push(
      issue(
        "dipReserveBp",
        "invalid_dip_bp",
        "Dip reserve % must be an integer 0–10000 bp.",
      ),
    );
  }
  if (
    Number.isInteger(plan.sipBp) &&
    Number.isInteger(plan.dipReserveBp) &&
    plan.sipBp + plan.dipReserveBp !== BP_SCALE
  ) {
    issues.push(
      issue(
        "sipBp",
        "sip_dip_sum",
        `SIP + dip reserve is ${plan.sipBp + plan.dipReserveBp} bp; they must sum to ${BP_SCALE}.`,
      ),
    );
  }

  const seen = new Set<string>();
  const assetIds = new Set<string>();
  for (const row of plan.assets) {
    const prefix = row.id || row.name || "asset";
    if (!row.id.trim()) {
      issues.push(issue("assets", "empty_asset_id", "Asset id is required."));
    } else if (seen.has(row.id)) {
      issues.push(
        issue("assets", "duplicate_asset_id", `Duplicate asset id: ${row.id}.`),
      );
    } else {
      seen.add(row.id);
      assetIds.add(row.id);
    }

    if (!isInvestAssetKind(row.kind)) {
      issues.push(
        issue("assets", "invalid_kind", `${prefix}: kind must be core or theme.`),
      );
    }
    if (!Number.isInteger(row.targetBp) || row.targetBp < 0) {
      issues.push(
        issue(
          "assets",
          "invalid_target_bp",
          `${prefix}: target must be a non-negative integer bp.`,
        ),
      );
    }
    if (
      row.dipPriority != null &&
      (!Number.isInteger(row.dipPriority) || row.dipPriority < 1)
    ) {
      issues.push(
        issue(
          "assets",
          "invalid_dip_priority",
          `${prefix}: dip priority must be an integer ≥ 1.`,
        ),
      );
    }
  }

  let unbounded = 0;
  const tierIds = new Set<string>();
  for (const tier of plan.themeTiers) {
    const prefix = tier.id || "tier";
    if (!tier.id.trim()) {
      issues.push(issue("themeTiers", "empty_tier_id", "Theme tier id is required."));
    } else if (tierIds.has(tier.id)) {
      issues.push(
        issue("themeTiers", "duplicate_tier_id", `Duplicate theme tier id: ${tier.id}.`),
      );
    } else {
      tierIds.add(tier.id);
    }

    if (tier.belowAmount == null) {
      unbounded += 1;
    } else if (!isPaise(tier.belowAmount) || tier.belowAmount < 0) {
      issues.push(
        issue(
          "themeTiers",
          "invalid_below_amount",
          `${prefix}: below-amount must be non-negative paise.`,
        ),
      );
    }

    for (const assetId of tier.allowedAssetIds) {
      if (!assetIds.has(assetId)) {
        issues.push(
          issue(
            "themeTiers",
            "unknown_allowed_asset",
            `${prefix}: allowed asset ${assetId} is not on the plan.`,
          ),
        );
      }
    }
  }
  if (unbounded > 1) {
    issues.push(
      issue(
        "themeTiers",
        "unbounded_count",
        "At most one theme tier may be unbounded (below-amount null).",
      ),
    );
  }

  return { ok: issues.length === 0, issues };
}

/**
 * First matching tier after sorting by below-amount ascending (unbounded last).
 * `amount < belowAmount` matches; ₹20,000 on a ₹20,000 threshold uses the top tier.
 */
export function resolveThemeTier(
  amount: Paise,
  tiers: readonly InvestThemeTier[],
): InvestThemeTier | null {
  requirePaise(amount, "amount");
  const ordered = tiers.slice().sort((a, b) => {
    const aKey = a.belowAmount == null ? Number.POSITIVE_INFINITY : a.belowAmount;
    const bKey = b.belowAmount == null ? Number.POSITIVE_INFINITY : b.belowAmount;
    return aKey - bKey || a.id.localeCompare(b.id);
  });
  for (const tier of ordered) {
    if (tier.belowAmount == null || amount < tier.belowAmount) return tier;
  }
  return null;
}

function isActiveForSplit(
  row: InvestAsset,
  allowedThemeIds: ReadonlySet<string>,
): boolean {
  if (!row.active) return false;
  if (row.kind === "core") return true;
  return allowedThemeIds.has(row.id);
}

function weightThenDipThenId(a: SipOrder, b: SipOrder): number {
  if (b.targetBp !== a.targetBp) return b.targetBp - a.targetBp;
  const aDip = a.dipPriority ?? Number.POSITIVE_INFINITY;
  const bDip = b.dipPriority ?? Number.POSITIVE_INFINITY;
  if (aDip !== bDip) return aDip - bDip;
  return a.assetId.localeCompare(b.assetId);
}

function allocateSip(
  sipPool: Paise,
  orders: SipOrder[],
): { orders: SipOrder[]; leftover: Paise } {
  const active = orders.filter((row) => row.activeForSplit);
  const totalBp = active.reduce((sum, row) => sum + row.targetBp, 0);
  if (sipPool <= 0 || totalBp <= 0) {
    return { orders, leftover: sipPool };
  }

  let allocated: Paise = ZERO_PAISE;
  for (const row of orders) {
    if (!row.activeForSplit) continue;
    row.weightBp = Math.round((row.targetBp * BP_SCALE) / totalBp);
    row.amount = Math.round((sipPool * row.targetBp) / (totalBp * 100)) * 100;
    allocated += row.amount;
  }

  const leftover: Paise = sipPool - allocated;
  const largest = orders
    .filter((row) => row.activeForSplit)
    .slice()
    .sort(weightThenDipThenId)[0];
  if (largest) {
    largest.amount += leftover;
    return { orders, leftover: ZERO_PAISE };
  }
  return { orders, leftover };
}

/**
 * Split a monthly invest amount into SIP pool + dip credit, then SIP rupees
 * across core ∪ allowed themes. Inactive Gold (and any other inactive row)
 * is excluded; remaining weights re-normalise. Rupee remainder → largest weight.
 */
export function splitInvest(amount: Paise, plan: InvestPlan): InvestSplit {
  const original = requirePaise(amount, "amount");
  const checked = validateInvestPlan(plan);
  if (!checked.ok) {
    throw new Error(
      `invalid invest plan: ${checked.issues.map((row) => row.code).join(", ")}`,
    );
  }

  const zeroRun = original <= 0;
  const sipPool: Paise = zeroRun
    ? ZERO_PAISE
    : Math.round((original * plan.sipBp) / BP_SCALE);
  const dipCredit: Paise = zeroRun ? ZERO_PAISE : original - sipPool;
  const themeTier = resolveThemeTier(zeroRun ? ZERO_PAISE : original, plan.themeTiers);
  const allowedThemeIds = new Set(themeTier?.allowedAssetIds ?? []);

  const draft: SipOrder[] = plan.assets.map((row) => ({
    assetId: row.id,
    name: row.name,
    kind: row.kind,
    activeForSplit: zeroRun ? false : isActiveForSplit(row, allowedThemeIds),
    targetBp: row.targetBp,
    weightBp: 0,
    amount: ZERO_PAISE,
    dipPriority: row.dipPriority,
  }));

  if (zeroRun) {
    return {
      amount: original,
      sipPool,
      dipCredit,
      themeTier,
      orders: draft,
      leftover: original,
    };
  }

  const { orders, leftover } = allocateSip(sipPool, draft);
  return { amount: original, sipPool, dipCredit, themeTier, orders, leftover };
}

/** Display helper: 2500 bp → `25%`, 750 bp → `7.5%`. */
export function formatBpPct(bp: number): string {
  const pct = bp / 100;
  const text = Number.isInteger(pct) ? String(pct) : String(pct);
  return `${text}%`;
}

export function pctToBp(pct: number): number {
  return Math.round(pct * 100);
}

export function bpToPct(bp: number): number {
  return bp / 100;
}

/**
 * Re-normalise active rows so their target_bp sums to 10_000. Inactive rows
 * keep their stored weight (Gold off stays 10% on the row, 0% of the split).
 */
export function normaliseActiveTargets(
  assets: readonly InvestAsset[],
): InvestAsset[] {
  const active = assets.filter((row) => row.active);
  const totalBp = active.reduce((sum, row) => sum + row.targetBp, 0);
  if (totalBp <= 0) return assets.map((row) => ({ ...row }));

  const next = new Map<string, number>();
  let used = 0;
  for (const row of active) {
    const bp = Math.round((row.targetBp * BP_SCALE) / totalBp);
    next.set(row.id, bp);
    used += bp;
  }
  const leftover = BP_SCALE - used;
  const largest = active.slice().sort((a, b) => {
    if (b.targetBp !== a.targetBp) return b.targetBp - a.targetBp;
    const aDip = a.dipPriority ?? Number.POSITIVE_INFINITY;
    const bDip = b.dipPriority ?? Number.POSITIVE_INFINITY;
    if (aDip !== bDip) return aDip - bDip;
    return a.id.localeCompare(b.id);
  })[0];
  if (largest) next.set(largest.id, (next.get(largest.id) ?? 0) + leftover);

  return assets.map((row) =>
    row.active ? { ...row, targetBp: next.get(row.id) ?? row.targetBp } : { ...row },
  );
}

export function activeTargetSumBp(assets: readonly InvestAsset[]): number {
  return assets.filter((row) => row.active).reduce((sum, row) => sum + row.targetBp, 0);
}

export type DipOrder = {
  assetId: string;
  name: string;
  kind: InvestAssetKind;
  dipPriority: number;
  targetBp: number;
  amount: Paise;
};

export type DipDeploySuggestion = {
  amount: Paise;
  orders: readonly DipOrder[];
  leftover: Paise;
};

function dipEligible(plan: InvestPlan): InvestAsset[] {
  return plan.assets
    .filter((row) => row.active && row.dipPriority != null)
    .slice()
    .sort((a, b) => {
      const aDip = a.dipPriority ?? Number.POSITIVE_INFINITY;
      const bDip = b.dipPriority ?? Number.POSITIVE_INFINITY;
      if (aDip !== bDip) return aDip - bDip;
      if (b.targetBp !== a.targetBp) return b.targetBp - a.targetBp;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Suggested dip-buy split: active assets that have a dip priority, weighted
 * by target_bp (theme filter is SIP-only). Remainder → highest priority.
 */
export function suggestDipDeploy(amount: Paise, plan: InvestPlan): DipDeploySuggestion {
  const original = requirePaise(amount, "amount");
  const checked = validateInvestPlan(plan);
  if (!checked.ok) {
    throw new Error(
      `invalid invest plan: ${checked.issues.map((row) => row.code).join(", ")}`,
    );
  }

  const eligible = dipEligible(plan);
  if (original <= 0 || eligible.length === 0) {
    return {
      amount: original,
      leftover: original > 0 ? original : ZERO_PAISE,
      orders: eligible.map((row) => ({
        assetId: row.id,
        name: row.name,
        kind: row.kind,
        dipPriority: row.dipPriority ?? 0,
        targetBp: row.targetBp,
        amount: ZERO_PAISE,
      })),
    };
  }

  const totalBp = eligible.reduce((sum, row) => sum + row.targetBp, 0);
  const orders: DipOrder[] = eligible.map((row) => ({
    assetId: row.id,
    name: row.name,
    kind: row.kind,
    dipPriority: row.dipPriority ?? 0,
    targetBp: row.targetBp,
    amount: ZERO_PAISE,
  }));

  if (totalBp <= 0) {
    const n = orders.length;
    let allocated: Paise = ZERO_PAISE;
    for (const row of orders) {
      row.amount = Math.round(original / (n * 100)) * 100;
      allocated += row.amount;
    }
    orders[0]!.amount += original - allocated;
    return { amount: original, orders, leftover: ZERO_PAISE };
  }

  let allocated: Paise = ZERO_PAISE;
  for (const row of orders) {
    row.amount = Math.round((original * row.targetBp) / (totalBp * 100)) * 100;
    allocated += row.amount;
  }
  orders[0]!.amount += original - allocated;
  return { amount: original, orders, leftover: ZERO_PAISE };
}
