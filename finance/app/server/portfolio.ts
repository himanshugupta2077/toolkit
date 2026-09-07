import {
  allocationDrift,
  fdMaturityCaption,
  matchPlanAssetId,
  ZERO_PAISE,
  type DriftRow,
  type HistoryRange,
  type IsoDate,
  type Paise,
} from "../src/engine/index.ts";
import type { AppDb } from "./db/client.ts";
import {
  getHolding,
  listHoldings,
  listHoldingTxns,
  loadMarkedBooks,
  summarizeHoldingRow,
  type HoldingRow,
  type HoldingTxnRow,
} from "./repo/holdings.ts";
import { getCurrentInvestPlan } from "./repo/invest.ts";
import { ensureTodaySnapshot, netWorthHistory } from "./repo/snapshots.ts";

export type PortfolioHoldingCard = HoldingRow & {
  accountName: string;
  accountGroup: string;
  units: number;
  avgCost: Paise;
  cost: Paise;
  value: Paise;
  gain: Paise;
  gainPct: number | null;
};

export type PortfolioFdCard = {
  accountId: string;
  name: string;
  balance: Paise;
  maturityDate: IsoDate | null;
  daysCaption: string | null;
};

export type PortfolioPayload = {
  today: IsoDate;
  value: Paise;
  invested: Paise;
  gain: Paise;
  gainPct: number | null;
  netWorth: Paise;
  holdings: PortfolioHoldingCard[];
  fds: PortfolioFdCard[];
  drift: DriftRow[];
  history: { date: IsoDate; netWorth: Paise }[];
  planId: string | null;
  assets: { id: string; name: string; kind: string }[];
  accounts: { id: string; name: string; group: string }[];
};

export type HoldingDetailPayload = {
  today: IsoDate;
  holding: PortfolioHoldingCard;
  txns: HoldingTxnRow[];
  netWorth: Paise;
  accounts: { id: string; name: string; group: string }[];
};

function toCard(
  holding: HoldingRow,
  accountName: string,
  accountGroup: string,
  summary: ReturnType<typeof summarizeHoldingRow>,
): PortfolioHoldingCard {
  return {
    ...holding,
    accountName,
    accountGroup,
    units: summary.units,
    avgCost: summary.avgCost,
    cost: summary.cost,
    value: summary.value,
    gain: summary.gain,
    gainPct: summary.gainPct,
  };
}

export function buildPortfolio(db: AppDb, range: HistoryRange = "All"): PortfolioPayload {
  ensureTodaySnapshot(db);
  const { books, snap } = loadMarkedBooks(db);
  const positionById = new Map(snap.positions.map((row) => [row.accountId, row.balance]));
  const accountById = new Map(books.accounts.map((row) => [row.id, row]));
  const plan = getCurrentInvestPlan(db);
  const holdings = listHoldings(db).map((holding) => {
    const account = accountById.get(holding.accountId);
    return toCard(
      holding,
      account?.name ?? holding.accountId,
      account?.group ?? "",
      summarizeHoldingRow(db, holding),
    );
  });

  const valuesByAssetId: Record<string, Paise> = {};
  if (plan) {
    for (const holding of holdings) {
      const assetId = matchPlanAssetId(plan.assets, holding.assetId, holding.assetName);
      if (!assetId) continue;
      valuesByAssetId[assetId] = (valuesByAssetId[assetId] ?? ZERO_PAISE) + holding.value;
    }
  }
  const drift = plan ? allocationDrift(plan.assets, valuesByAssetId) : [];

  const invested = holdings.reduce((sum, row) => sum + row.cost, ZERO_PAISE);
  const value = holdings.reduce((sum, row) => sum + row.value, ZERO_PAISE);
  const gain = value - invested;

  const fds: PortfolioFdCard[] = books.accounts
    .filter((account) => account.group === "fd" && !account.isArchived)
    .map((account) => {
      const maturity = account.maturityDate ?? null;
      return {
        accountId: account.id,
        name: account.name,
        balance: positionById.get(account.id) ?? ZERO_PAISE,
        maturityDate: maturity,
        daysCaption: fdMaturityCaption(books.today, maturity),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    today: books.today,
    value,
    invested,
    gain,
    gainPct: invested > 0 ? gain / invested : null,
    netWorth: snap.netWorth,
    holdings,
    fds,
    drift,
    history: netWorthHistory(db, books.today, range),
    planId: plan?.id ?? null,
    assets: (plan?.assets ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
    })),
    accounts: books.accounts
      .filter((account) => account.type !== "virtual" && !account.isArchived)
      .map((account) => ({ id: account.id, name: account.name, group: account.group })),
  };
}

export function buildHoldingDetail(db: AppDb, id: string): HoldingDetailPayload | null {
  ensureTodaySnapshot(db);
  const holding = getHolding(db, id);
  if (!holding) return null;
  const { books, snap } = loadMarkedBooks(db);
  const account = books.accounts.find((row) => row.id === holding.accountId);
  const card = toCard(
    holding,
    account?.name ?? holding.accountId,
    account?.group ?? "",
    summarizeHoldingRow(db, holding),
  );
  return {
    today: books.today,
    holding: card,
    txns: listHoldingTxns(db, id),
    netWorth: snap.netWorth,
    accounts: books.accounts
      .filter((account) => account.type !== "virtual" && !account.isArchived)
      .map((account) => ({ id: account.id, name: account.name, group: account.group })),
  };
}
