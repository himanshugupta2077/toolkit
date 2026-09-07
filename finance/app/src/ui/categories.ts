import type { CategoryListItem } from "../api/store.ts";

export const SUGGESTED_CATEGORY_GROUPS = [
  "Food",
  "Home",
  "Housing",
  "Lifestyle",
  "Transport",
  "Income",
  "Debt",
  "Investment",
  "Finance",
  "System",
  "Other",
] as const;

export type { CategoryListItem };

export type CategoryGroupSection = {
  group: string;
  categories: CategoryListItem[];
};

export function groupCategoryRows(
  rows: readonly CategoryListItem[],
): CategoryGroupSection[] {
  const order: string[] = [];
  const byGroup = new Map<string, CategoryListItem[]>();
  for (const row of rows) {
    const group = row.group.trim() || "Other";
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      order.push(group);
    }
    byGroup.get(group)!.push(row);
  }
  return order.map((group) => ({
    group,
    categories: (byGroup.get(group) ?? []).slice().sort((a, b) => {
      if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.name.localeCompare(b.name);
    }),
  }));
}

export function categoryGroupOptions(rows: readonly CategoryListItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const group = row.group.trim();
    if (!group || seen.has(group.toLowerCase())) continue;
    seen.add(group.toLowerCase());
    out.push(group);
  }
  for (const group of SUGGESTED_CATEGORY_GROUPS) {
    if (seen.has(group.toLowerCase())) continue;
    seen.add(group.toLowerCase());
    out.push(group);
  }
  return out;
}

export function usageLabel(count: number): string {
  if (count <= 0) return "Unused";
  if (count === 1) return "1 use";
  return `${count} uses`;
}
