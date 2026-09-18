import { useState } from "react";
import type { GoalPatchBody, GoalWriteBody } from "../api/store.ts";
import type { GoalCard } from "../engine/index.ts";
import { FieldLabel, FormSelect, namedOptions } from "./formFields.tsx";
import { FILL_TARGET_PROMPT } from "./goals.ts";
import { parseRupeesInput, rupeesInput } from "./wealth.ts";

type GoalFormSheetProps = {
  mode: "add" | "edit";
  goal?: GoalCard;
  buckets: readonly { id: string; name: string }[];
  defaultBucketId: string;
  saving: boolean;
  onSaveAdd: (body: GoalWriteBody) => void;
  onSaveEdit: (body: GoalPatchBody) => void;
};

export function GoalFormSheet({
  mode,
  goal,
  buckets,
  defaultBucketId,
  saving,
  onSaveAdd,
  onSaveEdit,
}: GoalFormSheetProps) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(rupeesInput(goal?.targetAmount ?? null));
  const [date, setDate] = useState(goal?.targetDate ?? "");
  const [bucketId, setBucketId] = useState(goal?.fundingBucketId ?? defaultBucketId);
  const [notes, setNotes] = useState(goal?.notes ?? "");
  const canSave = name.trim() !== "" && !saving;

  function save() {
    const trimmed = target.trim();
    const targetAmount = trimmed === "" ? null : parseRupeesInput(trimmed);
    if (trimmed !== "" && targetAmount == null) return;
    const body = {
      name: name.trim(),
      targetAmount,
      targetDate: date.trim() === "" ? null : date.trim(),
      fundingBucketId: bucketId,
      notes: notes.trim(),
    };
    if (mode === "add") onSaveAdd(body);
    else onSaveEdit(body);
  }

  const targetInvalid = target.trim() !== "" && parseRupeesInput(target) == null;

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
        <label className="block">
          <FieldLabel>Target ₹</FieldLabel>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            placeholder={FILL_TARGET_PROMPT}
            className="mt-1 field"
          />
        </label>
        {goalNeedsBlankHint(goal, target) ? (
          <p className="-mt-2 text-sm text-warn">{FILL_TARGET_PROMPT}</p>
        ) : null}
        {targetInvalid ? (
          <p className="-mt-2 text-sm text-danger">Enter a positive rupee amount, or leave blank.</p>
        ) : null}
        <label className="block">
          <FieldLabel>Target date</FieldLabel>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 field"
          />
        </label>
        <FormSelect
          label="Funding bucket"
          value={bucketId}
          onChange={setBucketId}
          options={namedOptions(buckets)}
        />
        <label className="block">
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="field mt-1 py-2"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={!canSave || targetInvalid}
        onClick={save}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add goal" : "Save"}
      </button>
    </div>
  );
}

function goalNeedsBlankHint(goal: GoalCard | undefined, target: string): boolean {
  return Boolean(goal?.needsTarget && target.trim() === "");
}
