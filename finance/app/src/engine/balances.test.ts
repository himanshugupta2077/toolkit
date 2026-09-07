import { describe, expect, it } from "vitest";
import { accountBalance, computeBalances, type BalanceEntry } from "./balances.ts";
import { rupeesToPaise } from "./money.ts";
import type { Account } from "./types.ts";

const OPENING = "2026-08-01";

function asset(
  id: string,
  name: string,
  group: Account["group"],
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name,
    type: "asset",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: true,
    includeLiquid: group === "savings" || group === "cash",
    group,
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
    ...extra,
  };
}

function liability(
  id: string,
  name: string,
  group: Account["group"],
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name,
    type: "liability",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: true,
    includeLiquid: false,
    group,
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind: null,
    ...extra,
  };
}

function virtual(
  id: string,
  name: string,
  virtualKind: NonNullable<Account["virtualKind"]>,
): Account {
  return {
    id,
    name,
    type: "virtual",
    openingBalance: 0,
    openingDate: OPENING,
    creditLimit: null,
    includeNetWorth: false,
    includeLiquid: false,
    group: "virtual",
    bucketId: null,
    statementDay: null,
    dueDay: null,
    isArchived: false,
    notes: "",
    virtualKind,
  };
}

function tx(
  date: string,
  amountRupees: number,
  fromAccountId: string,
  toAccountId: string,
): BalanceEntry {
  return {
    date,
    amount: rupeesToPaise(amountRupees),
    fromAccountId,
    toAccountId,
  };
}

function pos(snapshot: ReturnType<typeof computeBalances>, id: string) {
  const row = snapshot.positions.find((p) => p.accountId === id);
  if (!row) throw new Error(`missing position ${id}`);
  return row;
}

const savings = asset("acc_hdfc", "HDFC Savings", "savings", {
  openingBalance: rupeesToPaise(10000),
});
const card = liability("acc_hdfc_cc", "HDFC Credit Card", "credit_card", {
  openingBalance: rupeesToPaise(500),
  creditLimit: rupeesToPaise(100000),
  statementDay: 17,
  dueDay: 7,
});
const expense = virtual("acc_expense", "Expense", "expense");
const employer = virtual("acc_employer", "Employer", "employer");

/**
 * Two real accounts + a handful of movements.
 * HDFC: 10,000 + 5,000 − 1,200 − 500 = 13,300
 * CC due: 500 + 800 − 500 = 800
 */
const headlineAccounts = [savings, card, expense, employer];
const headlineEntries: BalanceEntry[] = [
  tx("2026-09-01", 5000, employer.id, savings.id),
  tx("2026-09-02", 1200, savings.id, expense.id),
  tx("2026-09-03", 800, card.id, expense.id),
  tx("2026-09-04", 500, savings.id, card.id),
];

describe("accountBalance", () => {
  it("uses opening when the ledger is empty", () => {
    expect(accountBalance(savings, [])).toBe(rupeesToPaise(10000));
    expect(accountBalance(card, [])).toBe(rupeesToPaise(500));
  });

  it("asset = opening + to − from, liability = opening + from − to", () => {
    expect(accountBalance(savings, headlineEntries)).toBe(rupeesToPaise(13300));
    expect(accountBalance(card, headlineEntries)).toBe(rupeesToPaise(800));
  });

  it("keeps sheet-style paise exact (no float)", () => {
    const hdfc = asset("acc_hdfc", "HDFC Savings", "savings", {
      openingBalance: rupeesToPaise(3851.96),
    });
    const rows = [tx("2026-09-03", 702.16, hdfc.id, expense.id)];
    expect(accountBalance(hdfc, rows)).toBe(314980);
  });

  it("asOf is inclusive and opening is always applied", () => {
    expect(accountBalance(savings, headlineEntries, "2026-09-01")).toBe(
      rupeesToPaise(15000),
    );
    expect(accountBalance(savings, headlineEntries, "2026-08-31")).toBe(
      rupeesToPaise(10000),
    );
    expect(accountBalance(card, headlineEntries, "2026-09-03")).toBe(
      rupeesToPaise(1300),
    );
  });

  it("rejects an invalid asOf date", () => {
    expect(() => accountBalance(savings, [], "2026-13-01")).toThrow(/as-of/);
  });

  it("ignores movements on unknown counterparties", () => {
    const rows = [
      tx("2026-09-06", 100, "ghost", savings.id),
      tx("2026-09-06", 40, savings.id, "ghost"),
    ];
    expect(accountBalance(savings, rows)).toBe(rupeesToPaise(10060));
  });
});

