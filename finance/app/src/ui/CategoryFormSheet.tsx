import { useState } from "react";
import type { CategoryListItem, CategoryPatchBody, CategoryWriteBody } from "../api/store.ts";
import { categoryGroupOptions } from "./categories.ts";
import { FieldLabel, FormSelect } from "./formFields.tsx";

type CategoryFormSheetProps = {
  mode: "add" | "edit";
  category?: CategoryListItem;
  categories: readonly CategoryListItem[];
  saving: boolean;
  onSaveAdd: (body: CategoryWriteBody) => void;
  onSaveEdit: (body: CategoryPatchBody) => void;
};

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
  const groups = categoryGroupOptions(categories);
  const chosenGroup = customGroup.trim() || group;
  const canSave = name.trim() !== "" && chosenGroup !== "" && !saving;

  return (
    <div className="pb-1">
      <div className="space-y-4">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 field"
          />
        </label>
        <FormSelect
          label="Group"
          value={group}
          onChange={(v) => {
            setGroup(v);
            setCustomGroup("");
          }}
          options={groups.map((g) => ({ value: g, label: g }))}
        />
        <label className="block">
          <FieldLabel>Or type a group</FieldLabel>
          <input
            value={customGroup}
            onChange={(e) => setCustomGroup(e.target.value)}
            placeholder="Custom group"
            className="mt-1 field"
          />
        </label>
        <button
          type="button"
          className={`flex min-h-11 w-full items-center justify-between rounded-xl border border-line px-3 text-sm ${
            defaultInBudget ? "text-ink" : "text-muted"
          }`}
          onClick={() => setDefaultInBudget((v) => !v)}
        >
          Default include-in-budget
          <span className="font-medium">{defaultInBudget ? "On" : "Off"}</span>
        </button>
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={() => {
          if (mode === "add") {
            onSaveAdd({
              name: name.trim(),
              group: chosenGroup,
              defaultInBudget,
            });
          } else {
            onSaveEdit({
              name: name.trim(),
              group: chosenGroup,
              defaultInBudget,
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
