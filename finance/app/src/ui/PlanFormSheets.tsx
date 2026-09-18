import { useState } from "react";
import type {
  InflowWriteBody,
  OneTimeWriteBody,
  RecurringWriteBody,
} from "../api/store.ts";
import {
  isIsoDate,
  RECURRING_KINDS,
  todayIst,
  type ExpectedInflow,
  type InflowStatus,
  type IsoDate,
  type OneTimePlan,
  type OneTimeStatus,
  type PlanPriority,
  type RecurringFrequency,
  type RecurringKind,
  type RecurringPlan,
} from "../engine/index.ts";
import type { Account, Category } from "../engine/types.ts";
import {
  AmountField,
  categoryOptions,
  chipClass,
  FieldLabel,
  FormSelect,
  namedOptions,
} from "./formFields.tsx";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  FREQUENCY_LABELS,
  INFLOW_STATUS_LABELS,
  KIND_HELP,
  liveCategories,
  ONE_TIME_KIND_HELP,
  ONE_TIME_STATUS_LABELS,
  payFromAccounts,
  PRIORITY_LABELS,
  RECURRING_KIND_LABELS,
} from "./plan.ts";
import { amountPaise, EMPTY_AMOUNT, type AmountDraft } from "./quickAdd.ts";

const FREQUENCIES: RecurringFrequency[] = ["monthly", "yearly", "weekly", "custom_months"];
const KINDS: RecurringKind[] = [...RECURRING_KINDS];
const PRIORITIES: PlanPriority[] = ["high", "medium", "low"];
const ONE_STATUSES: OneTimeStatus[] = ["planned", "completed", "cancelled"];
const INFLOW_STATUSES: InflowStatus[] = ["expected", "received", "dropped"];

function DeletePlanRow({
  noun,
  saving,
  onDelete,
}: {
  noun: string;
  saving: boolean;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div className="card-danger mt-3 p-3">
        <p className="text-sm text-ink">
          Delete this {noun}? Planning only — the ledger is untouched.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onDelete}
            className="btn-danger"
          >
            {saving ? "Deleting…" : `Delete ${noun}`}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setConfirm(false)}
            className="btn-quiet text-base"
          >
            Keep
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => setConfirm(true)}
      className="btn-quiet mt-3 w-full text-danger"
    >
      Delete
    </button>
  );
}

export function BudgetCapSheet({
  cap,
  saving,
  onSave,
}: {
  cap: number;
  saving: boolean;
  onSave: (cap: number, applyToFuture: boolean) => void;
}) {
  const [amount, setAmount] = useState<AmountDraft>(amountDraftFromPaise(cap));
  const [applyToFuture, setApplyToFuture] = useState(false);
  const paise = amountPaise(amount);
  const canSave = paise > 0 && !saving;

  return (
    <div className="pb-1">
      <div className="space-y-4">
        <AmountField amount={amount} onChange={setAmount} label="Cap" />
        <button
          type="button"
          className={chipClass(applyToFuture)}
          onClick={() => setApplyToFuture((v) => !v)}
        >
          Apply to future months too
        </button>
        <p className="text-xs text-muted">
          Future months without their own row follow Settings default. Toggling this also updates
          that default and any later month rows already stored.
        </p>
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={() => onSave(paise, applyToFuture)}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : "Save cap"}
      </button>
    </div>
  );
}

