import {
  DEFAULT_BUCKET_IDS,
  formatInr,
  type Goal,
  type GoalCard,
  type GoalPill,
  type GoalStatus,
  type Paise,
} from "../engine/index.ts";

export type { GoalCard };

export const EMPTY_GOALS_HINT =
  "German exams, Germany relocation, MacBook Air, iPhone";

export const FILL_TARGET_PROMPT = "Fill a target amount";

export function goalNeedsTarget(goal: Pick<Goal, "targetAmount">): boolean {
  return goal.targetAmount == null;
}

export function goalFillPct(funded: Paise, target: Paise | null): number | null {
  if (target == null || target <= 0) return null;
  return funded / target;
}

export function displayPill(
  goal: Pick<GoalCard, "status" | "remaining" | "pill" | "pillLabel">,
): { pill: GoalPill; label: string } {
  if (goal.status === "achieved" || (goal.remaining != null && goal.remaining <= 0)) {
    return { pill: "achieved", label: "Achieved" };
  }
  return { pill: goal.pill, label: goal.pillLabel };
}

export function pillClass(pill: GoalPill): string {
  switch (pill) {
    case "affordable_now":
      return "bg-ok-soft text-ok";
    case "on_track":
      return "border border-line-strong text-ink";
    case "behind":
      return "bg-warn-soft text-warn";
    case "achieved":
      return "bg-ok-soft text-ok";
    case "saving":
      return "bg-card-2 text-muted";
  }
}

export function goalsStrip(goals: readonly GoalCard[], n = 3): GoalCard[] {
  return goals.filter((row) => row.status === "active").slice(0, n);
}

export function moveGoal(list: readonly GoalCard[], id: string, dir: -1 | 1): GoalCard[] {
  const ordered = list.slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const index = ordered.findIndex((row) => row.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= ordered.length) return list.slice();
  const copy = ordered.slice();
  const [row] = copy.splice(index, 1);
  if (!row) return list.slice();
  copy.splice(next, 0, row);
  return copy.map((goal, i) => ({ ...goal, priority: i + 1 }));
}

export function totalRemaining(goals: readonly GoalCard[]): Paise {
  let sum: Paise = 0;
  for (const row of goals) {
    if (row.status === "dropped" || row.status === "achieved") continue;
    if (row.remaining != null && row.remaining > 0) sum += row.remaining;
  }
  return sum;
}

export function fundingNote(
  goals: readonly Pick<Goal, "status" | "fundingBucketId">[],
  buckets: readonly { id: string; name: string }[],
): string {
  const live = goals.filter((row) => row.status !== "dropped");
  const ids = [...new Set(live.map((row) => row.fundingBucketId))];
  const id = ids[0] ?? DEFAULT_BUCKET_IDS.savingsBuffer;
  if (ids.length <= 1) {
    const name = buckets.find((row) => row.id === id)?.name ?? "Savings buffer";
    return `Funded from ${name}`;
  }
  return "Each goal is funded from its bucket";
}

export function fundNowAmount(row: Pick<GoalCard, "remaining" | "availableNow">): Paise {
  if (row.remaining != null && row.remaining > 0) return row.remaining;
  if (row.availableNow > 0) return row.availableNow;
  return 0;
}

export function fundTodayWhy(input: {
  needsTarget: boolean;
  remaining: Paise | null;
  availableNow: Paise;
  bucketName: string;
  bucketBalance: Paise;
  higherPriority: readonly { name: string; remaining: Paise | null }[];
  lifecycle: GoalStatus;
}): string {
  if (input.needsTarget) {
    return "Fill a target amount to see if this is affordable.";
  }
  if (input.lifecycle === "achieved" || (input.remaining != null && input.remaining <= 0)) {
    return "Already funded.";
  }
  const remaining = input.remaining ?? 0;
  const ahead = input.higherPriority
    .filter((row) => row.remaining != null && row.remaining > 0)
    .map((row) => `${row.name} still needs ${formatInr(row.remaining ?? 0)}`);
  const aheadBit = ahead.length > 0 ? `${ahead.join("; ")} ahead of this` : null;

  if (input.availableNow >= remaining) {
    if (aheadBit) {
      return `Yes: ${input.bucketName} has ${formatInr(input.bucketBalance)}. ${aheadBit}, leaving ${formatInr(input.availableNow)} free. This goal needs ${formatInr(remaining)}.`;
    }
    return `Yes: ${input.bucketName} has ${formatInr(input.bucketBalance)} and this goal needs ${formatInr(remaining)}.`;
  }
  if (aheadBit) {
    return `No: ${input.bucketName} has ${formatInr(input.bucketBalance)}. ${aheadBit}, leaving ${formatInr(input.availableNow)} free. This goal still needs ${formatInr(remaining)}.`;
  }
  return `No: ${input.bucketName} has ${formatInr(input.bucketBalance)} and this goal needs ${formatInr(remaining)}.`;
}

export function fundTodayWhyFor(
  card: GoalCard,
  all: readonly GoalCard[],
  buckets: readonly { id: string; name: string; current?: Paise }[],
): string {
  const bucket = buckets.find((row) => row.id === card.fundingBucketId);
  const higher = all.filter(
    (row) =>
      row.id !== card.id &&
      row.fundingBucketId === card.fundingBucketId &&
      row.status === "active" &&
      row.priority < card.priority,
  );
  return fundTodayWhy({
    needsTarget: card.needsTarget,
    remaining: card.remaining,
    availableNow: card.availableNow,
    bucketName: bucket?.name ?? "Savings buffer",
    bucketBalance: bucket?.current ?? card.availableNow,
    higherPriority: higher.map((row) => ({ name: row.name, remaining: row.remaining })),
    lifecycle: card.status,
  });
}
