import {
  bucketCurrentBalances,
  computeBalances,
  DEFAULT_BUCKET_IDS,
  goalAffordability,
  ZERO_PAISE,
  type Goal,
  type GoalCard,
  type GoalContribution,
  type GoalPill,
  type IsoDate,
  type Paise,
} from "../src/engine/index.ts";
import { loadBooks } from "./books.ts";
import type { AppDb } from "./db/client.ts";
import { listAllocationRuns } from "./repo/allocation.ts";
import { listGoalContributions } from "./repo/goals.ts";
import { listGoals } from "./repo/invest.ts";
import { listAccounts, listBuckets } from "./repo/store.ts";

export type { GoalCard };

export type GoalBucketLine = {
  id: string;
  name: string;
  current: Paise;
};

export type GoalAccountLine = {
  id: string;
  name: string;
  group: string;
  bucketId: string | null;
  balance: Paise;
};

export type GoalsPayload = {
  today: IsoDate;
  totalRemaining: Paise;
  fundingNote: string;
  buckets: GoalBucketLine[];
  accounts: GoalAccountLine[];
  goals: GoalCard[];
  contributions: GoalContribution[];
};

function expectedMonthlyByBucket(db: AppDb): Record<string, Paise> {
  const run = listAllocationRuns(db).find((row) => row.status === "confirmed");
  if (!run) return {};
  const out: Record<string, Paise> = {};
  for (const line of run.lines) {
    out[line.bucketId] = line.confirmedAmount ?? ZERO_PAISE;
  }
  return out;
}

function fundingNoteFor(goals: readonly Goal[], buckets: readonly GoalBucketLine[]): string {
  const live = goals.filter((row) => row.status !== "dropped");
  const ids = [...new Set(live.map((row) => row.fundingBucketId))];
  const id = ids[0] ?? DEFAULT_BUCKET_IDS.savingsBuffer;
  if (ids.length <= 1) {
    const name = buckets.find((row) => row.id === id)?.name ?? "Savings buffer";
    return `Funded from ${name}`;
  }
  return "Each goal is funded from its bucket";
}

function toCard(
  goal: Goal,
  aff: {
    funded: Paise;
    remaining: Paise | null;
    availableNow: Paise;
    monthsLeft: number | null;
    neededPerMonth: Paise | null;
    expectedMonthly: Paise;
    status: GoalPill;
    label: string;
  },
  contributionCount: number,
): GoalCard {
  const needsTarget = goal.targetAmount == null;
  let pill = aff.status;
  let pillLabel = aff.label;
  if (goal.status === "achieved" || (aff.remaining != null && aff.remaining <= 0)) {
    pill = "achieved";
    pillLabel = "Achieved";
  }
  return {
    ...goal,
    funded: aff.funded,
    remaining: aff.remaining,
    availableNow: aff.availableNow,
    monthsLeft: aff.monthsLeft,
    neededPerMonth: aff.neededPerMonth,
    expectedMonthly: aff.expectedMonthly,
    pill,
    pillLabel,
    needsTarget,
    contributionCount,
  };
}

export function buildGoals(db: AppDb, today?: IsoDate): GoalsPayload {
  const books = loadBooks(db, today);
  const snap = computeBalances(books.accounts, books.entries, books.today);
  const currentByBucket = bucketCurrentBalances(books.accounts, snap.positions);
  const goalRows = listGoals(db);
  const contributions = listGoalContributions(db);
  const affRows = goalAffordability({
    goals: goalRows,
    contributions,
    bucketBalances: currentByBucket,
    expectedMonthlyByBucket: expectedMonthlyByBucket(db),
    today: books.today,
  });
  const affById = new Map(affRows.map((row) => [row.goalId, row]));
  const countBy = new Map<string, number>();
  for (const row of contributions) {
    countBy.set(row.goalId, (countBy.get(row.goalId) ?? 0) + 1);
  }

  const bucketLines: GoalBucketLine[] = listBuckets(db)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    .map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      current: currentByBucket[bucket.id] ?? ZERO_PAISE,
    }));

  const cards: GoalCard[] = [];
  for (const goal of goalRows) {
    const aff = affById.get(goal.id);
    if (!aff) continue;
    cards.push(toCard(goal, aff, countBy.get(goal.id) ?? 0));
  }

  let remaining: Paise = ZERO_PAISE;
  for (const row of cards) {
    if (row.status === "dropped" || row.status === "achieved") continue;
    if (row.remaining != null && row.remaining > 0) remaining += row.remaining;
  }

  const positionById = new Map(snap.positions.map((row) => [row.accountId, row.balance]));
  const accounts: GoalAccountLine[] = listAccounts(db)
    .filter((account) => account.type !== "virtual" && !account.isArchived)
    .map((account) => ({
      id: account.id,
      name: account.name,
      group: account.group,
      bucketId: account.bucketId,
      balance: positionById.get(account.id) ?? ZERO_PAISE,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    today: books.today,
    totalRemaining: remaining,
    fundingNote: fundingNoteFor(goalRows, bucketLines),
    buckets: bucketLines,
    accounts,
    goals: cards,
    contributions,
  };
}
