import { isIsoDate, type IsoDate } from "./dates.ts";
import { ZERO_PAISE, type Paise } from "./money.ts";
import type { Account, LedgerEntry } from "./types.ts";

/** Ledger fields balances need. Extra entry fields are allowed. */
export type BalanceEntry = Pick<
  LedgerEntry,
  "date" | "amount" | "fromAccountId" | "toAccountId"
>;

export type AccountPosition = {
  accountId: string;
  /**
   * Opening ± ledger.
   * Asset / virtual: cash held (or counterpart running total).
   * Liability: amount owed.
   */
  balance: Paise;
  /** Credit-card only: limit − due. Null when the account is not a card or has no limit. */
  available: Paise | null;
  /** Credit-card only: due / limit. Null when there is no positive limit. */
  utilisation: number | null;
};

export type CreditCardPosition = {
  accountId: string;
  due: Paise;
  creditLimit: Paise | null;
  available: Paise | null;
  utilisation: number | null;
};

export type BalancesSnapshot = {
  /** Inclusive cutoff, or null when every ledger row is included (sheet behaviour). */
  asOf: IsoDate | null;
  positions: readonly AccountPosition[];
  /** Σ calculated balance where includeLiquid. Same SUMIFS as the sheet. */
  liquid: Paise;
  /** Σ due on credit-card accounts. */
  ccDue: Paise;
  cards: readonly CreditCardPosition[];
  /** Σ includeNetWorth asset balances. Holdings NAV is applied via applyHoldingsNav. */
  assets: Paise;
  /** Σ includeNetWorth liability dues. */
  liabilities: Paise;
  netWorth: Paise;
};

function isCreditCard(account: Account): boolean {
  return account.type === "liability" && account.group === "credit_card";
}

function includeByAsOf(date: string, asOf: IsoDate | undefined): boolean {
  if (asOf === undefined) return true;
  return date <= asOf;
}

function requireAsOf(asOf: IsoDate | undefined): IsoDate | undefined {
  if (asOf === undefined) return undefined;
  if (!isIsoDate(asOf)) {
    throw new Error(`invalid as-of date: ${asOf}`);
  }
  return asOf;
}

function signedBalance(account: Account, fromSum: Paise, toSum: Paise): Paise {
  if (account.type === "liability") {
    return account.openingBalance + fromSum - toSum;
  }
  return account.openingBalance + toSum - fromSum;
}

function cardMetrics(
  account: Account,
  due: Paise,
): { available: Paise | null; utilisation: number | null } {
  if (!isCreditCard(account) || account.creditLimit == null) {
    return { available: null, utilisation: null };
  }
  const available = account.creditLimit - due;
  const utilisation =
    account.creditLimit > 0 ? due / account.creditLimit : null;
  return { available, utilisation };
}

/** Asset: opening + Σ to − Σ from. Liability: opening + Σ from − Σ to. */
export function accountBalance(
  account: Account,
  entries: readonly BalanceEntry[],
  asOf?: IsoDate,
): Paise {
  const cutoff = requireAsOf(asOf);
  let fromSum: Paise = ZERO_PAISE;
  let toSum: Paise = ZERO_PAISE;
  for (const entry of entries) {
    if (!includeByAsOf(entry.date, cutoff)) continue;
    if (entry.fromAccountId === account.id) fromSum += entry.amount;
    if (entry.toAccountId === account.id) toSum += entry.amount;
  }
  return signedBalance(account, fromSum, toSum);
}

export function computeBalances(
  accounts: readonly Account[],
  entries: readonly BalanceEntry[],
  asOf?: IsoDate,
): BalancesSnapshot {
  const cutoff = requireAsOf(asOf);
  const positions: AccountPosition[] = [];
  const cards: CreditCardPosition[] = [];
  let liquid: Paise = ZERO_PAISE;
  let ccDue: Paise = ZERO_PAISE;
  let assets: Paise = ZERO_PAISE;
  let liabilities: Paise = ZERO_PAISE;

  for (const account of accounts) {
    const balance = accountBalance(account, entries, cutoff);
    const { available, utilisation } = cardMetrics(account, balance);
    positions.push({
      accountId: account.id,
      balance,
      available,
      utilisation,
    });

    if (account.includeLiquid) liquid += balance;
    if (account.includeNetWorth && account.type === "asset") assets += balance;
    if (account.includeNetWorth && account.type === "liability") {
      liabilities += balance;
    }

    if (isCreditCard(account)) {
      ccDue += balance;
      cards.push({
        accountId: account.id,
        due: balance,
        creditLimit: account.creditLimit,
        available,
        utilisation,
      });
    }
  }

  return {
    asOf: cutoff ?? null,
    positions,
    liquid,
    ccDue,
    cards,
    assets,
    liabilities,
    netWorth: assets - liabilities,
  };
}
