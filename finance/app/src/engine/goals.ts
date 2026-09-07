import { isIsoDate, monthsBetween, type IsoDate } from "./dates.ts";
import { formatInr, isPaise, ZERO_PAISE, type Paise } from "./money.ts";
import type { Goal, GoalContribution, GoalPill } from "./types.ts";

export type GoalAffordabilityInput = {
  goals: readonly Goal[];
  contributions: readonly GoalContribution[];
  /** Current balance of each funding bucket (usually Savings). */
  bucketBalances: Readonly<Record<string, Paise>>;
  /** Last allocation run into each bucket. Missing keys count as 0. */
  expectedMonthlyByBucket?: Readonly<Record<string, Paise>>;
  today: IsoDate;
};

export type GoalAffordability = {
  goalId: string;
  name: string;
  priority: number;
  fundingBucketId: string;
  lifecycle: Goal["status"];
  target: Paise | null;
  funded: Paise;
  remaining: Paise | null;
  availableNow: Paise;
  monthsLeft: number | null;
  neededPerMonth: Paise | null;
  expectedMonthly: Paise;
  status: GoalPill;
  label: string;
};

/** Goal row plus §5.10 affordability for the list / detail screens. */
export type GoalCard = Goal & {
  funded: Paise;
  remaining: Paise | null;
  availableNow: Paise;
  monthsLeft: number | null;
  neededPerMonth: Paise | null;
  expectedMonthly: Paise;
  pill: GoalPill;
  pillLabel: string;
  needsTarget: boolean;
  contributionCount: number;
};

function requirePaise(value: Paise, label: string): Paise {
  if (!isPaise(value)) {
    throw new Error(`${label} must be integer paise`);
  }
  return value;
}

function fundedFor(
  goalId: string,
  contributions: readonly GoalContribution[],
): Paise {
  let total: Paise = ZERO_PAISE;
  for (const row of contributions) {
    if (row.goalId !== goalId) continue;
    requirePaise(row.amount, `contribution ${row.id || goalId}`);
    total += row.amount;
  }
  return total;
}

function pillLabel(status: GoalPill, neededPerMonth: Paise | null): string {
  switch (status) {
    case "achieved":
      return "Achieved";
    case "affordable_now":
      return "Affordable now";
    case "on_track":
      return "On track";
    case "behind":
      return `Behind — ${formatInr(neededPerMonth ?? ZERO_PAISE)}/mo needed`;
    case "saving":
      return "Saving";
  }
}

/**
 * Architecture §5.10:
 * remaining <= 0 → achieved
 * available_now >= remaining → affordable now
 * months_left && needed_per_month <= expected_monthly → on track
 * months_left → behind
 * else → saving
 *
 * `available_now` = bucket balance − remaining of higher-priority *active*
 * goals that share the bucket. Paused / dropped goals do not reserve cash.
 */
function resolvePill(
  remaining: Paise | null,
  availableNow: Paise,
  monthsLeft: number | null,
  neededPerMonth: Paise | null,
  expectedMonthly: Paise,
): GoalPill {
  if (remaining != null && remaining <= 0) return "achieved";
  if (remaining != null && availableNow >= remaining) return "affordable_now";
  if (monthsLeft && neededPerMonth != null && neededPerMonth <= expectedMonthly) {
    return "on_track";
  }
  if (monthsLeft) return "behind";
  return "saving";
}

function byPriority(a: Goal, b: Goal): number {
  return a.priority - b.priority || a.id.localeCompare(b.id);
}

/**
 * Affordability for every goal, in priority order. Same function the Goals
 * strip and goal detail page will call.
 */
export function goalAffordability(
  input: GoalAffordabilityInput,
): GoalAffordability[] {
  if (!isIsoDate(input.today)) {
    throw new Error(`invalid today date: ${input.today}`);
  }
  for (const [bucketId, balance] of Object.entries(input.bucketBalances)) {
    requirePaise(balance, `balance for ${bucketId}`);
  }
  if (input.expectedMonthlyByBucket) {
    for (const [bucketId, amount] of Object.entries(input.expectedMonthlyByBucket)) {
      requirePaise(amount, `expected monthly for ${bucketId}`);
    }
  }

  const ordered = input.goals.slice().sort(byPriority);
  const reservedByBucket: Record<string, Paise> = {};
  const results: GoalAffordability[] = [];

  for (const goal of ordered) {
    const funded = fundedFor(goal.id, input.contributions);
    const remaining: Paise | null =
      goal.targetAmount == null
        ? null
        : requirePaise(goal.targetAmount, `target for ${goal.id}`) - funded;
    const reserved = reservedByBucket[goal.fundingBucketId] ?? ZERO_PAISE;
    const bucket = input.bucketBalances[goal.fundingBucketId] ?? ZERO_PAISE;
    const availableNow = bucket - reserved;
    const monthsLeft =
      goal.targetDate == null ? null : monthsBetween(input.today, goal.targetDate);
    const neededPerMonth: Paise | null =
      remaining == null
        ? null
        : remaining <= 0
          ? ZERO_PAISE
          : Math.round(remaining / Math.max(1, monthsLeft ?? 1));
    const expectedMonthly =
      input.expectedMonthlyByBucket?.[goal.fundingBucketId] ?? ZERO_PAISE;
    const status = resolvePill(
      remaining,
      availableNow,
      monthsLeft,
      neededPerMonth,
      expectedMonthly,
    );

    results.push({
      goalId: goal.id,
      name: goal.name,
      priority: goal.priority,
      fundingBucketId: goal.fundingBucketId,
      lifecycle: goal.status,
      target: goal.targetAmount,
      funded,
      remaining,
      availableNow,
      monthsLeft,
      neededPerMonth,
      expectedMonthly,
      status,
      label: pillLabel(status, neededPerMonth),
    });

    if (
      goal.status === "active" &&
      remaining != null &&
      remaining > 0
    ) {
      reservedByBucket[goal.fundingBucketId] = reserved + remaining;
    }
  }

  return results;
}
