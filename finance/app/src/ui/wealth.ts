import type { NetWorthHistoryPoint, WealthBucketCard, WealthResponse } from "../api/store.ts";
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
  type YearMonth,
} from "../engine/index.ts";
import { formatMonthShort } from "./ledger.ts";

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

export function nextFdName(existing: readonly { name: string }[]): string {
  const used = new Set(existing.map((row) => row.name.trim().toLowerCase()));
  for (let i = 1; i <= 99; i++) {
    const name = `FD${i}`;
    if (!used.has(name.toLowerCase()) && !used.has(`fd ${i}`)) return name;
  }
  return "FD";
}

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

export function withEmergencyFundTarget(
  buckets: readonly WealthBucketCard[],
  amount: Paise,
): Array<Bucket & { accountIds: string[] }> {
  return buckets.map((row) => {
    const write = toBucketWrite(row);
    if (row.id !== DEFAULT_BUCKET_IDS.emergencyFund) return write;
    return {
      ...write,
      targetRule: "fixed",
      targetAmount: amount,
      targetMonths: null,
    };
  });
}

export function bucketHeroCaption(bucket: Pick<
  WealthBucketCard,
  "current" | "target" | "fillPct" | "monthsFilled" | "targetRule" | "targetMonths"
>): string {
  if (bucket.targetRule === "none" || bucket.target == null) {
    return `${formatInr(bucket.current)} invested cost`;
  }
  if (bucket.target <= 0) {
    return `${formatInr(bucket.current)} · no target yet`;
  }
  const pct = formatFillPct(bucket.fillPct);
  const pair = `${formatInr(bucket.current)} / ${formatInr(bucket.target)}`;
  const withPct = pct ? `${pair} (${pct})` : pair;
  const months =
    bucket.targetRule === "months_of_essentials"
      ? monthsCaption(bucket.monthsFilled, bucket.targetMonths)
      : null;
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

export function chartDateLabel(date: string): string {
  const day = Number(date.slice(8, 10));
  const month = formatMonthShort(date.slice(0, 7) as YearMonth);
  return `${day} ${month}`;
}

/**
 * Y range for the net-worth area chart. Pads so a few rupees of noise
 * does not fill the whole plot like a crash.
 */
export function netWorthYDomain(values: readonly number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const mag = Math.max(Math.abs(lo), Math.abs(hi), 100);
  const minSpan = Math.max(Math.round(mag * 0.08), 100);
  const usedSpan = Math.max(span, minSpan);
  const pad = Math.round(usedSpan * 0.12);
  const mid = Math.round((lo + hi) / 2);
  const half = Math.round(usedSpan / 2) + pad;
  return { min: mid - half, max: mid + half };
}

export function netWorthTrendCaption(
  history: readonly Pick<NetWorthHistoryPoint, "date" | "netWorth">[],
): string | null {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history[history.length - 1];
  if (!first || !last) return null;
  const delta = last.netWorth - first.netWorth;
  const since = chartDateLabel(first.date);
  if (delta === 0) return `No change since ${since}`;
  const body = formatInr(Math.abs(delta));
  return delta > 0 ? `Up ${body} since ${since}` : `Down ${body} since ${since}`;
}

export function netWorthPlotPoints(
  history: readonly Pick<NetWorthHistoryPoint, "netWorth">[],
  domain: { min: number; max: number },
): { x: number; y: number }[] {
  if (history.length === 0) return [];
  const span = domain.max - domain.min || 1;
  return history.map((row, index) => ({
    x: history.length === 1 ? 0.5 : index / (history.length - 1),
    y: 1 - (row.netWorth - domain.min) / span,
  }));
}


