import { useState } from "react";
import type { InvestAccountLine } from "../api/store.ts";
import { formatInr, type InvestAsset, type InvestAssetKind, type Paise } from "../engine/index.ts";
import { FieldLabel, FormSelect } from "./formFields.tsx";
import { Amount } from "./Privacy.tsx";
import { parseRupeesInput, rupeesInput } from "./wealth.ts";
import { formToAsset, type AssetFormValue } from "./invest.ts";

export function AssetFormSheet({
  mode,
  assetId,
  initial,
  saving,
  onSave,
}: {
  mode: "add" | "edit";
  assetId?: string;
  initial: AssetFormValue;
  saving: boolean;
  onSave: (asset: InvestAsset) => void;
}) {
  const [form, setForm] = useState(initial);
  const parsed = formToAsset(form, assetId ?? "");
  const canSave = parsed != null && form.name.trim() !== "" && !saving;

  return (
    <div className="pb-1">
      <div className="space-y-4">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 field"
          />
        </label>
        <FormSelect
          label="Kind"
          value={form.kind}
          onChange={(v) => setForm({ ...form, kind: v as InvestAssetKind })}
          options={[
            { value: "core", label: "Core" },
            { value: "theme", label: "Theme" },
          ]}
        />
        <label className="block">
          <FieldLabel>Target %</FieldLabel>
          <input
            value={form.targetPct}
            onChange={(e) => setForm({ ...form, targetPct: e.target.value })}
            inputMode="decimal"
            className="mt-1 field"
          />
        </label>
        <label className="block">
          <FieldLabel>Dip priority</FieldLabel>
          <input
            value={form.dipPriority}
            onChange={(e) => setForm({ ...form, dipPriority: e.target.value })}
            inputMode="numeric"
            placeholder="blank = not in dip order"
            className="mt-1 field"
          />
        </label>
        <label className="block">
          <FieldLabel>Instrument note</FieldLabel>
          <input
            value={form.instrumentNote}
            onChange={(e) => setForm({ ...form, instrumentNote: e.target.value })}
            className="mt-1 field"
          />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={form.active}
          aria-label="Asset active"
          onClick={() => setForm({ ...form, active: !form.active })}
          className={`min-h-11 rounded-full px-4 text-sm font-medium ${
            form.active ? "bg-accent text-accent-fg" : "border border-line text-muted"
          }`}
        >
          {form.active ? "Active" : "Inactive"}
        </button>
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={() => {
          const asset = formToAsset(form, assetId ?? "");
          if (asset) onSave(asset);
        }}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add asset" : "Save asset"}
      </button>
    </div>
  );
}

export type DeployLineDraft = {
  assetId: string;
  name: string;
  amount: Paise;
};

export function DeploySheet({
  balance,
  accounts,
  fromAccountId,
  toAccountId,
  lines,
  saving,
  onChangeFrom,
  onChangeTo,
  onChangeLine,
  onChangeAmount,
  amount,
  onDeploy,
}: {
  balance: Paise;
  accounts: readonly InvestAccountLine[];
  fromAccountId: string;
  toAccountId: string;
  lines: readonly DeployLineDraft[];
  amount: Paise;
  saving: boolean;
  onChangeFrom: (id: string) => void;
  onChangeTo: (id: string) => void;
  onChangeLine: (assetId: string, amount: Paise) => void;
  onChangeAmount: (amount: Paise) => void;
  onDeploy: () => void;
}) {
  const sum = lines.reduce((total, row) => total + row.amount, 0);
  const blocked =
    amount <= 0 ||
    amount > balance ||
    fromAccountId === "" ||
    toAccountId === "" ||
    fromAccountId === toAccountId ||
    sum !== amount;

  return (
    <div className="pb-4">
      <p className="text-sm text-muted">
        Reserve <Amount>{formatInr(balance)}</Amount>
      </p>
      <label className="mt-4 block">
        <FieldLabel>Amount ₹</FieldLabel>
        <input
          value={rupeesInput(amount)}
          onChange={(e) => {
            const parsed = parseRupeesInput(e.target.value);
            if (parsed != null) onChangeAmount(parsed);
          }}
          inputMode="decimal"
          aria-label="Deploy amount rupees"
          className="mt-1 field"
        />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <FormSelect
          label="From"
          value={fromAccountId}
          onChange={onChangeFrom}
          placeholder="Choose…"
          options={accounts.map((account) => ({ value: account.id, label: account.name }))}
        />
        <FormSelect
          label="To"
          value={toAccountId}
          onChange={onChangeTo}
          placeholder="Choose…"
          options={accounts.map((account) => ({ value: account.id, label: account.name }))}
        />
      </div>
      <ul className="mt-4 space-y-2">
        {lines.map((row) => (
          <li key={row.assetId}>
            <label className="block">
              <FieldLabel>{row.name}</FieldLabel>
              <input
                value={rupeesInput(row.amount)}
                onChange={(e) => {
                  const parsed = parseRupeesInput(e.target.value);
                  if (parsed != null) onChangeLine(row.assetId, parsed);
                }}
                inputMode="decimal"
                aria-label={`${row.name} dip rupees`}
                className="mt-1 field"
              />
            </label>
          </li>
        ))}
      </ul>
      {blocked && amount > balance ? (
        <p className="mt-2 text-sm text-danger">More than the reserve.</p>
      ) : null}
      <button
        type="button"
        disabled={blocked || saving}
        onClick={onDeploy}
        className="mt-4 btn-primary w-full rounded-full text-sm"
      >
        {saving ? "Deploying…" : "Deploy"}
      </button>
    </div>
  );
}
