import {
  bucketCurrentBalances,
  bucketFillPct,
  bucketMonthsFilled,
  freeToAllocate,
  resolveBucketTarget,
  runWaterfall,
  trailingEssentialsAverage,
  validateBuckets,
  ZERO_PAISE,
  type Account,
  type AccountGroup,
  type AccountType,
  type Bucket,
  type IsoDate,
  type Paise,
  type WaterfallResult,
} from "../src/engine/index.ts";
import { toFreeCashBooks } from "./books.ts";
import type { AppDb } from "./db/client.ts";
import { loadMarkedBooks } from "./repo/holdings.ts";
import { listEssentialCategoryIds } from "./repo/invest.ts";
import { ensureTodaySnapshot, netWorthHistory } from "./repo/snapshots.ts";

export type WealthAccountLine = {
  id: string;
  name: string;
  group: AccountGroup;
  type: AccountType;
  balance: Paise;
  includeNetWorth: boolean;
  includeLiquid: boolean;
  isArchived: boolean;
  bucketId: string | null;
};

export type WealthBucketCard = Bucket & {
  current: Paise;
  target: Paise | null;
  room: Paise | null;
  fillPct: number | null;
  monthsFilled: number | null;
  accounts: { id: string; name: string; balance: Paise }[];
  accountIds: string[];
};

export type WealthPayload = {
  today: IsoDate;
  netWorth: Paise;
  assetsTotal: Paise;
  liabilitiesTotal: Paise;
  assets: WealthAccountLine[];
  liabilities: WealthAccountLine[];
  buckets: WealthBucketCard[];
  linkableAccounts: WealthAccountLine[];
  free: Paise;
  essentialsAverage: Paise;
  example: WaterfallResult;
  netWorthHistory: { date: IsoDate; netWorth: Paise }[];
};

function toLine(
  account: Account,
  balance: Paise,
): WealthAccountLine {
  return {
    id: account.id,
    name: account.name,
    group: account.group,
    type: account.type,
    balance,
    includeNetWorth: account.includeNetWorth,
    includeLiquid: account.includeLiquid,
    isArchived: account.isArchived,
    bucketId: account.bucketId,
  };
}

function sortNw(a: WealthAccountLine, b: WealthAccountLine): number {
  if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
  return a.name.localeCompare(b.name);
}

export function buildWealth(db: AppDb, today?: IsoDate): WealthPayload {
  ensureTodaySnapshot(db, today);
  const { books, snap } = loadMarkedBooks(db, today);
  const currentByBucket = bucketCurrentBalances(books.accounts, snap.positions);
  const essentialIds = listEssentialCategoryIds(db);
  const trailing = trailingEssentialsAverage(
    books.today,
    books.entries,
    books.categories,
    essentialIds,
  );
  const positionById = new Map(snap.positions.map((row) => [row.accountId, row.balance]));
  const cash = freeToAllocate(toFreeCashBooks(books));
  const surplus = cash.free;

  const ordered = books.buckets.slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const bucketLines: WealthBucketCard[] = ordered.map((bucket) => {
    const current = currentByBucket[bucket.id] ?? ZERO_PAISE;
    const target = resolveBucketTarget(bucket, trailing.average);
    const room = target == null ? null : Math.max(0, target - current);
    const tagged = books.accounts
      .filter((account) => account.bucketId === bucket.id)
      .map((account) => ({
        id: account.id,
        name: account.name,
        balance: positionById.get(account.id) ?? ZERO_PAISE,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      ...bucket,
      current,
      target,
      room,
      fillPct: bucketFillPct(current, target),
      monthsFilled:
        bucket.targetRule === "months_of_essentials"
          ? bucketMonthsFilled(current, trailing.average)
          : null,
      accounts: tagged,
      accountIds: tagged.map((row) => row.id),
    };
  });

  const valid = validateBuckets(ordered);
  const example = valid.ok
    ? runWaterfall(surplus, ordered, currentByBucket, trailing.average)
    : {
        surplus,
        leftover: surplus,
        totalAllocated: ZERO_PAISE,
        lines: [],
      };

  const nwAccounts = books.accounts
    .filter((account) => account.type !== "virtual" && account.includeNetWorth)
    .map((account) => toLine(account, positionById.get(account.id) ?? ZERO_PAISE));

  const assets = nwAccounts.filter((row) => row.type === "asset").sort(sortNw);
  const liabilities = nwAccounts.filter((row) => row.type === "liability").sort(sortNw);

  const linkableAccounts = books.accounts
    .filter((account) => account.type !== "virtual")
    .map((account) => toLine(account, positionById.get(account.id) ?? ZERO_PAISE))
    .sort(sortNw);

  return {
    today: books.today,
    netWorth: snap.netWorth,
    assetsTotal: snap.assets,
    liabilitiesTotal: snap.liabilities,
    assets,
    liabilities,
    buckets: bucketLines,
    linkableAccounts,
    free: surplus,
    essentialsAverage: trailing.average,
    example,
    netWorthHistory: netWorthHistory(db, books.today, "3M"),
  };
}
