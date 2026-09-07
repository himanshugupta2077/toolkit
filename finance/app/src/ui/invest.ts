import {
  BP_SCALE,
  activeTargetSumBp,
  bpToPct,
  formatBpPct,
  formatInr,
  inactivateGold,
  normaliseActiveTargets,
  pctToBp,
  resolveThemeTier,
  splitInvest,
  suggestDipDeploy,
  type InvestAsset,
  type InvestPlan,
  type InvestSplit,
  type InvestThemeTier,
  type Paise,
} from "../engine/index.ts";

export function sipPct(plan: Pick<InvestPlan, "sipBp">): number {
  return Math.round(bpToPct(plan.sipBp));
}

export function setSipPct(plan: InvestPlan, pct: number): InvestPlan {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const sipBp = pctToBp(clamped);
  return { ...plan, sipBp, dipReserveBp: BP_SCALE - sipBp };
}

export function weightSumLabel(assets: readonly InvestAsset[]): string {
  const sum = activeTargetSumBp(assets);
  if (sum === BP_SCALE) return "sum = 100% ✓";
  return `sum = ${formatBpPct(sum)}`;
}

export function toggleAssetActive(plan: InvestPlan, id: string): InvestPlan {
  const assets = plan.assets.map((row) => {
    if (row.id !== id) return row;
    return { ...row, active: !row.active };
  });
  const turnedOff = plan.assets.find((row) => row.id === id)?.active === true;
  return {
    ...plan,
    assets: turnedOff ? normaliseActiveTargets(assets) : assets,
  };
}

export function turnGoldOff(plan: InvestPlan): InvestPlan {
  return {
    ...inactivateGold(plan),
    assets: normaliseActiveTargets(inactivateGold(plan).assets),
  };
}

export function draftAssetId(name: string): string {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `asset_${n || "unnamed"}`;
}

export function addAsset(plan: InvestPlan, asset: InvestAsset): InvestPlan {
  const used = new Set(plan.assets.map((row) => row.id));
  let id = asset.id.trim() || draftAssetId(asset.name);
  if (used.has(id)) id = `${id}_${plan.assets.length + 1}`;
  const next = { ...asset, id };
  const themeTiers =
    next.kind === "theme"
      ? plan.themeTiers.map((tier) =>
          tier.belowAmount == null
            ? { ...tier, allowedAssetIds: [...tier.allowedAssetIds, id] }
            : tier,
        )
      : plan.themeTiers;
  return { ...plan, assets: [...plan.assets, next], themeTiers };
}

export function removeAsset(plan: InvestPlan, id: string): InvestPlan {
  return {
    ...plan,
    assets: plan.assets.filter((row) => row.id !== id),
    themeTiers: plan.themeTiers.map((tier) => ({
      ...tier,
      allowedAssetIds: tier.allowedAssetIds.filter((assetId) => assetId !== id),
    })),
  };
}

export function replaceAsset(plan: InvestPlan, asset: InvestAsset): InvestPlan {
  return {
    ...plan,
    assets: plan.assets.map((row) => (row.id === asset.id ? asset : row)),
  };
}

export function moveDipPriority(plan: InvestPlan, id: string, dir: -1 | 1): InvestPlan {
  const ranked = plan.assets
    .filter((row) => row.dipPriority != null)
    .slice()
    .sort((a, b) => (a.dipPriority ?? 0) - (b.dipPriority ?? 0) || a.name.localeCompare(b.name));
  const index = ranked.findIndex((row) => row.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= ranked.length) return plan;
  const copy = ranked.slice();
  const [row] = copy.splice(index, 1);
  copy.splice(next, 0, row);
  const order = new Map(copy.map((item, i) => [item.id, i + 1]));
  return {
    ...plan,
    assets: plan.assets.map((item) =>
      order.has(item.id) ? { ...item, dipPriority: order.get(item.id) ?? item.dipPriority } : item,
    ),
  };
}

export function sipForDraft(plan: InvestPlan, amount: Paise): InvestSplit | null {
  if (amount <= 0) return null;
  try {
    return splitInvest(amount, plan);
  } catch {
    return null;
  }
}

