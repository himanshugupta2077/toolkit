import type { WealthBucketCard, WealthResponse } from "../api/store.ts";
import {
  bucketFillPct,
  bucketMonthsFilled,
  DEFAULT_BUCKET_IDS,
  formatInr,
  resolveBucketTarget,
  type Bucket,
  type FillMode,
  type Paise,
  type TargetRule,
  type WaterfallLine,
} from "../engine/index.ts";

export const TARGET_RULE_LABELS: Record<TargetRule, string> = {
  months_of_essentials: "Months of essentials",
  fixed: "Fixed ₹",
  none: "None",
};

export const FILL_MODE_LABELS: Record<FillMode, string> = {
  until_target: "Until target",
  percent: "% of surplus",
  fixed: "Fixed ₹",
  remainder: "Remainder",
};

export function shortBucketName(name: string, id: string): string {
  if (id === DEFAULT_BUCKET_IDS.emergencyFund) return "EF";
  if (id === DEFAULT_BUCKET_IDS.savingsBuffer) return "Savings";
  if (id === DEFAULT_BUCKET_IDS.investment) return "Investment";
  return name;
}

export function formatFillPct(ratio: number | null): string | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return `${Math.round(ratio * 100)}%`;
}

export function monthsCaption(
  monthsFilled: number | null,
  targetMonths: number | null,
): string | null {
  if (monthsFilled == null || targetMonths == null) return null;
  const rounded = Math.round(monthsFilled * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `≈ ${text} of ${targetMonths} months`;
}

export function bucketHeroCaption(bucket: Pick<
  WealthBucketCard,
  "current" | "target" | "fillPct" | "monthsFilled" | "targetRule" | "targetMonths"
>): string {
  if (bucket.targetRule === "none" || bucket.target == null) {
    return `${formatInr(bucket.current)} invested cost`;
  }
  const pct = formatFillPct(bucket.fillPct);
  const pair = `${formatInr(bucket.current)} / ${formatInr(bucket.target)}`;
  const withPct = pct ? `${pair} (${pct})` : pair;
  const months = monthsCaption(bucket.monthsFilled, bucket.targetMonths);
  return months ? `${withPct} · ${months}` : withPct;
}

export function exampleCaption(
  surplus: Paise,
  lines: readonly Pick<WaterfallLine, "bucketId" | "name" | "amount">[],
): string {
  if (lines.length === 0) {
    return `With ${formatInr(surplus)} surplus today this plan cannot run (fix the bucket rules).`;
  }
  const bits = lines.map(
    (line) => `${shortBucketName(line.name, line.bucketId)} ${formatInr(line.amount)}`,
  );
  return `With ${formatInr(surplus)} surplus today this plan gives ${bits.join(", ")}.`;
}

export function exampleFromWealth(data: Pick<WealthResponse, "free" | "example">): string {
  return exampleCaption(data.example.surplus, data.example.lines);
}

export function ringPercent(fillPct: number | null): number {
  if (fillPct == null || !Number.isFinite(fillPct)) return 0;
  return Math.min(100, Math.max(0, Math.round(fillPct * 100)));
}

export function rupeesInput(paise: Paise | null): string {
  if (paise == null) return "";
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

export function parseRupeesInput(raw: string): Paise | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function moveBucket(list: WealthBucketCard[], id: string, dir: -1 | 1): WealthBucketCard[] {
  const ordered = list.slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const index = ordered.findIndex((row) => row.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= ordered.length) return list;
  const copy = ordered.slice();
  const [row] = copy.splice(index, 1);
  copy.splice(next, 0, row);
  return copy.map((bucket, i) => ({ ...bucket, priority: i + 1 }));
}

export function toBucketWrite(bucket: WealthBucketCard): Bucket & { accountIds: string[] } {
  return {
    id: bucket.id,
    name: bucket.name,
    priority: bucket.priority,
    targetRule: bucket.targetRule,
    targetAmount: bucket.targetAmount,
    targetMonths: bucket.targetMonths,
    fillMode: bucket.fillMode,
    fillValue: bucket.fillValue,
    minMonthly: bucket.minMonthly,
    active: bucket.active,
    notes: bucket.notes,
    colour: bucket.colour,
    accountIds: bucket.accountIds,
  };
}

export function applyAccountToggle(
  buckets: WealthBucketCard[],
  bucketId: string,
  accountId: string,
  on: boolean,
): WealthBucketCard[] {
  return buckets.map((bucket) => {
    const without = bucket.accountIds.filter((id) => id !== accountId);
    if (bucket.id === bucketId) {
      return {
        ...bucket,
        accountIds: on ? [...without, accountId] : without,
      };
    }
    return { ...bucket, accountIds: without };
  });
}

export function resolveDraftCards(
  draft: readonly WealthBucketCard[],
  essentialsAverage: Paise,
): WealthBucketCard[] {
  return draft.map((bucket) => {
    const target = resolveBucketTarget(bucket, essentialsAverage);
    return {
      ...bucket,
      target,
      room: target == null ? null : Math.max(0, target - bucket.current),
      fillPct: bucketFillPct(bucket.current, target),
      monthsFilled:
        bucket.targetRule === "months_of_essentials"
          ? bucketMonthsFilled(bucket.current, essentialsAverage)
          : null,
    };
  });
}