export function RecurringFormSheet({
  mode,
  plan,
  categories,
  accounts,
  today = todayIst(),
  saving,
  onSave,
  onDelete,
}: {
  mode: "add" | "edit";
  plan?: RecurringPlan;
  categories: readonly Category[];
  accounts: readonly Account[];
  today?: IsoDate;
  saving: boolean;
  onSave: (body: RecurringWriteBody) => void;
  onDelete?: () => void;
}) {
  const cats = liveCategories(categories);
  const payFrom = payFromAccounts(accounts);
  const [name, setName] = useState(plan?.name ?? "");
  const [amount, setAmount] = useState<AmountDraft>(
    plan ? amountDraftFromPaise(plan.amount) : EMPTY_AMOUNT,
  );
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? cats[0]?.id ?? "");
  const [frequency, setFrequency] = useState<RecurringFrequency>(plan?.frequency ?? "monthly");
  const [everyN, setEveryN] = useState(plan?.intervalMonths != null ? String(plan.intervalMonths) : "3");
  const [startDate, setStartDate] = useState(plan?.startDate ?? today);
  const [endDate, setEndDate] = useState(plan?.endDate ?? "");
  const [kind, setKind] = useState<RecurringKind | "">(plan?.kind ?? "");
  const [payFromId, setPayFromId] = useState(plan?.payFromAccountId ?? "");
  const [autoPost, setAutoPost] = useState(plan?.autoPost ?? false);
  const [notes, setNotes] = useState(plan?.notes ?? "");

  const paise = amountPaise(amount);
  const n = Number(everyN);
  const nOk = frequency !== "custom_months" || (Number.isInteger(n) && n >= 1);
  const canSave = name.trim() !== "" && paise > 0 && categoryId !== "" && nOk && !saving;

  function save() {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      categoryId,
      frequency,
      intervalMonths: frequency === "custom_months" ? n : null,
      amount: paise,
      startDate: isIsoDate(startDate) ? startDate : null,
      endDate: isIsoDate(endDate) ? endDate : null,
      active: plan?.active ?? true,
      kind: kind === "" ? null : kind,
      payFromAccountId: payFromId || null,
      autoPost,
      notes,
    });
  }

  return (
    <div className="pb-1">
      <div className="space-y-4">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rent"
            className="mt-1 field"
          />
        </label>
        <AmountField amount={amount} onChange={setAmount} />
        <FormSelect
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          options={categoryOptions(cats)}
        />
        <FormSelect
          label="Frequency"
          value={frequency}
          onChange={(v) => setFrequency(v as RecurringFrequency)}
          options={FREQUENCIES.map((freq) => ({
            value: freq,
            label: FREQUENCY_LABELS[freq],
          }))}
        />
        {frequency === "custom_months" ? (
          <label className="block">
            <FieldLabel>Every N months</FieldLabel>
            <input
              inputMode="numeric"
              value={everyN}
              onChange={(e) => setEveryN(e.target.value)}
              className="mt-1 field"
            />
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <label>
            <FieldLabel>Start</FieldLabel>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 field"
            />
          </label>
          <label>
            <FieldLabel>End</FieldLabel>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 field"
            />
          </label>
        </div>
        <p className="-mt-2 text-xs text-muted">Leave end blank for until I stop.</p>
        <FormSelect
          label="Kind"
          value={kind}
          onChange={(v) => setKind(v as RecurringKind | "")}
          options={[
            { value: "", label: "Auto" },
            ...KINDS.map((k) => ({ value: k, label: RECURRING_KIND_LABELS[k] })),
          ]}
        />
        <p className="-mt-2 text-xs text-muted">{KIND_HELP}</p>
        {payFrom.length > 0 ? (
          <FormSelect
            label="Pay from"
            value={payFromId}
            onChange={setPayFromId}
            options={[{ value: "", label: "None" }, ...namedOptions(payFrom)]}
          />
        ) : null}
        <button type="button" className={chipClass(autoPost)} onClick={() => setAutoPost((v) => !v)}>
          Auto-propose (off by default)
        </button>
        <label className="block">
          <FieldLabel>Note</FieldLabel>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 field" />
        </label>
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add recurring" : "Save"}
      </button>
      {mode === "edit" && onDelete ? (
        <DeletePlanRow noun="recurring" saving={saving} onDelete={onDelete} />
      ) : null}
    </div>
  );
}

export function OneTimeFormSheet({
  mode,
  plan,
  categories,
  accounts,
  today = todayIst(),
  saving,
  onSave,
  onDelete,
}: {
  mode: "add" | "edit";
  plan?: OneTimePlan;
  categories: readonly Category[];
  accounts: readonly Account[];
  today?: IsoDate;
  saving: boolean;
  onSave: (body: OneTimeWriteBody) => void;
  onDelete?: () => void;
}) {
  const cats = liveCategories(categories);
  const payFrom = payFromAccounts(accounts);
  const [name, setName] = useState(plan?.name ?? "");
  const [amount, setAmount] = useState<AmountDraft>(
    plan ? amountDraftFromPaise(plan.amount) : EMPTY_AMOUNT,
  );
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? cats[0]?.id ?? "");
  const [expectedDate, setExpectedDate] = useState(plan?.expectedDate ?? today);
  const [priority, setPriority] = useState<PlanPriority>(plan?.priority ?? "medium");
  const [status, setStatus] = useState<OneTimeStatus>(plan?.status ?? "planned");
  const [kind, setKind] = useState<RecurringKind | "">(plan?.kind ?? "");
  const [payFromId, setPayFromId] = useState(plan?.payFromAccountId ?? "");
  const [notes, setNotes] = useState(plan?.notes ?? "");

  const paise = amountPaise(amount);
  const canSave =
    name.trim() !== "" && paise > 0 && categoryId !== "" && isIsoDate(expectedDate) && !saving;

  function save() {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      categoryId,
      expectedDate,
      amount: paise,
      priority,
      status,
      kind: kind === "" ? null : kind,
      payFromAccountId: payFromId || null,
      notes,
    });
  }

  return (
    <div className="pb-1">
      <div className="space-y-4">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Flights"
            className="mt-1 field"
          />
        </label>
        <AmountField amount={amount} onChange={setAmount} />
        <FormSelect
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          options={categoryOptions(cats)}
        />
        <label className="block">
          <FieldLabel>Expected date</FieldLabel>
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className="mt-1 field"
          />
        </label>
        <FormSelect
          label="Kind"
          value={kind}
          onChange={(v) => setKind(v as RecurringKind | "")}
          options={[
            { value: "", label: "None" },
            { value: "bill", label: RECURRING_KIND_LABELS.bill },
          ]}
        />
        <p className="-mt-2 text-xs text-muted">{ONE_TIME_KIND_HELP}</p>
        <FormSelect
          label="Priority"
          value={priority}
          onChange={(v) => setPriority(v as PlanPriority)}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
        />
        {mode === "edit" ? (
          <>
            <FormSelect
              label="Status"
              value={status}
              onChange={(v) => setStatus(v as OneTimeStatus)}
              options={ONE_STATUSES.map((s) => ({
                value: s,
                label: ONE_TIME_STATUS_LABELS[s],
              }))}
            />
            <p className="-mt-2 text-xs text-muted">
              Complete does not write a ledger row. Log the spend with Quick Add when you pay.
            </p>
          </>
        ) : null}
        {payFrom.length > 0 ? (
          <FormSelect
            label="Pay from"
            value={payFromId}
            onChange={setPayFromId}
            options={[{ value: "", label: "None" }, ...namedOptions(payFrom)]}
          />
        ) : null}
        <label className="block">
          <FieldLabel>Note</FieldLabel>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 field" />
        </label>
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add one-time" : "Save"}
      </button>
      {mode === "edit" && onDelete ? (
        <DeletePlanRow noun="one-time" saving={saving} onDelete={onDelete} />
      ) : null}
    </div>
  );
}