describe("computeBalances synthetic fixture", () => {
  it("matches two-account balances by paise", () => {
    const snap = computeBalances(headlineAccounts, headlineEntries);

    expect(pos(snap, savings.id).balance).toBe(rupeesToPaise(13300));
    expect(pos(snap, card.id).balance).toBe(rupeesToPaise(800));
    expect(snap.liquid).toBe(rupeesToPaise(13300));
    expect(snap.ccDue).toBe(rupeesToPaise(800));
    expect(snap.assets).toBe(rupeesToPaise(13300));
    expect(snap.liabilities).toBe(rupeesToPaise(800));
    expect(snap.netWorth).toBe(rupeesToPaise(12500));
    expect(snap.asOf).toBeNull();
  });

  it("computes CC available and utilisation", () => {
    const snap = computeBalances(headlineAccounts, headlineEntries);
    const cc = snap.cards[0];
    expect(cc.accountId).toBe(card.id);
    expect(cc.due).toBe(rupeesToPaise(800));
    expect(cc.creditLimit).toBe(rupeesToPaise(100000));
    expect(cc.available).toBe(rupeesToPaise(99200));
    expect(cc.utilisation).toBe(800 / 100000);
    expect(pos(snap, card.id).available).toBe(cc.available);
    expect(pos(snap, savings.id).available).toBeNull();
    expect(pos(snap, savings.id).utilisation).toBeNull();
  });
});

describe("liquid, CC due, net worth flags", () => {
  const icici = asset("acc_icici", "ICICI Savings", "savings", {
    openingBalance: rupeesToPaise(2000),
  });
  const cash = asset("acc_cash", "Cash", "cash", {
    openingBalance: rupeesToPaise(300),
  });
  const fd = asset("acc_fd", "FD", "fd", {
    openingBalance: rupeesToPaise(20000),
    includeLiquid: false,
  });
  const mf = asset("acc_mf", "Mutual Fund", "investment", {
    openingBalance: rupeesToPaise(5000),
    includeLiquid: false,
  });
  const loan = liability("acc_loan", "MacBook EMI", "loan", {
    openingBalance: rupeesToPaise(38200),
  });
  const iciciCc = liability("acc_icici_cc", "ICICI Credit Card", "credit_card", {
    openingBalance: rupeesToPaise(328.04),
    creditLimit: rupeesToPaise(100000),
  });
  const offBooks = asset("acc_off", "Hidden", "other", {
    openingBalance: rupeesToPaise(999),
    includeNetWorth: false,
    includeLiquid: false,
  });

  const accounts = [
    savings,
    icici,
    cash,
    fd,
    mf,
    card,
    iciciCc,
    loan,
    offBooks,
    expense,
    employer,
  ];

  const entries: BalanceEntry[] = [
    tx("2026-09-01", 1400, savings.id, icici.id),
    tx("2026-09-02", 200, cash.id, expense.id),
    tx("2026-09-03", 800, card.id, expense.id),
    tx("2026-09-04", 50, iciciCc.id, expense.id),
    tx("2026-09-05", 8000, savings.id, fd.id),
    tx("2026-09-06", 1000, savings.id, mf.id),
  ];

  it("liquid is only includeLiquid accounts", () => {
    const snap = computeBalances(accounts, entries);
    // HDFC 10000 − 1400 − 8000 − 1000 = −400; ICICI 2000 + 1400 = 3400; Cash 300 − 200 = 100
    expect(pos(snap, savings.id).balance).toBe(rupeesToPaise(-400));
    expect(pos(snap, icici.id).balance).toBe(rupeesToPaise(3400));
    expect(pos(snap, cash.id).balance).toBe(rupeesToPaise(100));
    expect(snap.liquid).toBe(rupeesToPaise(3100));
    expect(pos(snap, fd.id).balance).toBe(rupeesToPaise(28000));
    expect(pos(snap, mf.id).balance).toBe(rupeesToPaise(6000));
  });

  it("ccDue is credit cards only, not other liabilities", () => {
    const snap = computeBalances(accounts, entries);
    expect(pos(snap, card.id).balance).toBe(rupeesToPaise(1300));
    expect(pos(snap, iciciCc.id).balance).toBe(rupeesToPaise(378.04));
    expect(pos(snap, loan.id).balance).toBe(rupeesToPaise(38200));
    expect(snap.ccDue).toBe(rupeesToPaise(1678.04));
    expect(snap.cards.map((c) => c.accountId)).toEqual([card.id, iciciCc.id]);
  });

  it("net worth is includeNetWorth assets minus liabilities", () => {
    const snap = computeBalances(accounts, entries);
    // assets: −400 + 3400 + 100 + 28000 + 6000 = 37100 (offBooks excluded)
    // liabilities: 1300 + 378.04 + 38200 = 39878.04
    expect(snap.assets).toBe(rupeesToPaise(37100));
    expect(snap.liabilities).toBe(rupeesToPaise(39878.04));
    expect(snap.netWorth).toBe(rupeesToPaise(-2778.04));
    expect(pos(snap, offBooks.id).balance).toBe(rupeesToPaise(999));
  });

  it("virtual counterparties are not liquid and not net worth", () => {
    const snap = computeBalances(accounts, entries);
    expect(pos(snap, expense.id).balance).toBe(rupeesToPaise(1050));
    expect(pos(snap, employer.id).balance).toBe(0);
  });

  it("archived accounts still move liquid and net worth", () => {
    const oldCash = asset("acc_old_cash", "Old Cash", "cash", {
      openingBalance: rupeesToPaise(50),
      isArchived: true,
    });
    const snap = computeBalances([savings, oldCash], []);
    expect(snap.liquid).toBe(rupeesToPaise(10050));
    expect(snap.assets).toBe(rupeesToPaise(10050));
  });

  it("liquid SUMIFS includes a liability if that flag is on (sheet behaviour)", () => {
    const weird = liability("acc_weird", "Weird Card", "credit_card", {
      openingBalance: rupeesToPaise(10),
      includeLiquid: true,
      creditLimit: rupeesToPaise(1000),
    });
    const snap = computeBalances([savings, weird], []);
    expect(snap.liquid).toBe(rupeesToPaise(10010));
  });
});

