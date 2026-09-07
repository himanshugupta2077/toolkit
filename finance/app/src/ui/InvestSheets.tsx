import { useState } from "react";
import type { InvestAccountLine } from "../api/store.ts";
import { formatInr, type InvestAsset, type InvestAssetKind, type Paise } from "../engine/index.ts";
import { Amount } from "./Privacy.tsx";
import { parseRupeesInput, rupeesInput } from "./wealth.ts";
import { formToAsset, type AssetFormValue } from "./invest.ts";

const inputClass =
  "mt-1 field";

function FieldLabel({ children }: { children: string }) {
  return (
    <span className="kicker">{children}</span>
  );
}

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
    <div className="pb-4">
      <label className="block">
        <FieldLabel>Name</FieldLabel>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={inputClass}
        />
      </label>
      <label className="mt-4 block">
        <FieldLabel>Kind</FieldLabel>
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value as InvestAssetKind })}
          className={inputClass}
        >
          <option value="core">Core</option>
          <option value="theme">Theme</option>
        </select>
      </label>
      <label className="mt-4 block">
        <FieldLabel>Target %</FieldLabel>
        <input
          value={form.targetPct}
          onChange={(e) => setForm({ ...form, targetPct: e.target.value })}
          inputMode="decimal"
          className={inputClass}
        />
      </label>
      <label className="mt-4 block">
        <FieldLabel>Dip priority</FieldLabel>
        <input
          value={form.dipPriority}
          onChange={(e) => setForm({ ...form, dipPriority: e.target.value })}
          inputMode="numeric"
          placeholder="blank = not in dip order"
          className={inputClass}
        />
      </label>
      <label className="mt-4 block">
        <FieldLabel>Instrument note</FieldLabel>
        <input
          value={form.instrumentNote}
          onChange={(e) => setForm({ ...form, instrumentNote: e.target.value })}
          className={inputClass}
        />
      </label>
      <button
        type="button"
        role="switch"
        aria-checked={form.active}
        aria-label="Asset active"
        onClick={() => setForm({ ...form, active: !form.active })}
        className={`mt-4 min-h-11 rounded-full px-4 text-sm font-medium ${
          form.active ? "bg-accent text-accent-fg" : "border border-line text-muted"
        }`}
      >
        {form.active ? "Active" : "Inactive"}
      </button>
      <button
        type="button"
        disabled={!canSave}
        onClick={() => {
          const asset = formToAsset(form, assetId ?? "");
          if (asset) onSave(asset);
        }}
        className="mt-4 btn-primary w-full rounded-full text-sm"
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
          className={inputClass}
        />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label>
          <FieldLabel>From</FieldLabel>
          <select
            className={inputClass}
            value={fromAccountId}
            onChange={(e) => onChangeFrom(e.target.value)}
            aria-label="Dip from account"
          >
            <option value="">Choose…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <FieldLabel>To</FieldLabel>
          <select
            className={inputClass}
            value={toAccountId}
            onChange={(e) => onChangeTo(e.target.value)}
            aria-label="Dip to account"
          >
            <option value="">Choose…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
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
                className={inputClass}
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
