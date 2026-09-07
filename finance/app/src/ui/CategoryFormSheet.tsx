import { useState } from "react";
import type { CategoryListItem, CategoryPatchBody, CategoryWriteBody } from "../api/store.ts";
import { categoryGroupOptions } from "./categories.ts";

type CategoryFormSheetProps = {
  mode: "add" | "edit";
  category?: CategoryListItem;
  categories: readonly CategoryListItem[];
  saving: boolean;
  onSaveAdd: (body: CategoryWriteBody) => void;
  onSaveEdit: (body: CategoryPatchBody) => void;
};

function chipClass(on: boolean): string {
  return `chip ${on ? "chip-on" : "chip-off"}`;
}

export function CategoryFormSheet({
  mode,
  category,
  categories,
  saving,
  onSaveAdd,
  onSaveEdit,
}: CategoryFormSheetProps) {
  const [name, setName] = useState(category?.name ?? "");
  const [group, setGroup] = useState(category?.group ?? "Lifestyle");
  const [customGroup, setCustomGroup] = useState("");
  const [defaultInBudget, setDefaultInBudget] = useState(category?.defaultInBudget ?? true);
  const [isEssential, setIsEssential] = useState(category?.isEssential ?? false);
  const groups = categoryGroupOptions(categories);
  const chosenGroup = customGroup.trim() || group;
  const canSave = name.trim() !== "" && chosenGroup !== "" && !saving;

  return (
    <div className="pb-4">
      <label className="block">
        <span className="kicker">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 field"
        />
      </label>
      <p className="mt-4 kicker">Group</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g}
            type="button"
            className={chipClass(customGroup === "" && group === g)}
            onClick={() => {
              setGroup(g);
              setCustomGroup("");
            }}
          >
            {g}
          </button>
        ))}
      </div>
      <input
        value={customGroup}
        onChange={(e) => setCustomGroup(e.target.value)}
        placeholder="Or type a group"
        className="mt-2 field"
      />
      <button
        type="button"
        className={`mt-4 flex min-h-11 w-full items-center justify-between rounded-xl border border-line px-3 text-sm ${
          defaultInBudget ? "text-ink" : "text-muted"
        }`}
        onClick={() => setDefaultInBudget((v) => !v)}
      >
        Default include-in-budget
        <span className="font-medium">{defaultInBudget ? "On" : "Off"}</span>
      </button>
      <button
        type="button"
        className={`mt-2 flex min-h-11 w-full items-center justify-between rounded-xl border border-line px-3 text-sm ${
          isEssential ? "text-ink" : "text-muted"
        }`}
        onClick={() => setIsEssential((v) => !v)}
      >
        Counts as essential (EF target)
        <span className="font-medium">{isEssential ? "On" : "Off"}</span>
      </button>
      <button
        type="button"
        disabled={!canSave}
        onClick={() => {
          if (mode === "add") {
            onSaveAdd({
              name: name.trim(),
              group: chosenGroup,
              defaultInBudget,
              isEssential,
            });
          } else {
            onSaveEdit({
              name: name.trim(),
              group: chosenGroup,
              defaultInBudget,
              isEssential,
            });
          }
        }}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add category" : "Save"}
      </button>
    </div>
  );
}
