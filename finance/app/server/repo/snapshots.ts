import { asc, eq } from "drizzle-orm";
import {
  bucketCurrentBalances,
  DEFAULT_BUCKET_IDS,
  filterHistory,
  isHistoryRange,
  todayIst,
  ZERO_PAISE,
  type HistoryRange,
  type IsoDate,
  type Paise,
} from "../../src/engine/index.ts";
import type { AppDb } from "../db/client.ts";
import { netWorthDaily, snapshots } from "../db/schema.ts";
import { loadMarkedBooks } from "./holdings.ts";

export type NetWorthDailyRow = {
  date: IsoDate;
  assets: Paise;
  liabilities: Paise;
  liquid: Paise;
  invested: Paise;
  efBalance: Paise;
  savingsBalance: Paise;
};

function mapDaily(row: typeof netWorthDaily.$inferSelect): NetWorthDailyRow {
  return {
    date: row.date as IsoDate,
    assets: row.assets,
    liabilities: row.liabilities,
    liquid: row.liquid,
    invested: row.invested,
    efBalance: row.efBalance,
    savingsBalance: row.savingsBalance,
  };
}

export function listNetWorthDaily(db: AppDb): NetWorthDailyRow[] {
  return db
    .select()
    .from(netWorthDaily)
    .orderBy(asc(netWorthDaily.date))
    .all()
    .map(mapDaily);
}

export function netWorthHistory(
  db: AppDb,
  today: IsoDate,
  range: HistoryRange = "All",
): { date: IsoDate; netWorth: Paise }[] {
  return filterHistory(listNetWorthDaily(db), today, range).map((row) => ({
    date: row.date,
    netWorth: row.assets - row.liabilities,
  }));
}

export function parseHistoryRange(raw: string | undefined): HistoryRange {
  if (!raw || raw === "") return "All";
  if (!isHistoryRange(raw)) return "All";
  return raw;
}

/** Upsert today's (or `date`'s) account balances + net-worth daily row. */
export function takeSnapshot(db: AppDb, date?: IsoDate): NetWorthDailyRow {
  const { books, snap } = loadMarkedBooks(db, date);
  const day = books.today;
  const currentByBucket = bucketCurrentBalances(books.accounts, snap.positions);
  const positionById = new Map(snap.positions.map((row) => [row.accountId, row.balance]));
  let invested: Paise = ZERO_PAISE;
  for (const account of books.accounts) {
    if (account.group === "investment" || account.group === "fd") {
      invested += positionById.get(account.id) ?? ZERO_PAISE;
    }
  }
  const daily: NetWorthDailyRow = {
    date: day,
    assets: snap.assets,
    liabilities: snap.liabilities,
    liquid: snap.liquid,
    invested,
    efBalance: currentByBucket[DEFAULT_BUCKET_IDS.emergencyFund] ?? ZERO_PAISE,
    savingsBalance: currentByBucket[DEFAULT_BUCKET_IDS.savingsBuffer] ?? ZERO_PAISE,
  };

  db.transaction((tx) => {
    tx.delete(snapshots).where(eq(snapshots.date, day)).run();
    for (const position of snap.positions) {
      tx.insert(snapshots)
        .values({
          date: day,
          accountId: position.accountId,
          balance: position.balance,
        })
        .run();
    }
    tx.insert(netWorthDaily)
      .values({
        date: daily.date,
        assets: daily.assets,
        liabilities: daily.liabilities,
        liquid: daily.liquid,
        invested: daily.invested,
        efBalance: daily.efBalance,
        savingsBalance: daily.savingsBalance,
      })
      .onConflictDoUpdate({
        target: netWorthDaily.date,
        set: {
          assets: daily.assets,
          liabilities: daily.liabilities,
          liquid: daily.liquid,
          invested: daily.invested,
          efBalance: daily.efBalance,
          savingsBalance: daily.savingsBalance,
        },
      })
      .run();
  });

  return daily;
}

/** First open of the civil day writes a point; later opens leave it until a write. */
export function ensureTodaySnapshot(db: AppDb, today: IsoDate = todayIst()): NetWorthDailyRow {
  const existing = db.select().from(netWorthDaily).where(eq(netWorthDaily.date, today)).get();
  if (existing) return mapDaily(existing);
  return takeSnapshot(db, today);
}
