import { desc, eq } from "drizzle-orm";
import {
  DEFAULT_ASSET_IDS,
  DEFAULT_BUCKET_IDS,
  DEFAULT_INVEST_PLAN_ID,
  GOLD_ASSET_NAME,
  inactivateGold,
  isIsoDate,
  isInvestAssetKind,
  isPaise,
  seedDefaultInvestPlan,
  todayIst,
  validateInvestPlan,
  type Goal,
  type InvestAsset,
  type InvestPlan,
  type InvestThemeTier,
  type IsoDate,
  type Paise,
} from "../../src/engine/index.ts";
import type { AppDb } from "../db/client.ts";
import {
  allocationRuns,
  buckets,
  categories,
  goalContributions,
  goals,
  investAssets,
  investPlans,
  investThemeTiers,
  settings,
} from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import { slugId } from "../import/cells.ts";
import { deleteAllHoldings, rematchHoldingsToPlan } from "./holdings.ts";
import {
  mapGoal,
  mapInvestAsset,
  mapInvestPlan,
  mapInvestThemeTier,
} from "./mappers.ts";

export function canonicalAssetId(name: string): string {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const aliases: Record<string, string> = {
    nasdaq_100: DEFAULT_ASSET_IDS.nasdaq100,
    nasdaq100: DEFAULT_ASSET_IDS.nasdaq100,
    india_flexicap: DEFAULT_ASSET_IDS.indiaFlexicap,
    flexicap: DEFAULT_ASSET_IDS.indiaFlexicap,
    nifty_50: DEFAULT_ASSET_IDS.nifty50,
    nifty_next_50: DEFAULT_ASSET_IDS.niftyNext50,
    ai_infrastructure: DEFAULT_ASSET_IDS.aiInfrastructure,
    automation_robotics: DEFAULT_ASSET_IDS.automationRobotics,
    automation_and_robotics: DEFAULT_ASSET_IDS.automationRobotics,
    electricity_grid: DEFAULT_ASSET_IDS.electricityGrid,
    electricity_and_grid: DEFAULT_ASSET_IDS.electricityGrid,
    defense_cyber: DEFAULT_ASSET_IDS.defenseCyber,
    defense_and_cyber: DEFAULT_ASSET_IDS.defenseCyber,
    defence_cyber: DEFAULT_ASSET_IDS.defenseCyber,
    defence_and_cyber: DEFAULT_ASSET_IDS.defenseCyber,
    gold: DEFAULT_ASSET_IDS.gold,
  };
  return aliases[n] ?? `asset_${n || "unnamed"}`;
}

function namesMatch(a: string, b: string): boolean {
  const left = a
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const right = b
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return left === right || left.includes(right) || right.includes(left);
}

export function listEssentialCategoryIds(db: AppDb): string[] {
  return db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.isEssential, true))
    .all()
    .map((row) => row.id);
}

