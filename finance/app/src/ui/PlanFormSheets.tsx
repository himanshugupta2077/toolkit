import { useState } from "react";
import type {
  InflowWriteBody,
  OneTimeWriteBody,
  RecurringWriteBody,
} from "../api/store.ts";
import {
  isIsoDate,
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
import { Keypad } from "./Keypad.tsx";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  chipClass,
  FREQUENCY_LABELS,
  INFLOW_STATUS_LABELS,
  liveCategories,
  ONE_TIME_STATUS_LABELS,
  payFromAccounts,
  PRIORITY_LABELS,
  RECURRING_KIND_LABELS,
} from "./plan.ts";
import {
  amountExpression,
  amountPaise,
  applyAmountKey,
  EMPTY_AMOUNT,
  type AmountDraft,
  type AmountKey,
} from "./quickAdd.ts";

const FREQUENCIES: RecurringFrequency[] = ["monthly", "yearly", "weekly", "custom_months"];
const KINDS: RecurringKind[] = ["loan_emi", "lifestyle", "investment"];
const PRIORITIES: PlanPriority[] = ["high", "medium", "low"];
const ONE_STATUSES: OneTimeStatus[] = ["planned", "completed", "cancelled"];
const INFLOW_STATUSES: InflowStatus[] = ["expected", "received", "dropped"];

