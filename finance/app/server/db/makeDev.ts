import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  bucketCurrentBalances,
  computeBalances,
  DEFAULT_BUCKET_IDS,
  formatInr,
  freeToAllocate,
  resolveBucketTarget,
  runWaterfall,
  rupeesToPaise,
  todayIst,
  validateLedgerEntry,
} from "../../src/engine/index.ts";
import { loadBooks, toFreeCashBooks } from "../books.ts";
import { vacuumInto } from "./backup.ts";
import { openDatabase } from "./client.ts";
import { buckets } from "./schema.ts";
import { nowIso } from "../ids.ts";
import { replaceGoals } from "../repo/invest.ts";
import { insertLedgerEntry, listAccounts, listCategories, setMeta } from "../repo/store.ts";

const LIVE = join(process.cwd(), "data", "finance.sqlite");
const DEST = join(process.cwd(), "data", "finance-dev.sqlite");

const SURPLUS_PAISE = rupeesToPaise(2_00_000);
const EF_TARGET_PAISE = rupeesToPaise(32_400);
const SURPLUS_NOTES = "Dev sandbox surplus";

function unlinkIfPresent(file: string): void {
  if (existsSync(file)) rmSync(file);
}

function overlaySandbox(): void {
  const opened = openDatabase(DEST);
  const { db } = opened;
  const at = nowIso();
  const today = todayIst();
  const accs = listAccounts(db);
  const cats = listCategories(db);
  const employer = accs.find((row) => row.virtualKind === "employer");
  const hdfc = accs.find((row) => row.name.trim().toLowerCase() === "hdfc savings");
  const salary = cats.find((row) => row.name.trim().toLowerCase() === "salary");
  if (!employer || !hdfc || !salary) {
    opened.sqlite.close();
    throw new Error("Sandbox overlay needs Employer, HDFC Savings, and Salary.");
  }

  const checked = validateLedgerEntry(
    {
      date: today,
      type: "income",
      amount: SURPLUS_PAISE,
      fromAccountId: employer.id,
      toAccountId: hdfc.id,
      categoryId: salary.id,
    },
    { accounts: accs, categories: cats },
  );
  if (!checked.ok) {
    opened.sqlite.close();
    throw new Error(checked.issues.map((row) => row.message).join(" "));
  }

  db.transaction((tx) => {
    insertLedgerEntry(tx, {
      date: today,
      time: null,
      type: "income",
      amount: SURPLUS_PAISE,
      fromAccountId: employer.id,
      toAccountId: hdfc.id,
      categoryId: salary.id,
      inBudget: false,
      notes: SURPLUS_NOTES,
      source: "manual",
    });
    tx.update(buckets)
      .set({
        targetRule: "fixed",
        targetAmount: EF_TARGET_PAISE,
        targetMonths: null,
        notes: "Sandbox: ₹32,400 so EF room is ₹12,400 and leftover can hit Investment.",
        updatedAt: at,
      })
      .where(eq(buckets.id, DEFAULT_BUCKET_IDS.emergencyFund))
      .run();
    replaceGoals(
      tx,
      [
        {
          name: "German exams",
          targetAmount: rupeesToPaise(8_000),
          targetDate: "2026-12-01",
          priority: 1,
          notes: "Sandbox",
        },
        {
          name: "MacBook Air",
          targetAmount: rupeesToPaise(80_000),
          targetDate: "2027-03-01",
          priority: 2,
          notes: "Sandbox",
        },
        {
          name: "Germany relocation",
          targetAmount: rupeesToPaise(2_00_000),
          targetDate: "2027-09-01",
          priority: 3,
          notes: "Sandbox",
        },
      ],
      at,
    );
    setMeta(tx, "sandbox", "1");
    setMeta(tx, "sandbox_note", `${SURPLUS_NOTES} ${formatInr(SURPLUS_PAISE)}`);
  });

  const books = loadBooks(db);
  const snap = computeBalances(books.accounts, books.entries, books.today);
  const cash = freeToAllocate(toFreeCashBooks(books));
  const current = bucketCurrentBalances(books.accounts, snap.positions);
  const waterfall = runWaterfall(cash.free, books.buckets, current);
  const hdfcBal = snap.positions.find((row) => row.accountId === hdfc.id)?.balance ?? 0;
  const fd = accs.find((row) => row.name.trim().toLowerCase() === "fd");
  const fdBal = fd
    ? (snap.positions.find((row) => row.accountId === fd.id)?.balance ?? 0)
    : 0;
  const ef = books.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund);
  const efTarget = ef ? resolveBucketTarget(ef, 0) : null;

  console.log(`live   ${LIVE}`);
  console.log(`dev    ${DEST}`);
  console.log(`today  ${books.today}`);
  console.log(`HDFC   ${formatInr(hdfcBal)}`);
  console.log(`FD     ${formatInr(fdBal)}  EF target ${efTarget == null ? "—" : formatInr(efTarget)}`);
  console.log(
    `free   ${formatInr(cash.free)}  (liquid ${formatInr(cash.liquid)} − reserved ${formatInr(cash.budgetReserved)} − committed ${formatInr(cash.committed)})`,
  );
  console.log(
    `plan   ${waterfall.lines.map((row) => `${row.name} ${formatInr(row.amount)}`).join(" · ")}`,
  );
  console.log("goals  German exams ₹8,000 · MacBook Air ₹80,000 · Germany relocation ₹2,00,000");
  opened.sqlite.close();
}

function main(): void {
  if (!existsSync(LIVE)) {
    throw new Error(`Live DB missing: ${LIVE}`);
  }
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  unlinkIfPresent(DEST);
  unlinkIfPresent(`${DEST}-wal`);
  unlinkIfPresent(`${DEST}-shm`);

  const live = openDatabase(LIVE);
  vacuumInto(live.sqlite, DEST);
  live.sqlite.close();
  overlaySandbox();
}

main();
