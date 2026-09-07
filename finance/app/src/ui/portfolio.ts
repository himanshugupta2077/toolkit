import type { HistoryRange } from "../engine/index.ts";
import { formatBpPct, formatInr, formatUnits } from "../engine/index.ts";
import type {
  NetWorthHistoryPoint,
  PortfolioDriftRow,
  PortfolioHoldingCard,
  PortfolioResponse,
} from "../api/store.ts";
import type { PieBy } from "./displayPrefs.ts";

export const RANGE_CHIPS: { id: HistoryRange; label: string }[] = [
  { id: "1M", label: "1M" },
  { id: "3M", label: "3M" },
  { id: "6M", label: "6M" },
  { id: "1Y", label: "1Y" },
  { id: "All", label: "All" },
];

export function formatDriftPp(pp: number): string {
  const rounded = Math.round(pp * 10) / 10;
  const abs = Math.abs(rounded);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${text} pp`;
}

export function driftCaption(row: PortfolioDriftRow): string {
  const target = formatBpPct(row.targetBp);
  const actual = formatBpPct(row.actualBp);
  const drift = formatDriftPp(row.driftPp);
  return row.hint
    ? `${actual} vs ${target} target · rebalance (${drift})`
    : `${actual} vs ${target} target · ${drift}`;
}

export function holdingValueCaption(row: Pick<PortfolioHoldingCard, "units" | "lastNav" | "value">): string {
  const units = formatUnits(row.units);
  if (row.lastNav != null) {
    return `${units} u · NAV ${formatInr(row.lastNav)}`;
  }
  return `${units} u · cost`;
}

export function gainCaption(gain: number, gainPct: number | null): string {
  const money = formatInr(gain);
  const shown = gain > 0 ? `+${money}` : money;
  if (gainPct == null) return shown;
  const pct = Math.round(gainPct * 1000) / 10;
  const abs = Math.abs(pct);
  const pctText = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  const pctShown = pct > 0 ? `+${pctText}%` : pct < 0 ? `−${pctText}%` : "0%";
  return `${shown} (${pctShown})`;
}

export function sparklinePoints(
  history: readonly NetWorthHistoryPoint[],
): { x: number; y: number }[] {
  if (history.length === 0) return [];
  const values = history.map((row) => row.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => ({
    x: history.length === 1 ? 0.5 : index / (history.length - 1),
    y: 1 - (value - min) / span,
  }));
}

export const PIE_COLORS = [
  "var(--accent)",
  "var(--ok)",
  "var(--warn)",
  "var(--seg-emi)",
  "var(--muted)",
  "var(--danger)",
] as const;

export type PieSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

export function pieSlices(
  data: Pick<PortfolioResponse, "holdings" | "fds" | "assets">,
  by: PieBy,
): PieSlice[] {
  const sums = new Map<string, { label: string; value: number }>();
  const add = (key: string, label: string, value: number) => {
    if (value <= 0) return;
    const cur = sums.get(key);
    if (cur) cur.value += value;
    else sums.set(key, { label, value });
  };
  const kindByAsset = new Map(data.assets.map((row) => [row.id, row.kind]));

  for (const row of data.holdings) {
    if (by === "account") add(row.accountId, row.accountName, row.value);
    else if (by === "kind") {
      const kind = kindByAsset.get(row.assetId) === "theme" ? "Theme" : "Core";
      add(kind, kind, row.value);
    } else add(row.assetId, row.assetName, row.value);
  }
  for (const row of data.fds) {
    if (by === "account") add(row.accountId, row.name, row.balance);
    else if (by === "kind") add("fd", "FD", row.balance);
    else add(`fd:${row.accountId}`, row.name, row.balance);
  }

  return [...sums.entries()]
    .sort((a, b) => b[1].value - a[1].value)
    .map(([key, row], i) => ({
      key,
      label: row.label,
      value: row.value,
      color: PIE_COLORS[i % PIE_COLORS.length] ?? "var(--accent)",
    }));
}

export function pieConic(slices: readonly PieSlice[]): string {
  const total = slices.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) return "var(--card-2)";
  let start = 0;
  const stops: string[] = [];
  for (const slice of slices) {
    const end = start + (slice.value / total) * 100;
    stops.push(`${slice.color} ${start}% ${end}%`);
    start = end;
  }
  return `conic-gradient(${stops.join(", ")})`;
}

export function parseNavRupees(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
