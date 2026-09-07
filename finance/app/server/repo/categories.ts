import { and, count, eq, isNull } from "drizzle-orm";
import type { Category } from "../../src/engine/types.ts";
import type { AppDb } from "../db/client.ts";
import {
  categories,
  expectedInflows,
  ledgerEntries,
  oneTimePlans,
  recurringPlans,
} from "../db/schema.ts";
import { nowIso, uuidv7 } from "../ids.ts";
import { mapCategory } from "./mappers.ts";

export type CategoryListItem = Category & {
  isEssential: boolean;
  usageCount: number;
};

export type NewCategoryInput = {
  name: string;
  group: string;
  defaultInBudget: boolean;
  isEssential: boolean;
};

export type CategoryPatch = {
  name?: string;
  group?: string;
  defaultInBudget?: boolean;
  isEssential?: boolean;
  isArchived?: boolean;
};

function usageCount(db: AppDb, id: string): number {
  const ledger =
    db
      .select({ n: count() })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.categoryId, id), isNull(ledgerEntries.deletedAt)))
      .get()?.n ?? 0;
  const recurring =
    db
      .select({ n: count() })
      .from(recurringPlans)
      .where(eq(recurringPlans.categoryId, id))
      .get()?.n ?? 0;
  const oneTime =
    db
      .select({ n: count() })
      .from(oneTimePlans)
      .where(eq(oneTimePlans.categoryId, id))
      .get()?.n ?? 0;
  const inflows =
    db
      .select({ n: count() })
      .from(expectedInflows)
      .where(eq(expectedInflows.categoryId, id))
      .get()?.n ?? 0;
  return ledger + recurring + oneTime + inflows;
}

function toListItem(
  db: AppDb,
  row: typeof categories.$inferSelect,
): CategoryListItem {
  return {
    ...mapCategory(row),
    isEssential: row.isEssential,
    usageCount: usageCount(db, row.id),
  };
}

export function listCategoryRows(db: AppDb): CategoryListItem[] {
  return db
    .select()
    .from(categories)
    .all()
    .map((row) => toListItem(db, row))
    .sort((a, b) => {
      if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
      const g = a.group.localeCompare(b.group);
      if (g !== 0) return g;
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.name.localeCompare(b.name);
    });
}

function nameTaken(db: AppDb, name: string, exceptId?: string): boolean {
  const row = db.select({ id: categories.id, name: categories.name }).from(categories).all();
  const needle = name.trim().toLowerCase();
  return row.some((item) => item.name.trim().toLowerCase() === needle && item.id !== exceptId);
}

function nextSort(db: AppDb): number {
  const rows = db.select({ sort: categories.sort }).from(categories).all();
  if (rows.length === 0) return 1;
  return Math.max(...rows.map((row) => row.sort)) + 1;
}

export function insertCategory(db: AppDb, input: NewCategoryInput): CategoryListItem {
  const name = input.name.trim();
  const group = input.group.trim() || "Other";
  if (name === "") throw new Error("Name is required.");
  if (nameTaken(db, name)) throw new Error("A category with that name already exists.");
  const at = nowIso();
  const id = uuidv7();
  db.insert(categories)
    .values({
      id,
      name,
      categoryGroup: group,
      defaultInBudget: input.defaultInBudget,
      isEssential: input.isEssential,
      icon: null,
      sort: nextSort(db),
      isArchived: false,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  const row = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!row) throw new Error("insert category failed");
  return toListItem(db, row);
}

export function updateCategory(
  db: AppDb,
  id: string,
  patch: CategoryPatch,
): CategoryListItem | null {
  const current = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!current) return null;
  if (patch.name != null) {
    const name = patch.name.trim();
    if (name === "") throw new Error("Name is required.");
    if (nameTaken(db, name, id)) throw new Error("A category with that name already exists.");
  }
  const group =
    patch.group == null ? current.categoryGroup : patch.group.trim() || "Other";
  const at = nowIso();
  db.update(categories)
    .set({
      name: patch.name != null ? patch.name.trim() : current.name,
      categoryGroup: group,
      defaultInBudget: patch.defaultInBudget ?? current.defaultInBudget,
      isEssential: patch.isEssential ?? current.isEssential,
      isArchived: patch.isArchived ?? current.isArchived,
      updatedAt: at,
    })
    .where(eq(categories.id, id))
    .run();
  const row = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!row) throw new Error("update category failed");
  return toListItem(db, row);
}

export function setEssentialIds(db: AppDb, ids: readonly string[]): CategoryListItem[] {
  const known = new Set(db.select({ id: categories.id }).from(categories).all().map((row) => row.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error("Unknown category.");
  }
  const want = new Set(ids);
  const at = nowIso();
  for (const id of known) {
    db.update(categories)
      .set({ isEssential: want.has(id), updatedAt: at })
      .where(eq(categories.id, id))
      .run();
  }
  return listCategoryRows(db);
}
