import { count, eq } from "drizzle-orm";
import {
  DEFAULT_EF_MONTHS,
  rupeesToPaise,
  seedDefaultBuckets,
} from "../../src/engine/index.ts";
import { nowIso } from "../ids.ts";
import type { AppDb } from "./client.ts";
import { SCHEMA_VERSION } from "./paths.ts";
import {
  accounts,
  buckets,
  categories,
  meta,
  settings,
} from "./schema.ts";

export const SEED_IDS = {
  hdfcSavings: "acc_hdfc_savings",
  expense: "acc_expense",
  employer: "acc_employer",
  external: "acc_external",
  groceries: "cat_groceries",
  emis: "cat_emis",
  rent: "cat_rent",
  investment: "cat_investment",
  reconciliation: "cat_reconciliation",
} as const;

export const DUMMY_EXPENSE_PAISE = rupeesToPaise(100);
export const DUMMY_EXPENSE_NOTES = "Phase 9 dummy";

const OPENING_DATE = "2026-08-01";

export function ensureCatalog(db: AppDb, now = new Date()): void {
  const [{ n }] = db.select({ n: count() }).from(accounts).all();
  if (n > 0) {
    ensureSchemaVersion(db);
    return;
  }
  seedCatalog(db, now);
}

export function insertDefaultBuckets(db: AppDb, at: string): void {
  for (const bucket of seedDefaultBuckets()) {
    db.insert(buckets)
      .values({
        id: bucket.id,
        name: bucket.name,
        priority: bucket.priority,
        targetRule: bucket.targetRule,
        targetAmount: bucket.targetAmount,
        targetMonths: bucket.targetMonths,
        fillMode: bucket.fillMode,
        fillValue: bucket.fillValue,
        minMonthly: bucket.minMonthly,
        active: bucket.active,
        colour: bucket.colour,
        notes: bucket.notes,
        updatedAt: at,
      })
      .run();
  }
}

export function seedCatalog(db: AppDb, now = new Date()): void {
  const at = nowIso(now);
  db.transaction((tx) => {
    insertDefaultBuckets(tx, at);

    const cats: (typeof categories.$inferInsert)[] = [
      {
        id: SEED_IDS.groceries,
        name: "Groceries",
        categoryGroup: "lifestyle",
        defaultInBudget: true,
        isEssential: true,
        icon: null,
        sort: 1,
        isArchived: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: SEED_IDS.rent,
        name: "Rent",
        categoryGroup: "housing",
        defaultInBudget: true,
        isEssential: true,
        icon: null,
        sort: 2,
        isArchived: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: SEED_IDS.emis,
        name: "EMIs",
        categoryGroup: "debt",
        defaultInBudget: false,
        isEssential: true,
        icon: null,
        sort: 3,
        isArchived: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: SEED_IDS.investment,
        name: "Investment",
        categoryGroup: "investment",
        defaultInBudget: false,
        isEssential: false,
        icon: null,
        sort: 4,
        isArchived: false,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: SEED_IDS.reconciliation,
        name: "Reconciliation",
        categoryGroup: "system",
        defaultInBudget: false,
        isEssential: false,
        icon: null,
        sort: 5,
        isArchived: false,
        createdAt: at,
        updatedAt: at,
      },
    ];
    for (const row of cats) tx.insert(categories).values(row).run();

    const accs: (typeof accounts.$inferInsert)[] = [
      {
        id: SEED_IDS.hdfcSavings,
        name: "HDFC Savings",
        type: "asset",
        accountGroup: "savings",
        openingBalance: 0,
        openingDate: OPENING_DATE,
        creditLimit: null,
        includeNetWorth: true,
        includeLiquid: true,
        bucketId: null,
        statementDay: null,
        dueDay: null,
        isArchived: false,
        notes: "",
        virtualKind: null,
        createdAt: at,
        updatedAt: at,
      },
      {
        id: SEED_IDS.expense,
        name: "Expense",
        type: "virtual",
        accountGroup: "virtual",
        openingBalance: 0,
        openingDate: OPENING_DATE,
        creditLimit: null,
        includeNetWorth: false,
        includeLiquid: false,
        bucketId: null,
        statementDay: null,
        dueDay: null,
        isArchived: false,
        notes: "",
        virtualKind: "expense",
        createdAt: at,
        updatedAt: at,
      },
      {
        id: SEED_IDS.employer,
        name: "Employer",
        type: "virtual",
        accountGroup: "virtual",
        openingBalance: 0,
        openingDate: OPENING_DATE,
        creditLimit: null,
        includeNetWorth: false,
        includeLiquid: false,
        bucketId: null,
        statementDay: null,
        dueDay: null,
        isArchived: false,
        notes: "",
        virtualKind: "employer",
        createdAt: at,
        updatedAt: at,
      },
      {
        id: SEED_IDS.external,
        name: "External",
        type: "virtual",
        accountGroup: "virtual",
        openingBalance: 0,
        openingDate: OPENING_DATE,
        creditLimit: null,
        includeNetWorth: false,
        includeLiquid: false,
        bucketId: null,
        statementDay: null,
        dueDay: null,
        isArchived: false,
        notes: "",
        virtualKind: "external",
        createdAt: at,
        updatedAt: at,
      },
    ];
    for (const row of accs) tx.insert(accounts).values(row).run();

    tx.insert(settings)
      .values({
        id: 1,
        defaultBudget: rupeesToPaise(31_000),
        monthlySalary: rupeesToPaise(1_40_000),
        salaryDay: 1,
        efMonths: DEFAULT_EF_MONTHS,
        updatedAt: at,
      })
      .run();

    tx.insert(meta)
      .values({ key: "schema_version", value: SCHEMA_VERSION })
      .onConflictDoUpdate({
        target: meta.key,
        set: { value: SCHEMA_VERSION },
      })
      .run();
  });
}

function ensureSchemaVersion(db: AppDb): void {
  const row = db.select().from(meta).where(eq(meta.key, "schema_version")).get();
  if (row) return;
  db.insert(meta).values({ key: "schema_version", value: SCHEMA_VERSION }).run();
}
