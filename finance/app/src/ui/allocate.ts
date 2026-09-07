import type {
  AllocationLineWrite,
  AllocationResponse,
  SuggestedMove,
} from "../api/store.ts";
import {
  formatInr,
  type Paise,
  type WaterfallLine,
} from "../engine/index.ts";
import { FILL_MODE_LABELS, shortBucketName } from "./wealth.ts";

export const COMMITTED_BEYOND_LIQUID = "Committed beyond liquid";

export type LinePick = {
  fromAccountId: string;
  toAccountId: string;
};

export function pickerAccounts<
  T extends { id: string; name: string; type: string; isArchived: boolean },
>(accounts: readonly T[]): T[] {
  return accounts
    .filter((row) => row.type !== "virtual" && !row.isArchived)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function picksFromSuggested(
  lines: readonly Pick<WaterfallLine, "bucketId">[],
  suggested: readonly SuggestedMove[],
): Record<string, LinePick> {
  const out: Record<string, LinePick> = {};
  for (const line of lines) {
    const row = suggested.find((item) => item.bucketId === line.bucketId);
    out[line.bucketId] = {
      fromAccountId: row?.fromAccountId ?? "",
      toAccountId: row?.toAccountId ?? "",
    };
  }
  return out;
}

export function afterCaption(line: WaterfallLine): string {
  const next = line.current + line.amount;
  if (line.target == null) {
    return `+${formatInr(line.amount)} → ${formatInr(next)} invested cost`;
  }
  const full = line.target > 0 && next >= line.target;
  const pair = `${formatInr(next)} / ${formatInr(line.target)}`;
  if (full) return `+${formatInr(line.amount)} → ${pair} · full`;
  const roomLeft = Math.max(0, line.target - next);
  return `+${formatInr(line.amount)} → ${pair} · room left ${formatInr(roomLeft)}`;
}

export function ruleCaption(fillMode: WaterfallLine["fillMode"]): string {
  return FILL_MODE_LABELS[fillMode];
}

export function confirmBlockedReason(input: {
  canAllocate: boolean;
  free: Paise;
  surplus: Paise;
  reason: string;
  lines: readonly WaterfallLine[];
  picks: Readonly<Record<string, LinePick>>;
}): string | null {
  if (!input.canAllocate || input.free <= 0) {
    return input.free < 0 ? COMMITTED_BEYOND_LIQUID : "Nothing free to allocate.";
  }
  if (input.surplus <= 0) return "Surplus must be greater than zero.";
  if (input.surplus !== input.free && input.reason.trim() === "") {
    return "Changing the surplus needs a reason.";
  }
  const positive = input.lines.filter((line) => line.amount > 0);
  if (positive.length === 0) return "Every waterfall line is ₹0.";
  for (const line of positive) {
    const pick = input.picks[line.bucketId];
    if (!pick?.fromAccountId || !pick.toAccountId) {
      return `${shortBucketName(line.name, line.bucketId)} needs From and To accounts.`;
    }
    if (pick.fromAccountId === pick.toAccountId) {
      return `${shortBucketName(line.name, line.bucketId)}: From and To must differ.`;
    }
  }
  return null;
}

export function toConfirmLines(
  lines: readonly WaterfallLine[],
  picks: Readonly<Record<string, LinePick>>,
): AllocationLineWrite[] {
  return lines.map((line) => ({
    bucketId: line.bucketId,
    amount: line.amount,
    fromAccountId: picks[line.bucketId]?.fromAccountId ?? "",
    toAccountId: picks[line.bucketId]?.toAccountId ?? "",
  }));
}

export function historyTitle(run: AllocationResponse["history"][number]): string {
  const status = run.status === "confirmed" ? "confirmed" : "proposed";
  return `${run.month} · ${status} · ${formatInr(run.surplusInput)}`;
}

export function historyLineCaption(
  run: AllocationResponse["history"][number],
): string {
  return run.lines
    .map((line) => {
      const amount = line.confirmedAmount ?? line.proposedAmount;
      return `${shortBucketName(line.name, line.bucketId)} ${formatInr(amount)}`;
    })
    .join(" · ");
}
