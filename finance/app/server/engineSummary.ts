import {
  bucketCurrentBalances,
  computeBalances,
  DEFAULT_BUCKET_IDS,
  formatInr,
  resolveBucketTarget,
  trailingEssentialsAverage,
  ZERO_PAISE,
  type Goal,
  type InvestPlan,
  type IsoDate,
  type Paise,
} from "../src/engine/index.ts";
import { loadBooks } from "./books.ts";
import type { AppDb } from "./db/client.ts";
import { getCurrentInvestPlan, listEssentialCategoryIds, listGoals } from "./repo/invest.ts";

export type EngineAccountLine = {
  id: string;
  name: string;
  balance: Paise;
};

export type EngineBucketLine = {
  id: string;
  name: string;
  priority: number;
  fillMode: string;
  targetRule: string;
  current: Paise;
  target: Paise | null;
  room: Paise | null;
  accounts: EngineAccountLine[];
};

export type EngineSummary = {
  today: IsoDate;
  confirmation: string;
  buckets: EngineBucketLine[];
  unassignedLiquid: EngineAccountLine[];
  investPlan: InvestPlan | null;
  goals: Goal[];
  essentialsAverage: Paise;
  efMonths: number;
  savingsTarget: Paise;
};

export function formatSeedConfirmation(efTarget: Paise, savingsTarget: Paise): string {
  return `EF target = ${formatInr(efTarget)} · Savings target = ${formatInr(savingsTarget)} · Investment = remainder`;
}

export function buildEngineSummary(db: AppDb, today?: IsoDate): EngineSummary {
  const books = loadBooks(db, today);
  const snap = computeBalances(books.accounts, books.entries);
  const currentByBucket = bucketCurrentBalances(books.accounts, snap.positions);
  const essentialIds = listEssentialCategoryIds(db);
  const trailing = trailingEssentialsAverage(
    books.today,
    books.entries,
    books.categories,
    essentialIds,
  );
  const positionById = new Map(snap.positions.map((row) => [row.accountId, row.balance]));

  const ordered = books.buckets.slice().sort((a, b) => a.priority - b.priority);
  const bucketLines: EngineBucketLine[] = ordered.map((bucket) => {
    const current = currentByBucket[bucket.id] ?? ZERO_PAISE;
    const target = resolveBucketTarget(bucket, trailing.average);
    const room = target == null ? null : Math.max(0, target - current);
    const tagged = books.accounts
      .filter((account) => account.bucketId === bucket.id)
      .map((account) => ({
        id: account.id,
        name: account.name,
        balance: positionById.get(account.id) ?? ZERO_PAISE,
      }));
    return {
      id: bucket.id,
      name: bucket.name,
      priority: bucket.priority,
      fillMode: bucket.fillMode,
      targetRule: bucket.targetRule,
      current,
      target,
      room,
      accounts: tagged,
    };
  });

  const ef = bucketLines.find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund);
  const savings = bucketLines.find((row) => row.id === DEFAULT_BUCKET_IDS.savingsBuffer);
  const efTarget = ef?.target ?? ZERO_PAISE;
  const savingsTarget = savings?.target ?? ZERO_PAISE;

  const unassignedLiquid = books.accounts
    .filter((account) => account.includeLiquid && account.bucketId == null)
    .map((account) => ({
      id: account.id,
      name: account.name,
      balance: positionById.get(account.id) ?? ZERO_PAISE,
    }));

  const settingsRow = books.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund);

  return {
    today: books.today,
    confirmation: formatSeedConfirmation(efTarget, savingsTarget),
    buckets: bucketLines,
    unassignedLiquid,
    investPlan: getCurrentInvestPlan(db),
    goals: listGoals(db),
    essentialsAverage: trailing.average,
    efMonths: settingsRow?.targetMonths ?? 6,
    savingsTarget,
  };
}