function FieldLabel({ children }: { children: string }) {
  return (
    <span className="kicker">{children}</span>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <p className="text-sm text-muted">
          This month&apos;s cap. Planning never posts to the ledger.
        </p>
        <p className="mt-3 hero-num">
          {amountExpression(amount) ? `₹${amountExpression(amount)}` : "₹0"}
        </p>
        <button
          type="button"
          className={`mt-4 ${chipClass(applyToFuture)}`}
          onClick={() => setApplyToFuture((v) => !v)}
        >
          Apply to future months too
        </button>
        <p className="mt-2 text-xs text-muted">
          Future months without their own row follow Settings default. Toggling this also updates
          that default and any later month rows already stored.
        </p>
      </div>
      <div className="shrink-0 pt-2">
        <Keypad onKey={(key: AmountKey) => setAmount((d) => applyAmountKey(d, key))} />
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={() => onSave(paise, applyToFuture)}
        className="mt-3 btn-primary w-full"
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
}: {
  mode: "add" | "edit";
  plan?: RecurringPlan;
  categories: readonly Category[];
  accounts: readonly Account[];
  today?: IsoDate;
  saving: boolean;
  onSave: (body: RecurringWriteBody) => void;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rent"
            className="mt-1 field"
          />
        </label>
        <p className="mt-4 hero-num">
          {amountExpression(amount) ? `₹${amountExpression(amount)}` : "₹0"}
        </p>

        <p className="mt-4 mb-2">
          <FieldLabel>Category</FieldLabel>
        </p>
        <div className="flex flex-wrap gap-2">
          {cats.map((row) => (
            <button
              key={row.id}
              type="button"
              className={chipClass(categoryId === row.id)}
              onClick={() => setCategoryId(row.id)}
            >
              {row.name}
            </button>
          ))}
        </div>

        <p className="mt-4 mb-2">
          <FieldLabel>Frequency</FieldLabel>
        </p>
        <div className="flex flex-wrap gap-2">
          {FREQUENCIES.map((freq) => (
            <button
              key={freq}
              type="button"
              className={chipClass(frequency === freq)}
              onClick={() => setFrequency(freq)}
            >
              {FREQUENCY_LABELS[freq]}
            </button>
          ))}
        </div>
        {frequency === "custom_months" ? (
          <label className="mt-3 block">
            <FieldLabel>Every N months</FieldLabel>
            <input
              inputMode="numeric"
              value={everyN}
              onChange={(e) => setEveryN(e.target.value)}
              className="mt-1 field"
            />
          </label>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
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
        <p className="mt-1 text-xs text-muted">Leave end blank for until I stop.</p>

        <p className="mt-4 mb-2">
          <FieldLabel>Kind</FieldLabel>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chipClass(kind === "")} onClick={() => setKind("")}>
            Auto
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={chipClass(kind === k)}
              onClick={() => setKind(k)}
            >
              {RECURRING_KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {payFrom.length > 0 ? (
          <>
            <p className="mt-4 mb-2">
              <FieldLabel>Pay from</FieldLabel>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={chipClass(payFromId === "")}
                onClick={() => setPayFromId("")}
              >
                None
              </button>
              {payFrom.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={chipClass(payFromId === row.id)}
                  onClick={() => setPayFromId(row.id)}
                >
                  {row.name}
                </button>
              ))}
            </div>
          </>
        ) : null}

        <button
          type="button"
          className={`mt-4 ${chipClass(autoPost)}`}
          onClick={() => setAutoPost((v) => !v)}
        >
          Auto-propose (off by default)
        </button>

        <label className="mt-4 block">
          <FieldLabel>Note</FieldLabel>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 field"
          />
        </label>
      </div>
      <div className="shrink-0 pt-2">
        <Keypad onKey={(key: AmountKey) => setAmount((d) => applyAmountKey(d, key))} />
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="mt-3 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add recurring" : "Save"}
      </button>
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
}: {
  mode: "add" | "edit";
  plan?: OneTimePlan;
  categories: readonly Category[];
  accounts: readonly Account[];
  today?: IsoDate;
  saving: boolean;
  onSave: (body: OneTimeWriteBody) => void;
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
      payFromAccountId: payFromId || null,
      notes,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Flights"
            className="mt-1 field"
          />
        </label>
        <p className="mt-4 hero-num">
          {amountExpression(amount) ? `₹${amountExpression(amount)}` : "₹0"}
        </p>
        <p className="mt-4 mb-2">
          <FieldLabel>Category</FieldLabel>
        </p>
        <div className="flex flex-wrap gap-2">
          {cats.map((row) => (
            <button
              key={row.id}
              type="button"
              className={chipClass(categoryId === row.id)}
              onClick={() => setCategoryId(row.id)}
            >
              {row.name}
            </button>
          ))}
        </div>
        <label className="mt-4 block">
          <FieldLabel>Expected date</FieldLabel>
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className="mt-1 field"
          />
        </label>
        <p className="mt-4 mb-2">
          <FieldLabel>Priority</FieldLabel>
        </p>
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={chipClass(priority === p)}
              onClick={() => setPriority(p)}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
        {mode === "edit" ? (
          <>
            <p className="mt-4 mb-2">
              <FieldLabel>Status</FieldLabel>
            </p>
            <div className="flex flex-wrap gap-2">
              {ONE_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={chipClass(status === s)}
                  onClick={() => setStatus(s)}
                >
                  {ONE_TIME_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              Complete does not write a ledger row. Log the spend with Quick Add when you pay.
            </p>
          </>
        ) : null}
        {payFrom.length > 0 ? (
          <>
            <p className="mt-4 mb-2">
              <FieldLabel>Pay from</FieldLabel>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={chipClass(payFromId === "")}
                onClick={() => setPayFromId("")}
              >
                None
              </button>
              {payFrom.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={chipClass(payFromId === row.id)}
                  onClick={() => setPayFromId(row.id)}
                >
                  {row.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <label className="mt-4 block">
          <FieldLabel>Note</FieldLabel>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 field"
          />
        </label>
      </div>
      <div className="shrink-0 pt-2">
        <Keypad onKey={(key: AmountKey) => setAmount((d) => applyAmountKey(d, key))} />
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="mt-3 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add one-time" : "Save"}
      </button>
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
}: {
  mode: "add" | "edit";
  inflow?: ExpectedInflow;
  categories: readonly Category[];
  today?: IsoDate;
  saving: boolean;
  onSave: (body: InflowWriteBody) => void;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <p className="text-sm text-muted">
          Free to allocate ignores these until they land in the ledger.
        </p>
        <label className="mt-3 block">
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bonus"
            className="mt-1 field"
          />
        </label>
        <p className="mt-4 hero-num">
          {amountExpression(amount) ? `₹${amountExpression(amount)}` : "₹0"}
        </p>
        <p className="mt-4 mb-2">
          <FieldLabel>Category</FieldLabel>
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={chipClass(categoryId === "")}
            onClick={() => setCategoryId("")}
          >
            None
          </button>
          {cats.map((row) => (
            <button
              key={row.id}
              type="button"
              className={chipClass(categoryId === row.id)}
              onClick={() => setCategoryId(row.id)}
            >
              {row.name}
            </button>
          ))}
        </div>
        <label className="mt-4 block">
          <FieldLabel>Expected date</FieldLabel>
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className="mt-1 field"
          />
        </label>
        <button
          type="button"
          className={`mt-4 ${chipClass(isLiquid)}`}
          onClick={() => setIsLiquid((v) => !v)}
        >
          Liquid
        </button>
        {mode === "edit" ? (
          <>
            <p className="mt-4 mb-2">
              <FieldLabel>Status</FieldLabel>
            </p>
            <div className="flex flex-wrap gap-2">
              {INFLOW_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={chipClass(status === s)}
                  onClick={() => setStatus(s)}
                >
                  {INFLOW_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <label className="mt-4 block">
          <FieldLabel>Note</FieldLabel>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 field"
          />
        </label>
      </div>
      <div className="shrink-0 pt-2">
        <Keypad onKey={(key: AmountKey) => setAmount((d) => applyAmountKey(d, key))} />
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className="mt-3 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "add" ? "Add inflow" : "Save"}
      </button>
    </div>
  );
}