export function dipSuggestion(plan: InvestPlan, amount: Paise) {
  try {
    return suggestDipDeploy(amount, plan);
  } catch {
    return null;
  }
}

export function themeTierCaption(
  tier: InvestThemeTier,
  assets: readonly InvestAsset[],
  all: readonly InvestThemeTier[],
): string {
  const names = tier.allowedAssetIds
    .map((id) => assets.find((row) => row.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const list = names.length > 0 ? names.join(", ") : "no themes";
  if (tier.belowAmount != null) {
    return `Below ${formatInr(tier.belowAmount)} → ${list}`;
  }
  const bounded = all
    .map((row) => row.belowAmount)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  const floor = bounded[bounded.length - 1];
  if (floor == null) return `All amounts → ${list}`;
  return `${formatInr(floor)}+ → ${list}`;
}

export function activeThemeTierId(plan: InvestPlan, amount: Paise): string | null {
  return resolveThemeTier(amount, plan.themeTiers)?.id ?? null;
}

export function setTierBelowAmount(plan: InvestPlan, id: string, belowAmount: Paise | null): InvestPlan {
  return {
    ...plan,
    themeTiers: plan.themeTiers.map((tier) => (tier.id === id ? { ...tier, belowAmount } : tier)),
  };
}

export function toggleTierAsset(plan: InvestPlan, tierId: string, assetId: string): InvestPlan {
  return {
    ...plan,
    themeTiers: plan.themeTiers.map((tier) => {
      if (tier.id !== tierId) return tier;
      const has = tier.allowedAssetIds.includes(assetId);
      return {
        ...tier,
        allowedAssetIds: has
          ? tier.allowedAssetIds.filter((id) => id !== assetId)
          : [...tier.allowedAssetIds, assetId],
      };
    }),
  };
}

export function themeAssets(plan: InvestPlan): InvestAsset[] {
  return plan.assets.filter((row) => row.kind === "theme");
}

export function sipOrderCaption(split: InvestSplit): string {
  return `SIP pool ${formatInr(split.sipPool)} · Dip reserve ${formatInr(split.dipCredit)}`;
}

export function versionCaption(plan: InvestPlan | null): string {
  if (!plan) return "No plan yet";
  return `Version from ${plan.effectiveFrom}`;
}

export function automationSip(split: InvestSplit | null): Paise {
  if (!split) return 0;
  const row = split.orders.find((item) =>
    item.name.toLowerCase().includes("automation"),
  );
  return row?.amount ?? 0;
}

export type AssetFormValue = {
  name: string;
  kind: InvestAsset["kind"];
  targetPct: string;
  dipPriority: string;
  instrumentNote: string;
  active: boolean;
};

export function emptyAssetForm(): AssetFormValue {
  return {
    name: "",
    kind: "core",
    targetPct: "",
    dipPriority: "",
    instrumentNote: "",
    active: true,
  };
}

export function assetToForm(asset: InvestAsset): AssetFormValue {
  const pct = asset.targetBp / 100;
  return {
    name: asset.name,
    kind: asset.kind,
    targetPct: Number.isInteger(pct) ? String(pct) : String(pct),
    dipPriority: asset.dipPriority == null ? "" : String(asset.dipPriority),
    instrumentNote: asset.instrumentNote,
    active: asset.active,
  };
}

export function formToAsset(form: AssetFormValue, id: string): InvestAsset | null {
  const name = form.name.trim();
  if (!name) return null;
  const pct = Number(form.targetPct);
  if (!Number.isFinite(pct) || pct < 0) return null;
  const targetBp = Math.round(pct * 100);
  let dipPriority: number | null = null;
  if (form.dipPriority.trim() !== "") {
    const n = Number(form.dipPriority);
    if (!Number.isInteger(n) || n < 1) return null;
    dipPriority = n;
  }
  return {
    id: id || draftAssetId(name),
    name,
    kind: form.kind,
    targetBp,
    dipPriority,
    instrumentNote: form.instrumentNote.trim(),
    active: form.active,
  };
}
