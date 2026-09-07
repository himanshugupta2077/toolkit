import {
  DEFAULT_INVEST_PLAN_ID,
  inactivateGold,
  seedDefaultInvestPlan,
  type InvestAsset,
  type InvestPlan,
} from "../../src/engine/index.ts";
import { buildEngineSummary, type EngineSummary } from "../engineSummary.ts";
import type { AppDb } from "../db/client.ts";
import { nowIso } from "../ids.ts";
import { SCHEMA_VERSION } from "../db/paths.ts";
import {
  applySeedTargets,
  assemblePlanFromAssets,
  persistInvestPlan,
  replaceGoals,
} from "../repo/invest.ts";
import { setMeta } from "../repo/store.ts";
import { ensureDefaultBuckets, tagDefaultAccountBuckets } from "./mapBuckets.ts";
import type { ParsedInvestWorkbook } from "./investTypes.ts";
import type { ParseWarning } from "./types.ts";

export type InvestImportReport = EngineSummary & {
  filename: string;
  replace: boolean;
  ok: boolean;
  tagged: number;
  warnings: ParseWarning[];
};

function planFromParsed(parsed: ParsedInvestWorkbook, filename: string): InvestPlan {
  const assets: InvestAsset[] = parsed.assets.map((row) => ({
    id: "",
    name: row.name,
    kind: row.kind,
    targetBp: row.targetBp,
    dipPriority: row.dipPriority,
    instrumentNote: row.instrumentNote,
    active: row.active,
  }));
  const draft = assemblePlanFromAssets(
    {
      id: DEFAULT_INVEST_PLAN_ID,
      effectiveFrom: parsed.effectiveFrom,
      sipBp: parsed.sipBp,
      dipReserveBp: parsed.dipReserveBp,
      notes: `imported from ${filename}`,
    },
    assets,
    parsed.themeTiers,
  );
  return inactivateGold(draft);
}

export function applyInvestImport(
  db: AppDb,
  parsed: ParsedInvestWorkbook,
  opts: { replace: boolean; filename: string },
): InvestImportReport {
  const at = nowIso();
  let tagged = 0;
  db.transaction((tx) => {
    ensureDefaultBuckets(tx, at);
    tagged = tagDefaultAccountBuckets(tx);
    persistInvestPlan(tx, planFromParsed(parsed, opts.filename), at);
    applySeedTargets(tx, { savingsTargetPaise: parsed.savingsTarget }, at);
    replaceGoals(
      tx,
      parsed.goals.map((row, index) => ({
        name: row.name,
        targetAmount: row.targetAmount,
        targetDate: null,
        priority: index + 1,
        notes: row.notes,
      })),
      at,
    );
    setMeta(tx, "schema_version", SCHEMA_VERSION);
    setMeta(tx, "last_invest_import_at", at);
    setMeta(tx, "last_invest_import_filename", opts.filename);
  });
  const summary = buildEngineSummary(db);
  return {
    ...summary,
    filename: opts.filename,
    replace: opts.replace,
    ok: summary.investPlan != null,
    tagged,
    warnings: parsed.warnings,
  };
}

export function seedDefaultInvestSide(db: AppDb): InvestImportReport {
  const at = nowIso();
  let tagged = 0;
  db.transaction((tx) => {
    ensureDefaultBuckets(tx, at);
    tagged = tagDefaultAccountBuckets(tx);
    persistInvestPlan(tx, seedDefaultInvestPlan(), at);
    setMeta(tx, "schema_version", SCHEMA_VERSION);
    setMeta(tx, "last_invest_import_at", at);
    setMeta(tx, "last_invest_import_filename", "default");
  });
  const summary = buildEngineSummary(db);
  return {
    ...summary,
    filename: "default",
    replace: true,
    ok: summary.investPlan != null,
    tagged,
    warnings: [],
  };
}
