import type { AccountBalanceRow, WealthAccountLine, WealthBucketCard } from "../api/store.ts";
import {
  defaultIncludeLiquid,
  type AccountGroup,
  type Paise,
} from "../engine/index.ts";
import { nextFdName } from "./wealth.ts";

export const EMERGENCY_KINDS = ["savings", "fd", "investment"] as const;
export type EmergencyKind = (typeof EMERGENCY_KINDS)[number];

export const EMERGENCY_KIND_LABELS: Record<EmergencyKind, string> = {
  savings: "Savings",
  fd: "FD",
  investment: "Invested",
};

export type EmergencyHolding = {
  id: string;
  name: string;
  balance: Paise;
  group: AccountGroup;
};

export type EmergencyHoldingSection = {
  kind: EmergencyKind | "other";
  label: string;
  accounts: EmergencyHolding[];
};

const SECTION_ORDER: readonly (EmergencyKind | "other")[] = [
  "savings",
  "fd",
  "investment",
  "other",
];

export function isEmergencyKind(value: string): value is EmergencyKind {
  return (EMERGENCY_KINDS as readonly string[]).includes(value);
}

export function emergencyKindLabel(kind: EmergencyKind | "other"): string {
  if (kind === "other") return "Other";
  return EMERGENCY_KIND_LABELS[kind];
}

export function kindForGroup(group: AccountGroup): EmergencyKind | "other" {
  if (group === "savings" || group === "fd" || group === "investment") return group;
  return "other";
}

export function defaultHoldingName(
  kind: EmergencyKind,
  existing: readonly { name: string }[],
): string {
  if (kind === "fd") return nextFdName(existing);
  return "";
}

export function emergencyHoldings(
  bucket: Pick<WealthBucketCard, "accounts"> | null | undefined,
  known: readonly Pick<AccountBalanceRow | WealthAccountLine, "id" | "group">[],
): EmergencyHolding[] {
  if (!bucket) return [];
  const groupById = new Map(known.map((row) => [row.id, row.group]));
  return bucket.accounts.map((row) => ({
    id: row.id,
    name: row.name,
    balance: row.balance,
    group: groupById.get(row.id) ?? "other",
  }));
}

export function groupEmergencyHoldings(
  rows: readonly EmergencyHolding[],
): EmergencyHoldingSection[] {
  const byKind = new Map<EmergencyKind | "other", EmergencyHolding[]>();
  for (const row of rows) {
    const kind = kindForGroup(row.group);
    const list = byKind.get(kind) ?? [];
    list.push(row);
    byKind.set(kind, list);
  }
  const sections: EmergencyHoldingSection[] = [];
  for (const kind of SECTION_ORDER) {
    const accounts = (byKind.get(kind) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    if (accounts.length === 0) continue;
    sections.push({ kind, label: emergencyKindLabel(kind), accounts });
  }
  return sections;
}

export function emergencyTotal(rows: readonly Pick<EmergencyHolding, "balance">[]): Paise {
  return rows.reduce((sum, row) => sum + row.balance, 0);
}

export function emergencyIncludeLiquid(kind: EmergencyKind): boolean {
  return defaultIncludeLiquid(kind);
}