describe("credit card edge cases", () => {
  it("null utilisation when limit is missing or zero", () => {
    const noLimit = liability("acc_cc_none", "No Limit Card", "credit_card", {
      openingBalance: rupeesToPaise(100),
      creditLimit: null,
    });
    const zeroLimit = liability("acc_cc_zero", "Zero Limit Card", "credit_card", {
      openingBalance: rupeesToPaise(100),
      creditLimit: 0,
    });
    const snap = computeBalances([noLimit, zeroLimit], []);
    expect(snap.cards[0].available).toBeNull();
    expect(snap.cards[0].utilisation).toBeNull();
    expect(snap.cards[1].available).toBe(rupeesToPaise(-100));
    expect(snap.cards[1].utilisation).toBeNull();
  });

  it("overpay (negative due) increases available", () => {
    const rows = [tx("2026-09-06", 800, savings.id, card.id)];
    const snap = computeBalances([savings, card], rows);
    expect(pos(snap, card.id).balance).toBe(rupeesToPaise(-300));
    expect(pos(snap, card.id).available).toBe(rupeesToPaise(100300));
    expect(snap.ccDue).toBe(rupeesToPaise(-300));
  });
});

describe("computeBalances asOf and empty", () => {
  it("returns zeros for no accounts", () => {
    const snap = computeBalances([], headlineEntries);
    expect(snap.positions).toEqual([]);
    expect(snap.liquid).toBe(0);
    expect(snap.ccDue).toBe(0);
    expect(snap.netWorth).toBe(0);
    expect(snap.cards).toEqual([]);
  });

  it("cuts off later ledger rows", () => {
    const snap = computeBalances(headlineAccounts, headlineEntries, "2026-09-02");
    expect(snap.asOf).toBe("2026-09-02");
    expect(pos(snap, savings.id).balance).toBe(rupeesToPaise(13800));
    expect(pos(snap, card.id).balance).toBe(rupeesToPaise(500));
    expect(snap.liquid).toBe(rupeesToPaise(13800));
    expect(snap.ccDue).toBe(rupeesToPaise(500));
  });
});
