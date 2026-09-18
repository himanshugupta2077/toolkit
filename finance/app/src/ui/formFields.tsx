import { useState } from "react";
import { Keypad } from "./Keypad.tsx";
import {
  amountDraftFromText,
  amountExpression,
  applyAmountKey,
  type AmountDraft,
} from "./quickAdd.ts";

export function FieldLabel({ children }: { children: string }) {
  return <span className="kicker">{children}</span>;
}

export function chipClass(on: boolean): string {
  return `chip ${on ? "chip-on" : "chip-off"}`;
}

export type FormSelectOption = {
  value: string;
  label: string;
  group?: string;
};

export function categoryOptions(
  rows: readonly { id: string; name: string; group?: string }[],
): FormSelectOption[] {
  return rows.map((row) => ({
    value: row.id,
    label: row.name,
    group: row.group,
  }));
}

export function namedOptions(
  rows: readonly { id: string; name: string }[],
): FormSelectOption[] {
  return rows.map((row) => ({ value: row.id, label: row.name }));
}

function SelectCaret() {
  return (
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
      ▾
    </span>
  );
}

export function FormSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly FormSelectOption[];
  placeholder?: string;
}) {
  const ungrouped: FormSelectOption[] = [];
  const groupOrder: string[] = [];
  const byGroup = new Map<string, FormSelectOption[]>();
  for (const opt of options) {
    const group = opt.group?.trim();
    if (!group) {
      ungrouped.push(opt);
      continue;
    }
    const list = byGroup.get(group);
    if (list) list.push(opt);
    else {
      byGroup.set(group, [opt]);
      groupOrder.push(group);
    }
  }

  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <span className="relative mt-1 block">
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="field appearance-none pr-9"
        >
          {placeholder != null ? <option value="">{placeholder}</option> : null}
          {ungrouped.map((opt) => (
            <option key={opt.value || "empty"} value={opt.value}>
              {opt.label}
            </option>
          ))}
          {groupOrder.map((group) => (
            <optgroup key={group} label={group}>
              {(byGroup.get(group) ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <SelectCaret />
      </span>
    </label>
  );
}

export function AmountField({
  label = "Amount",
  amount,
  onChange,
  plus = true,
}: {
  label?: string;
  amount: AmountDraft;
  onChange: (next: AmountDraft) => void;
  plus?: boolean;
}) {
  const [keypadOpen, setKeypadOpen] = useState(false);
  const expr = amountExpression(amount);

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-1 flex gap-2">
        <div className="field flex min-w-0 flex-1 items-center gap-1">
          <span className="text-muted">₹</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            aria-label={label}
            value={expr}
            placeholder="0"
            onChange={(e) => onChange(amountDraftFromText(e.target.value))}
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold tabular-nums text-ink outline-none placeholder:font-medium placeholder:text-muted"
          />
        </div>
        <button
          type="button"
          aria-pressed={keypadOpen}
          aria-label={keypadOpen ? "Hide keypad" : "Show keypad"}
          onClick={() => setKeypadOpen((open) => !open)}
          className={`${chipClass(keypadOpen)} shrink-0 px-3`}
        >
          Keypad
        </button>
      </div>
      {keypadOpen ? (
        <div className="mt-3">
          <Keypad plus={plus} onKey={(key) => onChange(applyAmountKey(amount, key))} />
        </div>
      ) : null}
    </div>
  );
}
