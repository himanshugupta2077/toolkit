import { addDays, daysBetween, isIsoDate, type IsoDate } from "./dates.ts";
import { isPaise, ZERO_PAISE, type Paise } from "./money.ts";
import type { AccountPosition, BalancesSnapshot } from "./balances.ts";
import {
  BP_SCALE,
  DRIFT_HINT_PP,
  UNIT_SCALE,
  type Account,
  type HistoryRange,
  type HoldingTxnKind,
  type InvestAsset,
} from "./types.ts";

export type HoldingTxnLike = {
  kind: HoldingTxnKind;
  units: number;
  amount: Paise;
  nav: Paise;
};

export type HoldingSummary = {
  units: number;
  cost: Paise;
  avgCost: Paise;
  value: Paise;
  gain: Paise;
  gainPct: number | null;
};

export type HoldingOverlay = {
  accountId: string;
  cost: Paise;
  value: Paise;
};

export type DriftRow = {
  assetId: string;
  name: string;
  targetBp: number;
  actualBp: number;
  /** actual% − target% in percentage points (25% vs 20% → 5). */
  driftPp: number;
  hint: boolean;
};

export type NetWorthPoint = {
  date: IsoDate;
  netWorth: Paise;
};

function requirePaise(value: Paise, label: string): Paise {
  if (!isPaise(value)) {
    throw new Error(`${label} must be integer paise`);
  }
  return value;
}

