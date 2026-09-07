import {
  daysBetween,
  formatInr,
  type AccountGroup,
  type IsoDate,
  type Paise,
} from "../engine/index.ts";
import type { Account } from "../engine/types.ts";
import { reconCheckedDate } from "../engine/reconcile.ts";
import type { AccountBalanceRow as ApiAccountRow } from "../api/store.ts";

export const ACCOUNT_GROUP_ORDER: readonly AccountGroup[] = [
  "savings",
  "cash",
  "credit_card",
  "fd",
  "investment",
  "loan",
  "other",
  "virtual",
] as const;

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  savings: "Savings",
  cash: "Cash",
  credit_card: "Credit card",
  fd: "FD",
  investment: "Investment",
  loan: "Loan",
  other: "Other",
  virtual: "Virtual",
};

export const RECONCILE_STALE_DAYS = 14;

export type AccountBalanceRow = ApiAccountRow;

export type AccountGroupSection = {
  group: AccountGroup;
  label: string;
  accounts: AccountBalanceRow[];
};

export function groupAccountRows(
  rows: readonly AccountBalanceRow[],
): AccountGroupSection[] {
  const byGroup = new Map<AccountGroup, AccountBalanceRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group) ?? [];
    list.push(row);
    byGroup.set(row.group, list);
  }
  const sections: AccountGroupSection[] = [];
  for (const group of ACCOUNT_GROUP_ORDER) {
    const list = byGroup.get(group);
    if (!list || list.length === 0) continue;
    const sorted = list.slice().sort((a, b) => {
      if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    sections.push({
      group,
      label: ACCOUNT_GROUP_LABELS[group],
      accounts: sorted,
    });
  }
  return sections;
}

export function lastReconciledLabel(
  lastReconciledAt: string | null,
  today: IsoDate,
): { text: string; stale: boolean } {
  if (!lastReconciledAt) return { text: "Never reconciled", stale: true };
  const day = reconCheckedDate(lastReconciledAt);
  if (!day) return { text: "Never reconciled", stale: true };
  const days = daysBetween(day, today);
  if (days <= 0) return { text: "Today", stale: false };
  const text = days === 1 ? "1 d ago" : `${days} d ago`;
  return { text, stale: days > RECONCILE_STALE_DAYS };
}

export function formatUtilisation(utilisation: number | null): string | null {
  if (utilisation == null || !Number.isFinite(utilisation)) return null;
  return `${Math.round(utilisation * 100)}%`;
}

export function formatBalanceHero(row: Pick<Account, "type" | "group">, balance: Paise): {
  label: string;
  amount: string;
} {
  if (row.type === "liability") {
    return { label: "Due", amount: formatInr(balance) };
  }
  return { label: "Balance", amount: formatInr(balance) };
}

export function accountFlags(row: Pick<Account, "includeNetWorth" | "includeLiquid">): string[] {
  const flags: string[] = [];
  if (row.includeNetWorth) flags.push("NW");
  if (row.includeLiquid) flags.push("Liquid");
  return flags;
}

export function differenceHint(difference: Paise): string {
  if (difference === 0) return "Matches. Stamp today.";
  if (difference > 0) return `Bank is ${formatInr(difference)} higher.`;
  return `App is ${formatInr(-difference)} higher.`;
}

export function searchAmountQuery(paise: Paise): string {
  const abs = Math.abs(paise);
  const rupees = abs / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}