export function InflowFormSheet({
  mode,
  inflow,
  categories,
  today = todayIst(),
  saving,
  onSave,
  onDelete,
}: {
  mode: "add" | "edit";
  inflow?: ExpectedInflow;
  categories: readonly Category[];
  today?: IsoDate;
  saving: boolean;
  onSave: (body: InflowWriteBody) => void;
  onDelete?: () => void;
}) {
  const cats = liveCategories(categories);
  const [name, setName] = useState(inflow?.name ?? "");
  const [amount, setAmount] = useState<AmountDraft>(
    inflow ? amountDraftFromPaise(inflow.amount) : EMPTY_AMOUNT,
  );
  const [categoryId, setCategoryId] = useState(inflow?.categoryId || "");
  const [expectedDate, setExpectedDate] = useState(inflow?.expectedDate ?? today);
  const [isLiquid, setIsLiquid] = useState(inflow?.isLiquid ?? true);
  const [status, setStatus] = useState<InflowStatus>(inflow?.status ?? "expected");
  const [notes, setNotes] = useState(inflow?.notes ?? "");
  const paise = amountPaise(amount);
  const canSave = name.trim() !== "" && paise > 0 && isIsoDate(expectedDate) && !saving;

  function save() {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      categoryId: categoryId || null,
      expectedDate,
      amount: paise,
      isLiquid,
      status,
      notes,
    });
  }

  return (
    <div className="pb-1">
      <p className="text-sm text-muted">
        Free to allocate ignores these until they land in the ledger.
      </p>
      <div className="mt-4 space-y-4">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bonus"
            className="mt-1 field"
          />
        </label>
        <AmountField amount={amount} onChange={setAmount} />
        <FormSelect
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          placeholder="None"
          options={categoryOptions(cats)}
        />
        <label className="block">
          <FieldLabel>Expected date</FieldLabel>
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className="mt-1 field"
          />
        </label>
        <button type="button" className={chipClass(isLiquid)} onClick={() => setIsLiquid((v) => !v)}>
          Liquid
        </button>
        {mode === "edit" ? (
          <FormSelect
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as InflowStatus)}
            options={INFLOW_STATUSES.map((s) => ({
              value: s,
              label: INFLOW_STATUS_LABELS[s],
            }))}
          />
        ) : null}
        <label className="block">
          <FieldLabel>Note</FieldLabel>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 field" />
        </label>
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add inflow" : "Save"}
      </button>
      {mode === "edit" && onDelete ? (
        <DeletePlanRow noun="inflow" saving={saving} onDelete={onDelete} />
      ) : null}
    </div>
  );
}
