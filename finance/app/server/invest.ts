import {
  computeBalances,
  DEFAULT_BUCKET_IDS,
  splitInvest,
  suggestDipDeploy,
  ZERO_PAISE,
  type InvestPlan,
  type InvestSplit,
  type IsoDate,
  type Paise,
} from "../src/engine/index.ts";
import { loadBooks } from "./books.ts";
import type { AppDb } from "./db/client.ts";
import {
  dipReserveBalance,
  listDipReserve,
  suggestedDipAccounts,
  type DipReserveLine,
} from "./repo/dip.ts";
import {
  getCurrentInvestPlan,
  getInvestPlanById,
  listInvestPlans,
} from "./repo/invest.ts";
import { listAllocationRuns } from "./repo/allocation.ts";
import { listAccounts } from "./repo/store.ts";

export type InvestAccountLine = {
  id: string;
  name: string;
  group: string;
  balance: Paise;
};

export type InvestPayload = {
  today: IsoDate;
  plan: InvestPlan | null;
  previousPlan: InvestPlan | null;
  lastInvestAmount: Paise;
  lastRunId: string | null;
  sipSplit: InvestSplit | null;
  dipBalance: Paise;
  dipHistory: DipReserveLine[];
  suggestedDip: ReturnType<typeof suggestDipDeploy> | null;
  accounts: InvestAccountLine[];
  suggestedFromAccountId: string | null;
  suggestedToAccountId: string | null;
};

function lastConfirmedInvestment(db: AppDb): {
  amount: Paise;
  runId: string | null;
  planId: string | null;
} {
  const run = listAllocationRuns(db).find((row) => row.status === "confirmed");
  if (!run) return { amount: ZERO_PAISE, runId: null, planId: null };
  const line = run.lines.find((row) => row.bucketId === DEFAULT_BUCKET_IDS.investment);
  return {
    amount: line?.confirmedAmount ?? ZERO_PAISE,
    runId: run.id,
    planId: run.investPlanId,
  };
}

function splitFor(plan: InvestPlan | null, amount: Paise): InvestSplit | null {
  if (!plan) return null;
  try {
    return splitInvest(amount, plan);
  } catch {
    return null;
  }
}

export function buildInvest(db: AppDb, today?: IsoDate, whatIfAmount?: Paise): InvestPayload {
  const books = loadBooks(db, today);
  const snap = computeBalances(books.accounts, books.entries, books.today);
  const balances: Record<string, Paise> = {};
  for (const row of snap.positions) balances[row.accountId] = row.balance;

  const versions = listInvestPlans(db);
  const current = versions[0] ?? getCurrentInvestPlan(db);
  const previous = versions[1] ?? null;
  const last = lastConfirmedInvestment(db);
  const planForSip =
    (last.planId ? getInvestPlanById(db, last.planId) : null) ?? current;
  const amount = whatIfAmount ?? last.amount;
  const sipSplit = amount > 0 ? splitFor(planForSip, amount) : splitFor(current, ZERO_PAISE);
  const suggestedDip =
    current && last.amount >= 0
      ? (() => {
          try {
            return suggestDipDeploy(ZERO_PAISE, current);
          } catch {
            return null;
          }
        })()
      : null;

  const picks = suggestedDipAccounts(db, balances);
  const positionById = new Map(snap.positions.map((row) => [row.accountId, row.balance]));
  const accounts: InvestAccountLine[] = listAccounts(db)
    .filter((account) => account.type !== "virtual" && !account.isArchived)
    .map((account) => ({
      id: account.id,
      name: account.name,
      group: account.group,
      balance: positionById.get(account.id) ?? ZERO_PAISE,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    today: books.today,
    plan: current,
    previousPlan: previous,
    lastInvestAmount: last.amount,
    lastRunId: last.runId,
    sipSplit,
    dipBalance: dipReserveBalance(db),
    dipHistory: listDipReserve(db),
    suggestedDip,
    accounts,
    suggestedFromAccountId: picks.fromAccountId,
    suggestedToAccountId: picks.toAccountId,
  };
}