function requireUnits(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be integer micro-units`);
  }
  return value;
}

/** Units bought with `amount` at `nav` (both paise). */
export function unitsFromAmount(amount: Paise, nav: Paise): number {
  requirePaise(amount, "amount");
  requirePaise(nav, "nav");
  if (amount < 0) throw new Error("amount must be ≥ 0");
  if (nav <= 0) throw new Error("nav must be positive paise");
  return Math.round((amount * UNIT_SCALE) / nav);
}

/** Mark-to-market value: units × NAV / 1e6, half-up to paise. */
export function valueFromUnits(units: number, nav: Paise): Paise {
  requireUnits(units, "units");
  requirePaise(nav, "nav");
  if (nav < 0) throw new Error("nav must be ≥ 0");
  return Math.round((units * nav) / UNIT_SCALE);
}

/** Average cost per unit, in paise (same unit as NAV). */
export function avgCostPaise(cost: Paise, units: number): Paise {
  requirePaise(cost, "cost");
  requireUnits(units, "units");
  if (units <= 0) return ZERO_PAISE;
  return Math.round((cost * UNIT_SCALE) / units);
}

function slugName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Match a holding to the current plan by id, then by name slug. */
export function matchPlanAssetId(
  planAssets: readonly Pick<InvestAsset, "id" | "name">[],
  holdingAssetId: string,
  holdingAssetName: string,
): string | null {
  if (planAssets.some((row) => row.id === holdingAssetId)) return holdingAssetId;
  const slug = slugName(holdingAssetName);
  if (!slug) return null;
  const match = planAssets.find((row) => slugName(row.name) === slug);
  return match?.id ?? null;
}

/**
 * Remaining units / cost (average-cost sells). Dividends are ignored.
 * Value is NAV × units when NAV is set; otherwise cost (ledger cost).
 */
export function summarizeHolding(
  txns: readonly HoldingTxnLike[],
  lastNav: Paise | null,
): HoldingSummary {
  let units = 0;
  let cost: Paise = ZERO_PAISE;
  for (const txn of txns) {
    requirePaise(txn.amount, "txn amount");
    requireUnits(txn.units, "txn units");
    if (txn.kind === "dividend") continue;
    if (txn.kind === "sell") {
      if (txn.units > units) {
        throw new Error("cannot sell more units than held");
      }
      const soldCost =
        units === 0 ? ZERO_PAISE : Math.round((cost * txn.units) / units);
      units -= txn.units;
      cost -= soldCost;
    } else {
      units += txn.units;
      cost += txn.amount;
    }
  }
  const navKnown = lastNav != null && lastNav > 0 && units > 0;
  const value: Paise = navKnown ? valueFromUnits(units, lastNav) : cost;
  const gain = value - cost;
  return {
    units,
    cost,
    avgCost: avgCostPaise(cost, units),
    value,
    gain,
    gainPct: cost > 0 ? gain / cost : null,
  };
}

/**
 * Replace ledger cost with current value on accounts that have holdings.
 * `newBalance = ledger − holdings cost + holdings value`. No NAV → no change.
 */
export function applyHoldingsNav(
  snap: BalancesSnapshot,
  accounts: readonly Account[],
  overlays: readonly HoldingOverlay[],
): BalancesSnapshot {
  const byAccount = new Map<string, { cost: Paise; value: Paise }>();
  for (const row of overlays) {
    requirePaise(row.cost, `overlay cost ${row.accountId}`);
    requirePaise(row.value, `overlay value ${row.accountId}`);
    const cur = byAccount.get(row.accountId) ?? { cost: ZERO_PAISE, value: ZERO_PAISE };
    cur.cost += row.cost;
    cur.value += row.value;
    byAccount.set(row.accountId, cur);
  }

  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const positions: AccountPosition[] = snap.positions.map((position) => {
    const overlay = byAccount.get(position.accountId);
    if (!overlay) return position;
    return {
      ...position,
      balance: position.balance - overlay.cost + overlay.value,
    };
  });

  let liquid: Paise = ZERO_PAISE;
  let ccDue: Paise = ZERO_PAISE;
  let assets: Paise = ZERO_PAISE;
  let liabilities: Paise = ZERO_PAISE;
  const cards = snap.cards.map((card) => {
    const position = positions.find((row) => row.accountId === card.accountId);
    const due = position?.balance ?? card.due;
    return {
      ...card,
      due,
      available: card.creditLimit == null ? null : card.creditLimit - due,
      utilisation:
        card.creditLimit != null && card.creditLimit > 0 ? due / card.creditLimit : null,
    };
  });

  for (const position of positions) {
    const account = accountById.get(position.accountId);
    if (!account) continue;
    if (account.includeLiquid) liquid += position.balance;
    if (account.includeNetWorth && account.type === "asset") assets += position.balance;
    if (account.includeNetWorth && account.type === "liability") {
      liabilities += position.balance;
    }
    if (account.type === "liability" && account.group === "credit_card") {
      ccDue += position.balance;
    }
  }

  return {
    ...snap,
    positions,
    liquid,
    ccDue,
    cards,
    assets,
    liabilities,
    netWorth: assets - liabilities,
  };
}

/**
 * Actual vs target weights of the current plan. Holdings mapped onto plan
 * asset ids by the caller. Hint when |drift| > 5 percentage points.
 */
export function allocationDrift(
  planAssets: readonly Pick<InvestAsset, "id" | "name" | "targetBp" | "active">[],
  valuesByAssetId: Readonly<Record<string, Paise>>,
): DriftRow[] {
  const active = planAssets.filter((row) => row.active);
  const totalTarget = active.reduce((sum, row) => sum + row.targetBp, 0);
  const totalValue = active.reduce(
    (sum, row) => sum + (valuesByAssetId[row.id] ?? ZERO_PAISE),
    0,
  );

  return active.map((row) => {
    const targetBp =
      totalTarget <= 0 ? 0 : Math.round((row.targetBp * BP_SCALE) / totalTarget);
    const value = valuesByAssetId[row.id] ?? ZERO_PAISE;
    const actualBp = totalValue <= 0 ? 0 : Math.round((value * BP_SCALE) / totalValue);
    const driftPp = (actualBp - targetBp) / 100;
    return {
      assetId: row.id,
      name: row.name,
      targetBp,
      actualBp,
      driftPp,
      hint: Math.abs(driftPp) > DRIFT_HINT_PP,
    };
  });
}

export function historyCutoff(today: IsoDate, range: HistoryRange): IsoDate | null {
  if (!isIsoDate(today)) throw new Error(`invalid today: ${today}`);
  if (range === "All") return null;
  if (range === "1M") return addDays(today, -30);
  if (range === "3M") return addDays(today, -90);
  if (range === "6M") return addDays(today, -180);
  return addDays(today, -365);
}

export function filterHistory<T extends { date: IsoDate }>(
  rows: readonly T[],
  today: IsoDate,
  range: HistoryRange,
): T[] {
  const cut = historyCutoff(today, range);
  return rows.filter((row) => cut == null || row.date >= cut);
}

export function fdMaturityCaption(today: IsoDate, maturity: IsoDate | null): string | null {
  if (maturity == null || maturity === "") return null;
  if (!isIsoDate(today) || !isIsoDate(maturity)) return null;
  const days = daysBetween(today, maturity);
  if (days > 1) return `matures in ${days} days`;
  if (days === 1) return "matures in 1 day";
  if (days === 0) return "matures today";
  const ago = -days;
  if (ago === 1) return "matured 1 day ago";
  return `matured ${ago} days ago`;
}

export function formatUnits(units: number): string {
  requireUnits(units, "units");
  const whole = units / UNIT_SCALE;
  const text = whole.toFixed(6).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}