export function listGoals(db: AppDb): Goal[] {
  return db
    .select()
    .from(goals)
    .all()
    .map(mapGoal)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export class InvestWriteError extends Error {
  status: 400 | 404 | 409;
  issues: { field: string; code: string; message: string }[];

  constructor(
    message: string,
    status: 400 | 404 | 409 = 400,
    issues: { field: string; code: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "InvestWriteError";
    this.status = status;
    this.issues = issues;
  }
}

function loadPlanRow(
  db: AppDb,
  plan: typeof investPlans.$inferSelect,
): InvestPlan {
  const assets = db
    .select()
    .from(investAssets)
    .where(eq(investAssets.planId, plan.id))
    .all()
    .map(mapInvestAsset);
  const themeTiers = db
    .select()
    .from(investThemeTiers)
    .where(eq(investThemeTiers.planId, plan.id))
    .all()
    .map(mapInvestThemeTier);
  return mapInvestPlan(plan, assets, themeTiers);
}

export function getInvestPlanById(db: AppDb, id: string): InvestPlan | null {
  const plan = db.select().from(investPlans).where(eq(investPlans.id, id)).get();
  return plan ? loadPlanRow(db, plan) : null;
}

export function listInvestPlans(db: AppDb): InvestPlan[] {
  return db
    .select()
    .from(investPlans)
    .orderBy(desc(investPlans.effectiveFrom), desc(investPlans.createdAt))
    .all()
    .map((plan) => loadPlanRow(db, plan));
}

export function getCurrentInvestPlan(db: AppDb): InvestPlan | null {
  return listInvestPlans(db)[0] ?? null;
}

function insertPlanRows(db: AppDb, plan: InvestPlan, at: string): void {
  db.insert(investPlans)
    .values({
      id: plan.id,
      effectiveFrom: plan.effectiveFrom,
      sipBp: plan.sipBp,
      dipReserveBp: plan.dipReserveBp,
      notes: plan.notes,
      createdAt: at,
    })
    .run();
  for (const asset of plan.assets) {
    db.insert(investAssets)
      .values({
        id: asset.id,
        planId: plan.id,
        name: asset.name,
        kind: asset.kind,
        targetBp: asset.targetBp,
        dipPriority: asset.dipPriority,
        instrumentNote: asset.instrumentNote,
        active: asset.active,
      })
      .run();
  }
  for (const tier of plan.themeTiers) {
    db.insert(investThemeTiers)
      .values({
        id: tier.id,
        planId: plan.id,
        belowAmount: tier.belowAmount,
        allowedAssetIds: JSON.stringify(tier.allowedAssetIds),
      })
      .run();
  }
}

function withStableIds(plan: InvestPlan): InvestPlan {
  const used = new Set<string>();
  const assets: InvestAsset[] = plan.assets.map((asset) => {
    let id = asset.id.trim() || canonicalAssetId(asset.name);
    if (used.has(id)) id = uuidv7();
    used.add(id);
    return { ...asset, id };
  });
  const idSet = new Set(assets.map((row) => row.id));
  const themeTiers: InvestThemeTier[] = plan.themeTiers.map((tier) => ({
    ...tier,
    id: tier.id.trim() || uuidv7(),
    allowedAssetIds: tier.allowedAssetIds.filter((id) => idSet.has(id)),
  }));
  return { ...plan, id: plan.id || DEFAULT_INVEST_PLAN_ID, assets, themeTiers };
}

function withNewVersionIds(plan: InvestPlan, today: IsoDate): InvestPlan {
  const idMap = new Map<string, string>();
  const assets: InvestAsset[] = plan.assets.map((asset) => {
    const id = uuidv7();
    if (asset.id) idMap.set(asset.id, id);
    return { ...asset, id };
  });
  const themeTiers: InvestThemeTier[] = plan.themeTiers.map((tier) => ({
    ...tier,
    id: uuidv7(),
    allowedAssetIds: tier.allowedAssetIds
      .map((id) => idMap.get(id) ?? id)
      .filter((id) => assets.some((asset) => asset.id === id)),
  }));
  return {
    ...plan,
    id: uuidv7(),
    effectiveFrom: today,
    assets,
    themeTiers,
  };
}

export function persistInvestPlan(db: AppDb, plan: InvestPlan, at = nowIso()): void {
  const next = withStableIds(plan);
  const checked = validateInvestPlan(next);
  if (!checked.ok) {
    throw new Error(
      `invalid invest plan: ${checked.issues.map((row) => row.code).join(", ")}`,
    );
  }
  db.update(allocationRuns).set({ investPlanId: null }).run();
  deleteAllHoldings(db);
  db.delete(investThemeTiers).run();
  db.delete(investAssets).run();
  db.delete(investPlans).run();
  insertPlanRows(db, next, at);
}

export function saveInvestPlanVersion(
  db: AppDb,
  draft: InvestPlan,
  today: IsoDate = todayIst(),
  at = nowIso(),
): InvestPlan {
  const previous = getCurrentInvestPlan(db);
  const next = withNewVersionIds(draft, today);
  const checked = validateInvestPlan(next);
  if (!checked.ok) {
    throw new InvestWriteError(
      checked.issues[0]?.message ?? "Invalid invest plan.",
      400,
      checked.issues,
    );
  }
  insertPlanRows(db, next, at);
  if (previous) rematchHoldingsToPlan(db, previous.assets, next.assets);
  return next;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseAsset(raw: unknown, index: number): InvestAsset {
  if (raw == null || typeof raw !== "object") {
    throw new InvestWriteError(`Asset ${index + 1} is not an object.`);
  }
  const rec = raw as Record<string, unknown>;
  const name = asString(rec.name).trim();
  if (!name) throw new InvestWriteError(`Asset ${index + 1} needs a name.`);
  const kind = asString(rec.kind).trim();
  if (!isInvestAssetKind(kind)) {
    throw new InvestWriteError(`${name}: kind must be core or theme.`);
  }
  const targetBp = asFiniteNumber(rec.targetBp);
  if (targetBp == null || !Number.isInteger(targetBp) || targetBp < 0) {
    throw new InvestWriteError(`${name}: target % must be a non-negative integer bp.`);
  }
  let dipPriority: number | null = null;
  if (rec.dipPriority != null && rec.dipPriority !== "") {
    const n = asFiniteNumber(rec.dipPriority);
    if (n == null || !Number.isInteger(n) || n < 1) {
      throw new InvestWriteError(`${name}: dip priority must be an integer ≥ 1.`);
    }
    dipPriority = n;
  }
  return {
    id: asString(rec.id).trim(),
    name,
    kind,
    targetBp,
    dipPriority,
    instrumentNote: asString(rec.instrumentNote).trim(),
    active: rec.active !== false,
  };
}

function parseTier(raw: unknown, index: number): InvestThemeTier {
  if (raw == null || typeof raw !== "object") {
    throw new InvestWriteError(`Theme tier ${index + 1} is not an object.`);
  }
  const rec = raw as Record<string, unknown>;
  let belowAmount: Paise | null = null;
  if (rec.belowAmount != null && rec.belowAmount !== "") {
    const n = asFiniteNumber(rec.belowAmount);
    if (n == null || !isPaise(n) || n < 0) {
      throw new InvestWriteError(`Theme tier ${index + 1}: below-amount must be paise.`);
    }
    belowAmount = n;
  }
  const allowed = rec.allowedAssetIds;
  if (!Array.isArray(allowed)) {
    throw new InvestWriteError(`Theme tier ${index + 1}: allowedAssetIds must be an array.`);
  }
  return {
    id: asString(rec.id).trim(),
    belowAmount,
    allowedAssetIds: allowed.filter((id): id is string => typeof id === "string" && id.length > 0),
  };
}

export function parseInvestPlanBody(body: unknown): InvestPlan {
  if (body == null || typeof body !== "object") {
    throw new InvestWriteError("invalid json");
  }
  const rec = body as Record<string, unknown>;
  const sipBp = asFiniteNumber(rec.sipBp);
  const dipReserveBp = asFiniteNumber(rec.dipReserveBp);
  if (sipBp == null || dipReserveBp == null) {
    throw new InvestWriteError("SIP % and dip reserve % are required.");
  }
  if (!Array.isArray(rec.assets)) throw new InvestWriteError("assets must be an array.");
  if (!Array.isArray(rec.themeTiers)) throw new InvestWriteError("themeTiers must be an array.");
  let effectiveFrom = asString(rec.effectiveFrom).trim();
  if (effectiveFrom && !isIsoDate(effectiveFrom)) {
    throw new InvestWriteError("effectiveFrom must be YYYY-MM-DD.");
  }
  if (!effectiveFrom) effectiveFrom = todayIst();
  return {
    id: asString(rec.id).trim(),
    effectiveFrom,
    sipBp: Math.round(sipBp),
    dipReserveBp: Math.round(dipReserveBp),
    notes: asString(rec.notes).trim(),
    assets: rec.assets.map(parseAsset),
    themeTiers: rec.themeTiers.map(parseTier),
  };
}

export function replaceGoals(
  db: AppDb,
  rows: Omit<Goal, "id" | "fundingBucketId" | "status">[],
  at = nowIso(),
): void {
  db.delete(goalContributions).run();
  db.delete(goals).run();
  const funding = DEFAULT_BUCKET_IDS.savingsBuffer;
  const used = new Set<string>();
  rows.forEach((row, index) => {
    let id = slugId("goal", row.name);
    if (used.has(id)) id = uuidv7();
    used.add(id);
    db.insert(goals)
      .values({
        id,
        name: row.name,
        targetAmount: row.targetAmount,
        targetDate: row.targetDate,
        priority: row.priority || index + 1,
        fundingBucketId: funding,
        status: "active",
        notes: row.notes,
        createdAt: at,
        updatedAt: at,
      })
      .run();
  });
}

export type SeedTargetPatch = {
  savingsTargetPaise?: Paise;
  efMonths?: number;
  sipBp?: number;
  dipReserveBp?: number;
  goldInactive?: boolean;
};

export function applySeedTargets(db: AppDb, patch: SeedTargetPatch, at = nowIso()): void {
  if (patch.savingsTargetPaise != null) {
    if (!isPaise(patch.savingsTargetPaise) || patch.savingsTargetPaise < 0) {
      throw new Error("savings target must be non-negative paise");
    }
    db.update(buckets)
      .set({ targetAmount: patch.savingsTargetPaise, updatedAt: at })
      .where(eq(buckets.id, DEFAULT_BUCKET_IDS.savingsBuffer))
      .run();
  }
  if (patch.efMonths != null) {
    if (!Number.isInteger(patch.efMonths) || patch.efMonths < 1) {
      throw new Error("EF months must be an integer ≥ 1");
    }
    db.update(settings)
      .set({ efMonths: patch.efMonths, updatedAt: at })
      .where(eq(settings.id, 1))
      .run();
    db.update(buckets)
      .set({ targetMonths: patch.efMonths, updatedAt: at })
      .where(eq(buckets.id, DEFAULT_BUCKET_IDS.emergencyFund))
      .run();
  }

  const needsPlan =
    patch.sipBp != null || patch.dipReserveBp != null || patch.goldInactive != null;
  if (!needsPlan) return;

  let plan = getCurrentInvestPlan(db) ?? seedDefaultInvestPlan();
  if (patch.sipBp != null) plan = { ...plan, sipBp: patch.sipBp };
  if (patch.dipReserveBp != null) plan = { ...plan, dipReserveBp: patch.dipReserveBp };
  if (patch.goldInactive === true) plan = inactivateGold(plan);
  if (patch.goldInactive === false) {
    plan = {
      ...plan,
      assets: plan.assets.map((row) =>
        row.name.trim().toLowerCase() === GOLD_ASSET_NAME.toLowerCase()
          ? { ...row, active: true }
          : row,
      ),
    };
  }
  persistInvestPlan(db, plan, at);
}

export function assemblePlanFromAssets(
  base: Pick<InvestPlan, "id" | "effectiveFrom" | "sipBp" | "dipReserveBp" | "notes">,
  assets: InvestAsset[],
  tiers: { id: string; belowAmount: Paise | null; allowedNames: string[] }[],
): InvestPlan {
  const withIds: InvestAsset[] = assets.map((row) => ({
    ...row,
    id: row.id || canonicalAssetId(row.name),
  }));
  const themeTiers = tiers.map((tier) => ({
    id: tier.id,
    belowAmount: tier.belowAmount,
    allowedAssetIds: withIds
      .filter((asset) =>
        asset.kind === "theme" &&
        (tier.allowedNames.length === 0
          ? true
          : tier.allowedNames.some((name) => namesMatch(name, asset.name))),
      )
      .map((asset) => asset.id),
  }));
  return { ...base, assets: withIds, themeTiers };
}
