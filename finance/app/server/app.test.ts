/** @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { computeBalances } from "../src/engine/balances.ts";
import {
  addDays,
  DEFAULT_ASSET_IDS,
  DEFAULT_BUCKET_IDS,
  GOLD_ASSET_NAME,
  inactivateGold,
  normaliseActiveTargets,
  seedDefaultInvestPlan,
  suggestDipDeploy,
  todayIst,
} from "../src/engine/index.ts";
import { rupeesToPaise } from "../src/engine/money.ts";
import { insertAccount } from "./repo/accounts.ts";
import { createApp } from "./app.ts";
import { backupDatabase } from "./db/backup.ts";
import { openDatabase, type OpenedDb } from "./db/client.ts";
import { DUMMY_EXPENSE_PAISE, SEED_IDS, ensureCatalog } from "./db/seed.ts";
import { netWorthDaily } from "./db/schema.ts";
import { insertLedgerEntry } from "./repo/store.ts";

const opened: OpenedDb[] = [];
const tmpDirs: string[] = [];

afterEach(() => {
  for (const db of opened.splice(0)) db.sqlite.close();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "finance-p9-"));
  tmpDirs.push(dir);
  return dir;
}

function harness(file = ":memory:") {
  const db = openDatabase(file);
  opened.push(db);
  ensureCatalog(db.db);
  const app = createApp(db);
  return { ...db, app };
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("server store", () => {
  it("serves health after migrate + seed", async () => {
    const { app, dbFile } = harness();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.schemaVersion).toBe("6");
    expect(body.dbFile).toBe(dbFile);
  });

  it("GET /api/books returns the seed catalog", async () => {
    const { app } = harness();
    const res = await app.request("/api/books");
    const body = (await json(res)) as {
      books: { accounts: { id: string }[]; entries: unknown[] };
    };
    expect(res.status).toBe(200);
    const ids = body.books.accounts.map((a) => a.id);
    expect(ids).toContain(SEED_IDS.hdfcSavings);
    expect(ids).toContain(SEED_IDS.expense);
    expect(body.books.entries).toEqual([]);
  });

  it("POST /api/ledger writes an in-budget expense and month spent moves", async () => {
    const { app } = harness();
    const empty = await json(await app.request("/api/month/2026-09"));
    expect((empty.summary as { budgetSpent: number }).budgetSpent).toBe(0);

    const created = await app.request("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "expense",
        amount: rupeesToPaise(250),
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: "test",
      }),
    });
    expect(created.status).toBe(201);
    const month = await json(await app.request("/api/month/2026-09"));
    expect((month.summary as { budgetSpent: number }).budgetSpent).toBe(
      rupeesToPaise(250),
    );
  });

  it("POST /api/ledger rejects from === to", async () => {
    const { app } = harness();
    const res = await app.request("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "expense",
        amount: 100,
        fromAccountId: SEED_IDS.expense,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
      }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    const issues = body.issues as { code: string }[];
    expect(issues.some((i) => i.code === "from_equals_to")).toBe(true);
  });

  it("dummy expense changes this month's budgetSpent", async () => {
    const { app } = harness();
    const before = await json(await app.request("/api/dev/counts"));
    expect((before.counts as { ledgerEntries: number }).ledgerEntries).toBe(0);

    const res = await app.request("/api/dev/dummy-expense", { method: "POST" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect((body.entry as { amount: number }).amount).toBe(DUMMY_EXPENSE_PAISE);
    expect((body.summary as { budgetSpent: number }).budgetSpent).toBe(
      DUMMY_EXPENSE_PAISE,
    );
  });

  it("wipe requires typing wipe and then ledger is empty", async () => {
    const { app } = harness();
    await app.request("/api/dev/dummy-expense", { method: "POST" });

    const refused = await app.request("/api/dev/wipe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "please" }),
    });
    expect(refused.status).toBe(400);

    const ok = await app.request("/api/dev/wipe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "wipe" }),
    });
    expect(ok.status).toBe(200);
    const counts = await json(await app.request("/api/dev/counts"));
    expect((counts.counts as { ledgerEntries: number }).ledgerEntries).toBe(0);
    expect((counts.counts as { accounts: number }).accounts).toBeGreaterThan(0);
  });

  it("keeps the dummy row after reopening the sqlite file", async () => {
    const dir = tmpDir();
    const file = join(dir, "finance.sqlite");
    const first = harness(file);
    await first.app.request("/api/dev/dummy-expense", { method: "POST" });
    first.sqlite.close();
    opened.splice(opened.indexOf(first), 1);

    const second = harness(file);
    const counts = await json(await second.app.request("/api/dev/counts"));
    expect((counts.counts as { ledgerEntries: number }).ledgerEntries).toBe(1);
    const books = (await json(await second.app.request("/api/books"))) as {
      books: { entries: { notes: string }[] };
    };
    expect(books.books.entries[0]?.notes).toBe("Phase 9 dummy");
  });

  it("GET /api/export.sqlite is a SQLite file", async () => {
    const { app } = harness();
    const res = await app.request("/api/export.sqlite");
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
  });

  it("VACUUM INTO backup contains the dummy row", async () => {
    const dir = tmpDir();
    const { sqlite, app } = harness();
    await app.request("/api/dev/dummy-expense", { method: "POST" });
    const dest = backupDatabase(sqlite, dir);
    const copy = new Database(dest, { readonly: true });
    const row = copy
      .prepare(
        "SELECT notes, amount FROM ledger_entries WHERE deleted_at IS NULL",
      )
      .get() as { notes: string; amount: number };
    expect(row.notes).toBe("Phase 9 dummy");
    expect(row.amount).toBe(DUMMY_EXPENSE_PAISE);
    copy.close();
  });
});

describe("ledger list / edit / delete", () => {
  it("GET /api/ledger returns a month of rows including 160 without dropping any", async () => {
    const { app, db } = harness();
    for (let i = 0; i < 160; i += 1) {
      insertLedgerEntry(db, {
        date: "2026-08-02",
        time: null,
        type: "expense",
        amount: rupeesToPaise(1),
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: `row ${i}`,
        source: "excel",
      });
    }
    const res = await app.request("/api/ledger?month=2026-08");
    expect(res.status).toBe(200);
    const body = (await json(res)) as { entries: { notes: string }[] };
    expect(body.entries).toHaveLength(160);
  });

  it("PATCH keeps an edited note after reopening sqlite; DELETE is soft and balances move", async () => {
    const dir = tmpDir();
    const file = join(dir, "finance.sqlite");
    const first = harness(file);
    const created = await first.app.request("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "expense",
        amount: rupeesToPaise(50),
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: "",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await json(created)) as { entry: { id: string } };
    const id = createdBody.entry.id;

    const booksBefore = (await json(await first.app.request("/api/books"))) as {
      books: {
        accounts: Parameters<typeof computeBalances>[0];
        entries: Parameters<typeof computeBalances>[1];
      };
    };
    const hdfcBefore = computeBalances(
      booksBefore.books.accounts,
      booksBefore.books.entries,
    ).positions.find((p) => p.accountId === SEED_IDS.hdfcSavings);
    expect(hdfcBefore?.balance).toBe(rupeesToPaise(-50));

    const patched = await first.app.request(`/api/ledger/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "expense",
        amount: rupeesToPaise(50),
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: "haircut",
      }),
    });
    expect(patched.status).toBe(200);
    first.sqlite.close();
    opened.splice(opened.indexOf(first), 1);

    const second = harness(file);
    const got = await second.app.request(`/api/ledger/${id}`);
    expect(got.status).toBe(200);
    const gotBody = (await json(got)) as { entry: { notes: string } };
    expect(gotBody.entry.notes).toBe("haircut");

    const month = await json(await second.app.request("/api/month/2026-09"));
    expect((month.summary as { budgetSpent: number }).budgetSpent).toBe(
      rupeesToPaise(50),
    );

    const deleted = await second.app.request(`/api/ledger/${id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect((await second.app.request(`/api/ledger/${id}`)).status).toBe(404);

    const list = (await json(await second.app.request("/api/ledger?month=2026-09"))) as {
      entries: unknown[];
    };
    expect(list.entries).toHaveLength(0);

    const booksAfter = (await json(await second.app.request("/api/books"))) as {
      books: {
        accounts: Parameters<typeof computeBalances>[0];
        entries: Parameters<typeof computeBalances>[1];
      };
    };
    const hdfcAfter = computeBalances(
      booksAfter.books.accounts,
      booksAfter.books.entries,
    ).positions.find((p) => p.accountId === SEED_IDS.hdfcSavings);
    expect(hdfcAfter?.balance).toBe(0);
    const monthAfter = await json(await second.app.request("/api/month/2026-09"));
    expect((monthAfter.summary as { budgetSpent: number }).budgetSpent).toBe(0);

    const raw = second.sqlite
      .prepare("SELECT deleted_at, notes FROM ledger_entries WHERE id = ?")
      .get(id) as { deleted_at: string | null; notes: string };
    expect(raw.notes).toBe("haircut");
    expect(raw.deleted_at).toBeTruthy();
  });

  it("PATCH rejects an illegal From/To", async () => {
    const { app } = harness();
    const created = await app.request("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "expense",
        amount: rupeesToPaise(50),
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: "",
      }),
    });
    const id = ((await json(created)) as { entry: { id: string } }).entry.id;
    const res = await app.request(`/api/ledger/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "expense",
        amount: rupeesToPaise(50),
        fromAccountId: SEED_IDS.expense,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: "",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("accounts + reconcile", () => {
  it("GET /api/accounts/balances lists seed HDFC Savings", async () => {
    const { app } = harness();
    const res = await app.request("/api/accounts/balances");
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      liquid: number;
      accounts: { id: string; name: string; balance: number }[];
    };
    expect(body.accounts.some((row) => row.id === SEED_IDS.hdfcSavings)).toBe(true);
    expect(body.liquid).toBe(0);
  });

  it("stamps when the gap is 0 and refuses a stamp when it is not", async () => {
    const { app } = harness();
    const stamped = await app.request("/api/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: SEED_IDS.hdfcSavings,
        actualBalance: 0,
        resolution: "none",
      }),
    });
    expect(stamped.status).toBe(200);
    const stampBody = (await json(stamped)) as {
      reconciliation: { difference: number; resolution: string; checkedAt: string };
      balance: number;
    };
    expect(stampBody.reconciliation.difference).toBe(0);
    expect(stampBody.reconciliation.resolution).toBe("none");
    expect(stampBody.reconciliation.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(stampBody.balance).toBe(0);

    const refused = await app.request("/api/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: SEED_IDS.hdfcSavings,
        actualBalance: rupeesToPaise(200),
        resolution: "none",
      }),
    });
    expect(refused.status).toBe(400);
  });

  it("adjustment closes the HDFC Savings gap in one transaction", async () => {
    const dir = tmpDir();
    const file = join(dir, "finance.sqlite");
    const first = harness(file);
    const created = await first.app.request("/api/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: SEED_IDS.hdfcSavings,
        actualBalance: rupeesToPaise(200),
        resolution: "adjustment",
        notes: "bank vs app",
      }),
    });
    expect(created.status).toBe(200);
    const body = (await json(created)) as {
      balance: number;
      liquid: number;
      entry: { type: string; amount: number; fromAccountId: string; toAccountId: string };
      reconciliation: { resolution: string; difference: number; adjustmentEntryId: string | null };
    };
    expect(body.entry.type).toBe("adjustment");
    expect(body.entry.amount).toBe(rupeesToPaise(200));
    expect(body.entry.toAccountId).toBe(SEED_IDS.hdfcSavings);
    expect(body.entry.fromAccountId).toBe(SEED_IDS.external);
    expect(body.reconciliation.resolution).toBe("adjustment");
    expect(body.reconciliation.difference).toBe(rupeesToPaise(200));
    expect(body.reconciliation.adjustmentEntryId).toBeTruthy();
    expect(body.balance).toBe(rupeesToPaise(200));
    expect(body.liquid).toBe(rupeesToPaise(200));
    first.sqlite.close();
    opened.splice(opened.indexOf(first), 1);

    const second = harness(file);
    const books = (await json(await second.app.request("/api/books"))) as {
      books: {
        accounts: Parameters<typeof computeBalances>[0];
        entries: Parameters<typeof computeBalances>[1];
      };
    };
    const snap = computeBalances(books.books.accounts, books.books.entries);
    expect(snap.positions.find((p) => p.accountId === SEED_IDS.hdfcSavings)?.balance).toBe(
      rupeesToPaise(200),
    );
    expect(snap.liquid).toBe(rupeesToPaise(200));
    const month = await json(await second.app.request("/api/month/2026-09"));
    expect((month.freeCash as { liquid: number }).liquid).toBe(rupeesToPaise(200));
  });

  it("new liquid account increases /api liquid without Home code", async () => {
    const { app } = harness();
    const before = (await json(await app.request("/api/accounts"))) as { liquid: number };
    const created = await app.request("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Wallet",
        group: "cash",
        openingBalance: rupeesToPaise(1_000),
        openingDate: "2026-09-01",
        includeLiquid: true,
        includeNetWorth: true,
      }),
    });
    expect(created.status).toBe(201);
    const body = (await json(created)) as {
      liquid: number;
      account: { includeLiquid: boolean; openingBalance: number };
    };
    expect(body.account.includeLiquid).toBe(true);
    expect(body.liquid).toBe(before.liquid + rupeesToPaise(1_000));
    const month = await json(await app.request("/api/month/2026-09"));
    expect((month.freeCash as { liquid: number }).liquid).toBe(body.liquid);
  });

  it("archives an account with entries and never deletes; virtual stays live", async () => {
    const { app } = harness();
    await app.request("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "expense",
        amount: rupeesToPaise(50),
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: "",
      }),
    });
    const archived = await app.request(`/api/accounts/${SEED_IDS.hdfcSavings}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isArchived: true }),
    });
    expect(archived.status).toBe(200);
    const archivedBody = (await json(archived)) as { account: { isArchived: boolean } };
    expect(archivedBody.account.isArchived).toBe(true);

    const virtual = await app.request(`/api/accounts/${SEED_IDS.expense}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isArchived: true }),
    });
    expect(virtual.status).toBe(400);

    const list = (await json(await app.request("/api/accounts"))) as {
      accounts: { id: string; isArchived: boolean }[];
    };
    expect(list.accounts.find((row) => row.id === SEED_IDS.hdfcSavings)?.isArchived).toBe(true);
    expect(list.accounts.find((row) => row.id === SEED_IDS.expense)?.isArchived).toBe(false);
  });

  it("adjustment without a note is rejected", async () => {
    const { app } = harness();
    const res = await app.request("/api/reconcile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: SEED_IDS.hdfcSavings,
        actualBalance: rupeesToPaise(10),
        resolution: "adjustment",
        notes: "  ",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("home", () => {
  it("GET /api/home matches engine pace, free cash, and recent rows", async () => {
    const { app } = harness();
    const empty = (await json(await app.request("/api/home"))) as {
      ok: boolean;
      pace: { spent: number; remaining: number; cap: number };
      free: {
        liquid: number;
        budgetReserved: number;
        committed: number;
        free: number;
        breakdown: { key: string }[];
        ccDue: number;
      };
      recent: unknown[];
    };
    expect(empty.ok).toBe(true);
    expect(empty.pace.spent).toBe(0);
    expect(empty.pace.remaining).toBe(empty.pace.cap);
    expect(empty.free.free).toBe(
      empty.free.liquid - empty.free.budgetReserved - empty.free.committed,
    );
    expect(empty.free.free).toBeLessThan(0);
    expect(empty.free.breakdown.map((row) => row.key)).toEqual([
      "liquid",
      "budget_reserved",
      "cc_due",
      "remaining_emi",
      "one_time_30d",
    ]);
    expect(empty.recent).toEqual([]);

    await app.request("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "expense",
        amount: rupeesToPaise(250),
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: SEED_IDS.expense,
        categoryId: SEED_IDS.groceries,
        inBudget: true,
        notes: "milk",
      }),
    });
    const after = (await json(await app.request("/api/home"))) as {
      pace: { spent: number };
      summary: { budgetSpent: number };
      recent: { notes: string; amount: number }[];
    };
    expect(after.pace.spent).toBe(rupeesToPaise(250));
    expect(after.summary.budgetSpent).toBe(rupeesToPaise(250));
    expect(after.recent[0]?.notes).toBe("milk");
    expect(after.recent[0]?.amount).toBe(rupeesToPaise(250));

    const cc = await app.request("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "HDFC Credit Card",
        group: "credit_card",
        openingBalance: rupeesToPaise(702.16),
        openingDate: "2026-08-01",
        creditLimit: rupeesToPaise(1_00_000),
        dueDay: 7,
      }),
    });
    expect(cc.status).toBe(201);
    const withCard = (await json(await app.request("/api/home"))) as {
      cards: { name: string; due: number; dueDay: number | null }[];
      free: { ccDue: number };
    };
    expect(
      withCard.cards.some(
        (row) => row.name === "HDFC Credit Card" && row.due === rupeesToPaise(702.16),
      ),
    ).toBe(true);
    expect(withCard.free.ccDue).toBe(rupeesToPaise(702.16));
  });
});

describe("plan tab APIs", () => {
  it("GET /api/plan returns this month's cap from settings", async () => {
    const { app } = harness();
    const res = await json(await app.request("/api/plan"));
    expect(res.ok).toBe(true);
    expect((res.pace as { cap: number }).cap).toBe(rupeesToPaise(31_000));
    expect((res.recurringHeader as { monthlyFixed: number }).monthlyFixed).toBe(0);
    expect((res.forecast as { months: unknown[] }).months).toHaveLength(6);
  });

  it("PUT /api/budgets writes the cap and applyToFuture updates the default", async () => {
    const { app } = harness();
    const res = await app.request("/api/budgets/2026-09", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cap: rupeesToPaise(40_000), applyToFuture: true }),
    });
    expect(res.status).toBe(200);
    const plan = await json(await app.request("/api/plan?month=2026-10"));
    expect((plan.pace as { cap: number }).cap).toBe(rupeesToPaise(40_000));
    expect(plan.defaultBudget).toBe(rupeesToPaise(40_000));
  });

  it("yearly scooty insurance is due in December only, never smeared", async () => {
    const { app } = harness();
    const created = await app.request("/api/plans/recurring", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Scooty insurance",
        categoryId: SEED_IDS.groceries,
        frequency: "yearly",
        amount: rupeesToPaise(1_800),
        startDate: "2026-12-01",
        kind: "lifestyle",
        active: true,
      }),
    });
    expect(created.status).toBe(201);
    const forecast = (await json(await app.request("/api/forecast"))) as {
      forecast: { months: { month: string; lifestyle: number; lines: { name: string }[] }[] };
    };
    const sep = forecast.forecast.months.find((row) => row.month === "2026-09");
    const dec = forecast.forecast.months.find((row) => row.month === "2026-12");
    expect(sep?.lifestyle).toBe(0);
    expect(dec?.lifestyle).toBe(rupeesToPaise(1_800));
    expect(dec?.lines.some((row) => row.name === "Scooty insurance")).toBe(true);
    const header = (await json(await app.request("/api/plan"))) as {
      recurringHeader: { yearlyCommitments: number; monthlyFixed: number };
    };
    expect(header.recurringHeader.yearlyCommitments).toBe(rupeesToPaise(1_800));
    expect(header.recurringHeader.monthlyFixed).toBe(0);
  });

  it("turning a recurring row Active=FALSE updates Home remaining EMI", async () => {
    const { app } = harness();
    const created = (await json(
      await app.request("/api/plans/recurring", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "MacBook SmartEMI",
          categoryId: SEED_IDS.emis,
          frequency: "monthly",
          amount: rupeesToPaise(38_200),
          startDate: "2026-03-01",
          endDate: "2027-02-28",
          kind: "loan_emi",
          active: true,
        }),
      }),
    )) as { recurring: { id: string; name: string }[] };
    const id = created.recurring.find((row) => row.name === "MacBook SmartEMI")?.id;
    expect(id).toBeTruthy();
    const before = (await json(await app.request("/api/home"))) as {
      free: { remainingEmi: number };
    };
    expect(before.free.remainingEmi).toBe(rupeesToPaise(38_200));
    await app.request(`/api/plans/recurring/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    const after = (await json(await app.request("/api/home"))) as {
      free: { remainingEmi: number };
    };
    expect(after.free.remainingEmi).toBe(0);
  });

  it("completing a one-time does not invent a ledger row", async () => {
    const { app } = harness();
    const created = (await json(
      await app.request("/api/plans/one-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Flights",
          categoryId: SEED_IDS.groceries,
          expectedDate: "2026-09-20",
          amount: rupeesToPaise(7_500),
          priority: "high",
          status: "planned",
        }),
      }),
    )) as { oneTime: { id: string; name: string }[] };
    const id = created.oneTime.find((row) => row.name === "Flights")?.id;
    expect(id).toBeTruthy();
    const before = (await json(await app.request("/api/dev/counts"))) as {
      counts: { ledgerEntries: number };
    };
    const homeBefore = (await json(await app.request("/api/home"))) as {
      free: { oneTime30d: number };
    };
    expect(homeBefore.free.oneTime30d).toBe(rupeesToPaise(7_500));
    await app.request(`/api/plans/one-time/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    const after = (await json(await app.request("/api/dev/counts"))) as {
      counts: { ledgerEntries: number };
    };
    expect(after.counts.ledgerEntries).toBe(before.counts.ledgerEntries);
    const homeAfter = (await json(await app.request("/api/home"))) as {
      free: { oneTime30d: number };
    };
    expect(homeAfter.free.oneTime30d).toBe(0);
    const plan = (await json(await app.request("/api/plan"))) as {
      oneTime: { id: string; status: string }[];
    };
    expect(plan.oneTime.find((row) => row.id === id)?.status).toBe("completed");
  });
});

describe("categories, settings, lock, tailnet", () => {
  it("adds, toggles default-in-budget, and archives a category", async () => {
    const { app } = harness();
    const created = (await json(
      await app.request("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Eating outside",
          group: "Food",
          defaultInBudget: true,
        }),
      }),
    )) as { category: { id: string; name: string; defaultInBudget: boolean; isArchived: boolean } };
    expect(created.category.name).toBe("Eating outside");
    expect(created.category.defaultInBudget).toBe(true);
    const patched = (await json(
      await app.request(`/api/categories/${created.category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultInBudget: false, isArchived: true }),
      }),
    )) as { category: { defaultInBudget: boolean; isArchived: boolean } };
    expect(patched.category.defaultInBudget).toBe(false);
    expect(patched.category.isArchived).toBe(true);
  });

  it("changing default budget fills a future month with no cap row", async () => {
    const { app } = harness();
    await app.request("/api/budgets/2026-09", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cap: rupeesToPaise(31_000), applyToFuture: false }),
    });
    const saved = await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultBudget: rupeesToPaise(35_000) }),
    });
    expect(saved.status).toBe(200);
    const sep = (await json(await app.request("/api/plan?month=2026-09"))) as {
      pace: { cap: number };
    };
    const nov = (await json(await app.request("/api/plan?month=2026-11"))) as {
      pace: { cap: number };
      defaultBudget: number;
    };
    expect(sep.pace.cap).toBe(rupeesToPaise(31_000));
    expect(nov.pace.cap).toBe(rupeesToPaise(35_000));
    expect(nov.defaultBudget).toBe(rupeesToPaise(35_000));
  });

  it("sets a PIN and unlocks only with the right digits", async () => {
    const { app } = harness();
    const set = await app.request("/api/settings/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "2468" }),
    });
    expect(set.status).toBe(200);
    const status = (await json(await app.request("/api/lock"))) as { pinSet: boolean };
    expect(status.pinSet).toBe(true);
    const bad = await app.request("/api/lock/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    expect(bad.status).toBe(401);
    const good = await app.request("/api/lock/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "2468" }),
    });
    expect(good.status).toBe(200);
  });

  it("requires Tailscale-User-Login on /api except health", async () => {
    const db = openDatabase(":memory:");
    opened.push(db);
    ensureCatalog(db.db);
    const app = createApp({
      ...db,
      auth: {
        requireTailscale: true,
        allowedLogin: "himanshu@github",
        allowUnauth: false,
      },
    });
    const denied = await app.request("/api/books");
    expect(denied.status).toBe(401);
    expect((await json(denied)).error).toBe("Not on this tailnet.");
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    const ok = await app.request("/api/books", {
      headers: { "Tailscale-User-Login": "himanshu@github" },
    });
    expect(ok.status).toBe(200);
  });
});

type WealthBody = {
  ok: boolean;
  netWorth: number;
  buckets: {
    id: string;
    name: string;
    priority: number;
    targetRule: string;
    targetAmount: number | null;
    targetMonths: number | null;
    fillMode: string;
    fillValue: number | null;
    minMonthly: number | null;
    active: boolean;
    notes: string;
    colour: string;
    current: number;
    target: number | null;
    fillPct: number | null;
    accountIds: string[];
    accounts: { id: string; name: string; balance: number }[];
  }[];
  free: number;
  example: { lines: { bucketId: string; amount: number }[] };
};

function bucketWrites(wealth: WealthBody) {
  return wealth.buckets.map((row) => ({
    id: row.id,
    name: row.name,
    priority: row.priority,
    targetRule: row.targetRule,
    targetAmount: row.targetAmount,
    targetMonths: row.targetMonths,
    fillMode: row.fillMode,
    fillValue: row.fillValue,
    minMonthly: row.minMonthly,
    active: row.active,
    notes: row.notes,
    colour: row.colour,
    accountIds: row.accountIds,
  }));
}

function exampleAmount(wealth: WealthBody, id: string): number {
  return wealth.example.lines.find((row) => row.bucketId === id)?.amount ?? 0;
}

describe("wealth", () => {
  it("GET /api/wealth uses FD and other tagged accounts for EF fill %", async () => {
    const { app, db } = harness();
    insertAccount(db, {
      name: "FD",
      type: "asset",
      group: "fd",
      openingBalance: rupeesToPaise(20_000),
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: false,
      bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
      statementDay: null,
      dueDay: null,
      notes: "",
      virtualKind: null,
    });
    insertAccount(db, {
      name: "Extra EF",
      type: "asset",
      group: "fd",
      openingBalance: rupeesToPaise(5_000),
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: false,
      bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
      statementDay: null,
      dueDay: null,
      notes: "",
      virtualKind: null,
    });

    const loaded = (await json(await app.request("/api/wealth"))) as WealthBody;
    const writes = bucketWrites(loaded).map((row) =>
      row.id === DEFAULT_BUCKET_IDS.emergencyFund
        ? {
            ...row,
            targetRule: "fixed",
            targetAmount: rupeesToPaise(50_000),
            targetMonths: null,
          }
        : row,
    );
    const res = await app.request("/api/buckets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buckets: writes }),
    });
    expect(res.status).toBe(200);
    const wealth = (await json(res)) as WealthBody;
    const ef = wealth.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund);
    expect(ef?.current).toBe(rupeesToPaise(25_000));
    expect(ef?.target).toBe(rupeesToPaise(50_000));
    expect(ef?.fillPct).toBe(0.5);
    expect(ef?.accounts.map((row) => row.name).sort()).toEqual(["Extra EF", "FD"]);
    expect(wealth.netWorth).toBe(rupeesToPaise(25_000));
  });

  it("PUT Savings 10k → 30k updates rings and the example split without ledger rows", async () => {
    const { app, db } = harness();
    insertAccount(db, {
      name: "FD",
      type: "asset",
      group: "fd",
      openingBalance: rupeesToPaise(20_000),
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: false,
      bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
      statementDay: null,
      dueDay: null,
      notes: "",
      virtualKind: null,
    });
    insertLedgerEntry(db, {
      date: "2026-09-01",
      time: null,
      type: "income",
      amount: rupeesToPaise(1_00_000),
      fromAccountId: SEED_IDS.employer,
      toAccountId: SEED_IDS.hdfcSavings,
      categoryId: SEED_IDS.groceries,
      inBudget: false,
      notes: "test salary",
      source: "manual",
    });

    const beforeCounts = (await json(await app.request("/api/dev/counts"))) as {
      counts: { ledgerEntries: number };
    };
    const before = (await json(await app.request("/api/wealth"))) as WealthBody;
    expect(exampleAmount(before, DEFAULT_BUCKET_IDS.savingsBuffer)).toBe(rupeesToPaise(10_000));
    expect(exampleAmount(before, DEFAULT_BUCKET_IDS.investment)).toBe(rupeesToPaise(59_000));

    const writes = bucketWrites(before).map((row) =>
      row.id === DEFAULT_BUCKET_IDS.savingsBuffer
        ? { ...row, targetAmount: rupeesToPaise(30_000) }
        : row,
    );
    const res = await app.request("/api/buckets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buckets: writes }),
    });
    expect(res.status).toBe(200);
    const after = (await json(res)) as WealthBody;
    const savings = after.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.savingsBuffer);
    expect(savings?.target).toBe(rupeesToPaise(30_000));
    expect(savings?.fillPct).toBe(0);
    expect(exampleAmount(after, DEFAULT_BUCKET_IDS.savingsBuffer)).toBe(rupeesToPaise(30_000));
    expect(exampleAmount(after, DEFAULT_BUCKET_IDS.investment)).toBe(rupeesToPaise(39_000));

    const afterCounts = (await json(await app.request("/api/dev/counts"))) as {
      counts: { ledgerEntries: number };
    };
    expect(afterCounts.counts.ledgerEntries).toBe(beforeCounts.counts.ledgerEntries);
  });

  it("rejects a plan with two remainder buckets", async () => {
    const { app } = harness();
    const wealth = (await json(await app.request("/api/wealth"))) as WealthBody;
    const writes = bucketWrites(wealth).map((row) =>
      row.id === DEFAULT_BUCKET_IDS.savingsBuffer
        ? { ...row, fillMode: "remainder", fillValue: null }
        : row,
    );
    const res = await app.request("/api/buckets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buckets: writes }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { issues: { code: string }[] };
    expect(body.issues.some((row) => row.code === "remainder_count")).toBe(true);
  });
});

describe("allocation", () => {
  async function setupEfRoom(app: ReturnType<typeof createApp>, db: OpenedDb["db"]) {
    const fd = insertAccount(db, {
      name: "FD",
      type: "asset",
      group: "fd",
      openingBalance: 0,
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: false,
      bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
      statementDay: null,
      dueDay: null,
      notes: "",
      virtualKind: null,
    });
    insertLedgerEntry(db, {
      date: "2026-09-01",
      time: null,
      type: "income",
      amount: rupeesToPaise(43_400),
      fromAccountId: SEED_IDS.employer,
      toAccountId: SEED_IDS.hdfcSavings,
      categoryId: SEED_IDS.groceries,
      inBudget: false,
      notes: "test salary",
      source: "manual",
    });
    const wealth = (await json(await app.request("/api/wealth"))) as WealthBody;
    const writes = bucketWrites(wealth).map((row) =>
      row.id === DEFAULT_BUCKET_IDS.emergencyFund
        ? {
            ...row,
            targetRule: "fixed",
            targetAmount: rupeesToPaise(12_400),
            targetMonths: null,
          }
        : row,
    );
    const put = await app.request("/api/buckets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buckets: writes }),
    });
    expect(put.status).toBe(200);
    return fd;
  }

  it("confirms ₹12,400 to EF: investment ledger, FD up, free cash down, run confirmed", async () => {
    const { app, db } = harness();
    const fd = await setupEfRoom(app, db);

    const preview = (await json(await app.request("/api/allocation"))) as {
      canAllocate: boolean;
      freeCash: { free: number };
      example: { lines: { bucketId: string; amount: number }[] };
    };
    expect(preview.canAllocate).toBe(true);
    expect(preview.freeCash.free).toBe(rupeesToPaise(12_400));
    expect(
      preview.example.lines.find((row) => row.bucketId === DEFAULT_BUCKET_IDS.emergencyFund)?.amount,
    ).toBe(rupeesToPaise(12_400));

    const created = await app.request("/api/allocation/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        surplusInput: rupeesToPaise(12_400),
        confirm: true,
        lines: [
          {
            bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
            amount: rupeesToPaise(12_400),
            fromAccountId: SEED_IDS.hdfcSavings,
            toAccountId: fd.id,
          },
          {
            bucketId: DEFAULT_BUCKET_IDS.savingsBuffer,
            amount: 0,
            fromAccountId: "",
            toAccountId: "",
          },
          {
            bucketId: DEFAULT_BUCKET_IDS.investment,
            amount: 0,
            fromAccountId: "",
            toAccountId: "",
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const body = (await json(created)) as {
      run: {
        id: string;
        status: string;
        lines: { bucketId: string; confirmedAmount: number; ledgerEntryId: string | null }[];
      };
      freeCash: { free: number };
      buckets: { id: string; current: number }[];
    };
    expect(body.run.status).toBe("confirmed");
    const efLine = body.run.lines.find(
      (row) => row.bucketId === DEFAULT_BUCKET_IDS.emergencyFund,
    );
    expect(efLine?.confirmedAmount).toBe(rupeesToPaise(12_400));
    expect(efLine?.ledgerEntryId).toBeTruthy();
    expect(body.freeCash.free).toBe(0);
    const ef = body.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund);
    expect(ef?.current).toBe(rupeesToPaise(12_400));

    const ledger = (await json(await app.request("/api/ledger?month=2026-09"))) as {
      entries: {
        type: string;
        amount: number;
        source: string;
        fromAccountId: string;
        toAccountId: string;
        inBudget: boolean;
      }[];
    };
    const alloc = ledger.entries.find((row) => row.source === "allocation");
    expect(alloc).toMatchObject({
      type: "investment",
      amount: rupeesToPaise(12_400),
      fromAccountId: SEED_IDS.hdfcSavings,
      toAccountId: fd.id,
      inBudget: false,
    });

    const again = await app.request(`/api/allocation/${body.run.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lines: [
          {
            bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
            amount: rupeesToPaise(12_400),
            fromAccountId: SEED_IDS.hdfcSavings,
            toAccountId: fd.id,
          },
        ],
      }),
    });
    expect(again.status).toBe(409);
  });

  it("rejects allocate when free cash is not positive", async () => {
    const { app } = harness();
    const preview = (await json(await app.request("/api/allocation"))) as {
      canAllocate: boolean;
      freeCash: { free: number };
    };
    expect(preview.canAllocate).toBe(false);
    expect(preview.freeCash.free).toBeLessThanOrEqual(0);

    const res = await app.request("/api/allocation/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        surplusInput: rupeesToPaise(12_400),
        overrideReason: "trying anyway",
        confirm: true,
        lines: [
          {
            bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
            amount: rupeesToPaise(12_400),
            fromAccountId: SEED_IDS.hdfcSavings,
            toAccountId: SEED_IDS.hdfcSavings,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: string };
    expect(body.error).toMatch(/free cash is not positive/i);
  });
});

describe("goals", () => {
  function seedSavings10k(db: OpenedDb["db"]) {
    insertAccount(db, {
      name: "ICICI Savings",
      type: "asset",
      group: "savings",
      openingBalance: rupeesToPaise(10_000),
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: true,
      bucketId: DEFAULT_BUCKET_IDS.savingsBuffer,
      statementDay: null,
      dueDay: null,
      notes: "",
      virtualKind: null,
    });
  }

  async function addGoal(
    app: ReturnType<typeof createApp>,
    body: Record<string, unknown>,
  ) {
    return app.request("/api/goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("₹8,000 is affordable now on ₹10,000 savings; a second ₹8,000 is not", async () => {
    const { app, db } = harness();
    seedSavings10k(db);
    expect((await addGoal(app, { name: "German Exams", targetAmount: rupeesToPaise(8_000) })).status).toBe(201);
    expect((await addGoal(app, { name: "MacBook Air", targetAmount: rupeesToPaise(8_000) })).status).toBe(201);

    const body = (await json(await app.request("/api/goals"))) as {
      goals: { name: string; pill: string; availableNow: number; remaining: number | null }[];
    };
    expect(body.goals[0]?.name).toBe("German Exams");
    expect(body.goals[0]?.pill).toBe("affordable_now");
    expect(body.goals[0]?.availableNow).toBe(rupeesToPaise(10_000));
    expect(body.goals[1]?.name).toBe("MacBook Air");
    expect(body.goals[1]?.pill).not.toBe("affordable_now");
    expect(body.goals[1]?.availableNow).toBe(rupeesToPaise(2_000));
  });

  it("funding writes a contribution and hitting the target marks Achieved", async () => {
    const { app, db } = harness();
    seedSavings10k(db);
    const created = (await json(
      await addGoal(app, { name: "German Exams", targetAmount: rupeesToPaise(8_000) }),
    )) as { goal: { id: string } };
    const res = await app.request(`/api/goals/${created.goal.id}/contribute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amount: rupeesToPaise(8_000),
        note: "cash on hand",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await json(res)) as {
      contribution: { amount: number; note: string; ledgerEntryId: string | null };
      goals: { id: string; pill: string; status: string; remaining: number | null }[];
    };
    expect(body.contribution.amount).toBe(rupeesToPaise(8_000));
    expect(body.contribution.ledgerEntryId).toBeNull();
    const row = body.goals.find((g) => g.id === created.goal.id);
    expect(row?.pill).toBe("achieved");
    expect(row?.status).toBe("achieved");
    expect(row?.remaining).toBe(0);
  });

  it("blank-target imported goals prompt to fill a number", async () => {
    const { app } = harness();
    const created = (await json(await addGoal(app, { name: "iPhone" }))) as {
      goal: { id: string; needsTarget: boolean; targetAmount: number | null; pill: string };
    };
    expect(created.goal.targetAmount).toBeNull();
    expect(created.goal.needsTarget).toBe(true);
    expect(created.goal.pill).toBe("saving");
  });

  it("requires a note for a manual contribution without a bank move", async () => {
    const { app, db } = harness();
    seedSavings10k(db);
    const created = (await json(
      await addGoal(app, { name: "German Exams", targetAmount: rupeesToPaise(8_000) }),
    )) as { goal: { id: string } };
    const res = await app.request(`/api/goals/${created.goal.id}/contribute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: rupeesToPaise(1_000), note: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: string };
    expect(body.error).toMatch(/note/i);
  });

  it("POST ledger with goalId writes a contribution", async () => {
    const { app, db } = harness();
    seedSavings10k(db);
    const created = (await json(
      await addGoal(app, { name: "German Exams", targetAmount: rupeesToPaise(8_000) }),
    )) as { goal: { id: string } };
    const accounts = (await json(await app.request("/api/accounts"))) as {
      accounts: { id: string; name: string }[];
    };
    const icici = accounts.accounts.find((row) => row.name === "ICICI Savings");
    expect(icici).toBeTruthy();
    const led = await app.request("/api/ledger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2026-09-06",
        type: "transfer",
        amount: rupeesToPaise(8_000),
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: icici?.id,
        categoryId: SEED_IDS.groceries,
        inBudget: false,
        notes: "Goal: German Exams",
        goalId: created.goal.id,
      }),
    });
    expect(led.status).toBe(201);
    const goals = (await json(await app.request("/api/goals"))) as {
      contributions: { goalId: string; amount: number; ledgerEntryId: string | null }[];
      goals: { id: string; pill: string }[];
    };
    expect(goals.contributions).toHaveLength(1);
    expect(goals.contributions[0]?.goalId).toBe(created.goal.id);
    expect(goals.contributions[0]?.ledgerEntryId).not.toBeNull();
    expect(goals.goals.find((row) => row.id === created.goal.id)?.pill).toBe("achieved");
  });
});

describe("invest plan + dip", () => {
  async function seedPlan(app: ReturnType<typeof createApp>) {
    const res = await app.request("/api/seed/invest", { method: "POST" });
    expect(res.status).toBe(200);
  }

  it("saves a new plan version and keeps the old one", async () => {
    const { app } = harness();
    await seedPlan(app);
    const first = (await json(await app.request("/api/invest"))) as {
      plan: { id: string; sipBp: number; assets: { id: string; name: string }[] };
    };
    expect(first.plan.sipBp).toBe(7_000);

    const put = await app.request("/api/invest/plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...first.plan, sipBp: 6_000, dipReserveBp: 4_000 }),
    });
    expect(put.status).toBe(200);
    const body = (await json(put)) as {
      plan: { id: string; sipBp: number };
      previousPlan: { id: string; sipBp: number } | null;
    };
    expect(body.plan.id).not.toBe(first.plan.id);
    expect(body.plan.sipBp).toBe(6_000);
    expect(body.previousPlan?.id).toBe(first.plan.id);
    expect(body.previousPlan?.sipBp).toBe(7_000);
  });

  it("GET /api/invest/split: ₹10,000 Automation ₹0; ₹25,000 themes on", async () => {
    const { app } = harness();
    await seedPlan(app);
    const ten = (await json(
      await app.request(`/api/invest/split?amount=${rupeesToPaise(10_000)}`),
    )) as { split: { orders: { name: string; amount: number }[] } };
    expect(
      ten.split.orders.find((row) => row.name === "Automation & Robotics")?.amount,
    ).toBe(0);

    const twentyFive = (await json(
      await app.request(`/api/invest/split?amount=${rupeesToPaise(25_000)}`),
    )) as { split: { orders: { name: string; amount: number }[] } };
    expect(
      twentyFive.split.orders.find((row) => row.name === "Automation & Robotics")?.amount,
    ).toBeGreaterThan(0);
  });

  it("turning Gold off re-normalises % and SIP rupees", async () => {
    const { app } = harness();
    await seedPlan(app);
    const current = (await json(await app.request("/api/invest"))) as {
      plan: ReturnType<typeof seedDefaultInvestPlan>;
    };
    const withGold = {
      ...current.plan,
      assets: [
        ...current.plan.assets,
        {
          id: DEFAULT_ASSET_IDS.gold,
          name: GOLD_ASSET_NAME,
          kind: "core" as const,
          targetBp: 1_000,
          dipPriority: 9,
          instrumentNote: "",
          active: true,
        },
      ],
    };
    const off = {
      ...inactivateGold(withGold),
      assets: normaliseActiveTargets(inactivateGold(withGold).assets),
    };
    const put = await app.request("/api/invest/plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(off),
    });
    expect(put.status).toBe(200);
    const split = (await json(
      await app.request(`/api/invest/split?amount=${rupeesToPaise(1_150)}`),
    )) as { split: { sipPool: number; orders: { name: string; amount: number }[] } };
    expect(split.split.sipPool).toBe(rupeesToPaise(805));
    expect(split.split.orders.find((row) => row.name === GOLD_ASSET_NAME)?.amount).toBe(0);
  });

  async function setupInvestLeftover(app: ReturnType<typeof createApp>, db: OpenedDb["db"]) {
    await seedPlan(app);
    const mf = insertAccount(db, {
      name: "Mutual Fund",
      type: "asset",
      group: "investment",
      openingBalance: 0,
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: false,
      bucketId: DEFAULT_BUCKET_IDS.investment,
      statementDay: null,
      dueDay: null,
      notes: "",
      virtualKind: null,
    });
    insertLedgerEntry(db, {
      date: "2026-09-01",
      time: null,
      type: "income",
      amount: rupeesToPaise(43_400),
      fromAccountId: SEED_IDS.employer,
      toAccountId: SEED_IDS.hdfcSavings,
      categoryId: SEED_IDS.groceries,
      inBudget: false,
      notes: "test salary",
      source: "manual",
    });
    const wealth = (await json(await app.request("/api/wealth"))) as WealthBody;
    const writes = bucketWrites(wealth).map((row) =>
      row.id === DEFAULT_BUCKET_IDS.emergencyFund ||
      row.id === DEFAULT_BUCKET_IDS.savingsBuffer
        ? {
            ...row,
            targetRule: "fixed",
            targetAmount: 0,
            targetMonths: null,
          }
        : row,
    );
    const put = await app.request("/api/buckets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buckets: writes }),
    });
    expect(put.status).toBe(200);
    return mf;
  }

  it("deploy dip ₹N reduces reserve and adds ledger investment rows", async () => {
    const { app, db } = harness();
    const mf = await setupInvestLeftover(app, db);
    const preview = (await json(await app.request("/api/allocation"))) as {
      freeCash: { free: number };
      example: { lines: { bucketId: string; amount: number }[] };
    };
    const investAmount =
      preview.example.lines.find((row) => row.bucketId === DEFAULT_BUCKET_IDS.investment)
        ?.amount ?? 0;
    expect(investAmount).toBeGreaterThan(0);

    const created = await app.request("/api/allocation/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        surplusInput: preview.freeCash.free,
        confirm: true,
        lines: [
          {
            bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
            amount: 0,
            fromAccountId: "",
            toAccountId: "",
          },
          {
            bucketId: DEFAULT_BUCKET_IDS.savingsBuffer,
            amount: 0,
            fromAccountId: "",
            toAccountId: "",
          },
          {
            bucketId: DEFAULT_BUCKET_IDS.investment,
            amount: investAmount,
            fromAccountId: SEED_IDS.hdfcSavings,
            toAccountId: mf.id,
          },
        ],
      }),
    });
    expect(created.status).toBe(201);

    const before = (await json(await app.request("/api/invest"))) as {
      dipBalance: number;
      plan: ReturnType<typeof seedDefaultInvestPlan>;
    };
    expect(before.dipBalance).toBeGreaterThan(0);
    const deploy = rupeesToPaise(1_000);
    expect(before.dipBalance).toBeGreaterThanOrEqual(deploy);
    const suggestion = suggestDipDeploy(deploy, before.plan);
    const res = await app.request("/api/invest/dip-buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amount: deploy,
        fromAccountId: SEED_IDS.hdfcSavings,
        toAccountId: mf.id,
        lines: suggestion.orders.map((row) => ({ assetId: row.assetId, amount: row.amount })),
      }),
    });
    expect(res.status).toBe(201);
    const after = (await json(res)) as {
      dipBalance: number;
      entries: { type: string; amount: number; notes: string }[];
    };
    expect(after.dipBalance).toBe(before.dipBalance - deploy);

    const ledger = (await json(await app.request("/api/ledger?month=2026-09"))) as {
      entries: { type: string; amount: number; notes: string; toAccountId: string }[];
    };
    const dipRows = ledger.entries.filter((row) => row.notes.startsWith("Dip ·"));
    expect(dipRows.length).toBeGreaterThan(0);
    expect(dipRows.reduce((sum, row) => sum + row.amount, 0)).toBe(deploy);
    expect(dipRows.every((row) => row.type === "investment")).toBe(true);
    expect(dipRows.every((row) => row.toAccountId === mf.id)).toBe(true);
  });
});

describe("portfolio + snapshots", () => {
  async function seedPlan(app: ReturnType<typeof createApp>) {
    const res = await app.request("/api/seed/invest", { method: "POST" });
    expect(res.status).toBe(200);
  }

  async function setupMfAndSurplus(app: ReturnType<typeof createApp>, db: OpenedDb["db"]) {
    await seedPlan(app);
    const mf = insertAccount(db, {
      name: "Mutual Fund",
      type: "asset",
      group: "investment",
      openingBalance: 0,
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: false,
      bucketId: DEFAULT_BUCKET_IDS.investment,
      statementDay: null,
      dueDay: null,
      notes: "",
      virtualKind: null,
    });
    insertLedgerEntry(db, {
      date: "2026-09-01",
      time: null,
      type: "income",
      amount: rupeesToPaise(43_400),
      fromAccountId: SEED_IDS.employer,
      toAccountId: SEED_IDS.hdfcSavings,
      categoryId: SEED_IDS.groceries,
      inBudget: false,
      notes: "test salary",
      source: "manual",
    });
    const wealth = (await json(await app.request("/api/wealth"))) as WealthBody;
    const writes = bucketWrites(wealth).map((row) =>
      row.id === DEFAULT_BUCKET_IDS.emergencyFund ||
      row.id === DEFAULT_BUCKET_IDS.savingsBuffer
        ? { ...row, targetRule: "fixed", targetAmount: 0, targetMonths: null }
        : row,
    );
    const put = await app.request("/api/buckets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buckets: writes }),
    });
    expect(put.status).toBe(200);
    return mf;
  }

  it("manual NAV update changes current value and net worth", async () => {
    const { app, db } = harness();
    const mf = await setupMfAndSurplus(app, db);
    const plan = (await json(await app.request("/api/invest"))) as {
      plan: { assets: { id: string; name: string }[] };
    };
    const nasdaq = plan.plan.assets.find((row) => row.name === "NASDAQ-100");
    expect(nasdaq).toBeTruthy();

    const created = await app.request("/api/holdings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: nasdaq?.id, accountId: mf.id }),
    });
    expect(created.status).toBe(201);
    const holdingBody = (await json(created)) as { holding: { id: string } };
    const holdingId = holdingBody.holding.id;
    const buyNav = rupeesToPaise(20);
    const buyAmount = rupeesToPaise(2_000);
    const buy = await app.request(`/api/holdings/${holdingId}/txns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "buy_sip",
        amount: buyAmount,
        nav: buyNav,
        fromAccountId: SEED_IDS.hdfcSavings,
      }),
    });
    expect(buy.status).toBe(201);
    const before = (await json(await app.request("/api/wealth"))) as {
      netWorth: number;
    };
    const portBefore = (await json(await app.request("/api/portfolio"))) as {
      value: number;
      netWorth: number;
      holdings: { id: string; value: number }[];
    };
    expect(portBefore.holdings[0]?.value).toBe(buyAmount);

    const laterNav = rupeesToPaise(22);
    const patched = await app.request(`/api/holdings/${holdingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastNav: laterNav }),
    });
    expect(patched.status).toBe(200);
    const after = (await json(patched)) as {
      netWorth: number;
      holding: { value: number; lastNav: number };
      holdings: { value: number }[];
    };
    expect(after.holding.lastNav).toBe(laterNav);
    expect(after.holding.value).toBeGreaterThan(buyAmount);
    expect(after.netWorth).toBeGreaterThan(before.netWorth);
    expect(after.netWorth - before.netWorth).toBe(after.holding.value - buyAmount);
  });

  it("snapshot after an allocate run shows a new point on the chart", async () => {
    const { app, db } = harness();
    const mf = await setupMfAndSurplus(app, db);
    const today = todayIst();
    const yesterday = addDays(today, -1);
    db.insert(netWorthDaily)
      .values({
        date: yesterday,
        assets: rupeesToPaise(1_000),
        liabilities: 0,
        liquid: rupeesToPaise(1_000),
        invested: 0,
        efBalance: 0,
        savingsBalance: 0,
      })
      .run();

    const preview = (await json(await app.request("/api/allocation"))) as {
      freeCash: { free: number };
      example: { lines: { bucketId: string; amount: number }[] };
    };
    const investAmount =
      preview.example.lines.find((row) => row.bucketId === DEFAULT_BUCKET_IDS.investment)
        ?.amount ?? 0;
    expect(investAmount).toBeGreaterThan(0);
    const created = await app.request("/api/allocation/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        surplusInput: preview.freeCash.free,
        confirm: true,
        lines: [
          {
            bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
            amount: 0,
            fromAccountId: "",
            toAccountId: "",
          },
          {
            bucketId: DEFAULT_BUCKET_IDS.savingsBuffer,
            amount: 0,
            fromAccountId: "",
            toAccountId: "",
          },
          {
            bucketId: DEFAULT_BUCKET_IDS.investment,
            amount: investAmount,
            fromAccountId: SEED_IDS.hdfcSavings,
            toAccountId: mf.id,
          },
        ],
      }),
    });
    expect(created.status).toBe(201);

    const history = (await json(await app.request("/api/networth/history"))) as {
      history: { date: string; netWorth: number }[];
    };
    const dates = history.history.map((row) => row.date);
    expect(dates).toContain(yesterday);
    expect(dates).toContain(today);
    const todayPoint = history.history.find((row) => row.date === today);
    const yestPoint = history.history.find((row) => row.date === yesterday);
    expect(todayPoint?.netWorth).not.toBe(yestPoint?.netWorth);
  });

  it("drift bars match holdings vs plan weights", async () => {
    const { app, db } = harness();
    const mf = await setupMfAndSurplus(app, db);
    const plan = (await json(await app.request("/api/invest"))) as {
      plan: { assets: { id: string; name: string; targetBp: number }[] };
    };
    const nasdaq = plan.plan.assets.find((row) => row.name === "NASDAQ-100");
    const flex = plan.plan.assets.find((row) => row.name === "India Flexicap");
    expect(nasdaq && flex).toBeTruthy();

    const h1 = await json(
      await app.request("/api/holdings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: nasdaq?.id, accountId: mf.id }),
      }),
    ) as { holding: { id: string } };
    const h2 = await json(
      await app.request("/api/holdings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: flex?.id, accountId: mf.id }),
      }),
    ) as { holding: { id: string } };

    const nav = rupeesToPaise(10);
    await app.request(`/api/holdings/${h1.holding.id}/txns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "buy_sip",
        amount: rupeesToPaise(9_000),
        nav,
        fromAccountId: SEED_IDS.hdfcSavings,
      }),
    });
    await app.request(`/api/holdings/${h2.holding.id}/txns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "buy_sip",
        amount: rupeesToPaise(1_000),
        nav,
        fromAccountId: SEED_IDS.hdfcSavings,
      }),
    });

    const port = (await json(await app.request("/api/portfolio"))) as {
      drift: { name: string; actualBp: number; targetBp: number; hint: boolean }[];
    };
    const nasdaqDrift = port.drift.find((row) => row.name === "NASDAQ-100");
    const flexDrift = port.drift.find((row) => row.name === "India Flexicap");
    expect(nasdaqDrift?.actualBp).toBe(9_000);
    expect(flexDrift?.actualBp).toBe(1_000);
    expect(nasdaqDrift?.hint).toBe(true);
    expect(flexDrift?.hint).toBe(true);
    const activeBp = plan.plan.assets.reduce((sum, row) => sum + row.targetBp, 0);
    expect(nasdaqDrift?.targetBp).toBe(
      Math.round(((nasdaq?.targetBp ?? 0) * 10_000) / activeBp),
    );
  });

  it("lists FDs as holdings with optional maturity", async () => {
    const { app, db } = harness();
    const fd = insertAccount(db, {
      name: "SBI FD",
      type: "asset",
      group: "fd",
      openingBalance: rupeesToPaise(20_000),
      openingDate: "2026-08-01",
      creditLimit: null,
      includeNetWorth: true,
      includeLiquid: false,
      bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
      statementDay: null,
      dueDay: null,
      notes: "",
      virtualKind: null,
      maturityDate: addDays(todayIst(), 10),
    });
    const port = (await json(await app.request("/api/portfolio"))) as {
      fds: { accountId: string; name: string; daysCaption: string | null; balance: number }[];
    };
    const row = port.fds.find((item) => item.accountId === fd.id);
    expect(row?.name).toBe("SBI FD");
    expect(row?.balance).toBe(rupeesToPaise(20_000));
    expect(row?.daysCaption).toBe("matures in 10 days");
  });
});





