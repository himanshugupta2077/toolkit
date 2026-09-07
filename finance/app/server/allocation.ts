import {
  computeBalances,
  DEFAULT_BUCKET_IDS,
  freeToAllocate,
  splitInvest,
  ZERO_PAISE,
  type FreeToAllocate,
  type InvestPlan,
  type InvestSplit,
  type IsoDate,
  type Paise,
} from "../src/engine/index.ts";
import { loadBooks, toFreeCashBooks } from "./books.ts";
import type { AppDb } from "./db/client.ts";
import { getCurrentInvestPlan } from "./repo/invest.ts";
import {
  listAllocationRuns,
  suggestMoves,
  type AllocationRunView,
  type SuggestedMove,
} from "./repo/allocation.ts";
import { buildWealth, type WealthPayload } from "./wealth.ts";

export type AllocationPayload = WealthPayload & {
  freeCash: FreeToAllocate;
  canAllocate: boolean;
  investPlan: InvestPlan | null;
  investSplit: InvestSplit | null;
  suggested: SuggestedMove[];
  history: AllocationRunView[];
};

export function buildAllocation(db: AppDb, today?: IsoDate): AllocationPayload {
  const wealth = buildWealth(db, today);
  const books = loadBooks(db, today);
  const cash = freeToAllocate(toFreeCashBooks(books));
  const snap = computeBalances(books.accounts, books.entries, books.today);
  const balances: Record<string, Paise> = {};
  for (const row of snap.positions) balances[row.accountId] = row.balance;

  const investPlan = getCurrentInvestPlan(db);
  const investAmount =
    wealth.example.lines.find((row) => row.bucketId === DEFAULT_BUCKET_IDS.investment)?.amount ??
    ZERO_PAISE;
  const investSplit =
    investPlan && investAmount > 0 ? splitInvest(investAmount, investPlan) : null;

  return {
    ...wealth,
    freeCash: cash,
    canAllocate: cash.free > 0,
    investPlan,
    investSplit,
    suggested: suggestMoves(wealth.buckets, books.accounts, balances),
    history: listAllocationRuns(db),
  };
}
