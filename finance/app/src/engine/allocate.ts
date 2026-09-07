import { isPaise, ZERO_PAISE, type Paise } from "./money.ts";
import {
  INVESTMENT_CATEGORY_NAME,
  type Account,
  type AccountGroup,
  type Category,
  type LedgerType,
} from "./types.ts";
import { DEFAULT_BUCKET_IDS } from "./waterfall.ts";

function requirePaise(value: Paise, label: string): Paise {
  if (!isPaise(value)) {
    throw new Error(`${label} must be integer paise`);
  }
  return value;
}

function nameIncludes(name: string, needle: string): boolean {
  return name.trim().toLowerCase().includes(needle);
}

/** Transfer vs Investment from the destination account group. */
export function allocationLedgerType(
  to: Pick<Account, "group">,
): Extract<LedgerType, "transfer" | "investment"> {
  if (to.group === "fd" || to.group === "investment") return "investment";
  return "transfer";
}

export function findInvestmentCategory(
  categories: readonly Pick<Category, "id" | "name" | "isArchived">[],
): Pick<Category, "id" | "name"> | null {
  const expected = INVESTMENT_CATEGORY_NAME.trim().toLowerCase();
  const live = categories.filter((row) => !row.isArchived);
  return live.find((row) => row.name.trim().toLowerCase() === expected) ?? null;
}

/** Where leftover for this bucket should sit, if nothing is tagged. */
export function destinationGroupsForBucket(
  bucket: Pick<{ id: string; name: string }, "id" | "name">,
): AccountGroup[] {
  if (
    bucket.id === DEFAULT_BUCKET_IDS.emergencyFund ||
    nameIncludes(bucket.name, "emergency")
  ) {
    return ["fd"];
  }
  if (
    bucket.id === DEFAULT_BUCKET_IDS.savingsBuffer ||
    nameIncludes(bucket.name, "savings")
  ) {
    return ["savings", "cash"];
  }
  return ["investment", "fd"];
}

function usableAsset(
  account: Account,
  excludeId: string | null | undefined,
): boolean {
  if (account.isArchived) return false;
  if (account.type === "virtual") return false;
  if (excludeId && account.id === excludeId) return false;
  return true;
}

function fromScore(account: Account, balance: Paise): number {
  let score = balance;
  if (account.includeLiquid) score += 1_000_000_000;
  if (nameIncludes(account.name, "hdfc")) score += 1_000_000;
  if (nameIncludes(account.name, "savings")) score += 10_000;
  return score;
}

/**
 * Liquid unassigned cash first (HDFC Savings when present), then any asset.
 */
export function suggestFromAccount(
  accounts: readonly Account[],
  balances: Readonly<Record<string, Paise>>,
  excludeId?: string | null,
): Account | null {
  const candidates = accounts.filter((row) => usableAsset(row, excludeId));
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => {
    const aBal = requirePaise(balances[a.id] ?? ZERO_PAISE, `balance for ${a.id}`);
    const bBal = requirePaise(balances[b.id] ?? ZERO_PAISE, `balance for ${b.id}`);
    const diff = fromScore(b, bBal) - fromScore(a, aBal);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  })[0] ?? null;
}

/**
 * Tagged account for the bucket, else a matching group (FD / savings / invest).
 */
export function suggestToAccount(
  bucket: Pick<{ id: string; name: string }, "id" | "name">,
  accounts: readonly Account[],
  fromId?: string | null,
): Account | null {
  const usable = accounts.filter((row) => usableAsset(row, fromId));
  const tagged = usable.filter((row) => row.bucketId === bucket.id);
  if (tagged.length > 0) {
    return tagged.slice().sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
  }
  const groups = new Set(destinationGroupsForBucket(bucket));
  const byGroup = usable.filter((row) => groups.has(row.group));
  if (byGroup.length === 0) return null;
  return byGroup.slice().sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}
