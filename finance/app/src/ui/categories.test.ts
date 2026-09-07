import { describe, expect, it } from "vitest";
import type { CategoryListItem } from "../api/store.ts";
import { categoryGroupOptions, groupCategoryRows, usageLabel } from "./categories.ts";

function row(partial: Partial<CategoryListItem> & Pick<CategoryListItem, "id" | "name">): CategoryListItem {
  return {
    group: "Lifestyle",
    defaultInBudget: true,
    icon: null,
    isArchived: false,
    sort: 0,
    isEssential: false,
    usageCount: 0,
    ...partial,
  };
}

describe("category grouping", () => {
  it("groups by group, archived last, and keeps usage copy", () => {
    const sections = groupCategoryRows([
      row({ id: "a", name: "Milk", group: "Food", sort: 2, usageCount: 4 }),
      row({ id: "b", name: "Old", group: "Food", isArchived: true }),
      row({ id: "c", name: "Rent", group: "Housing", usageCount: 1 }),
    ]);
    expect(sections.map((s) => s.group)).toEqual(["Food", "Housing"]);
    expect(sections[0]?.categories.map((c) => c.name)).toEqual(["Milk", "Old"]);
    expect(usageLabel(0)).toBe("Unused");
    expect(usageLabel(1)).toBe("1 use");
    expect(usageLabel(4)).toBe("4 uses");
  });

  it("offers existing groups before suggested ones", () => {
    const opts = categoryGroupOptions([row({ id: "a", name: "Milk", group: "Food" })]);
    expect(opts[0]).toBe("Food");
    expect(opts).toContain("Lifestyle");
  });
});
