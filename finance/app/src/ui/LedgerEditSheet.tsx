import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getMonth, type LedgerPostBody } from "../api/store.ts";
import {
  addDays,
  formatInr,
  isIsoDate,
  yearMonthFromIsoDate,
  type IsoDate,
  type LedgerEntry,
  type LedgerType,
} from "../engine/index.ts";
import type { Account, Category } from "../engine/types.ts";
import {
  AmountField,
  categoryOptions,
  chipClass,
  FormSelect,
  namedOptions,
} from "./formFields.tsx";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  accountsForSlot,
  amountPaise,
  categoriesForType,
  defaultAccounts,
  defaultCategoryId,
  QUICK_ADD_TYPES,
  quickAddHints,
  showsInBudget,
  visibleAccountSlots,
  type AmountDraft,
} from "./quickAdd.ts";

type DateChoice = "today" | "yesterday" | "pick";

type LedgerEditSheetProps = {
  open: boolean;
  entry: LedgerEntry;
  today: IsoDate;
  accounts: readonly Account[];
  categories: readonly Category[];
  entries: readonly LedgerEntry[];
  saving: boolean;
  onSave: (body: LedgerPostBody) => void;
};

function resolveDate(today: IsoDate, choice: DateChoice, picked: string): IsoDate {
  if (choice === "today") return today;
  if (choice === "yesterday") return addDays(today, -1);
  return isIsoDate(picked) ? picked : today;
}

function dateChoiceFor(today: IsoDate, date: IsoDate): DateChoice {
  if (date === today) return "today";
  if (date === addDays(today, -1)) return "yesterday";
  return "pick";
}

export function LedgerEditSheet({
  open,
  entry,
  today,
  accounts,
  categories,
  entries,
  saving,
  onSave,
}: LedgerEditSheetProps) {
  const [type, setType] = useState<LedgerType>(entry.type);
  const [amount, setAmount] = useState<AmountDraft>(amountDraftFromPaise(entry.amount));
  const [fromId, setFromId] = useState(entry.fromAccountId);
  const [toId, setToId] = useState(entry.toAccountId);
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  const [inBudget, setInBudget] = useState(entry.inBudget);
  const [dateChoice, setDateChoice] = useState<DateChoice>(dateChoiceFor(today, entry.date));
  const [pickedDate, setPickedDate] = useState(entry.date);
  const [notes, setNotes] = useState(entry.notes);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  if (open && hydratedFor !== entry.id) {
    setType(entry.type);
    setAmount(amountDraftFromPaise(entry.amount));
    setFromId(entry.fromAccountId);
    setToId(entry.toAccountId);
    setCategoryId(entry.categoryId);
    setInBudget(entry.inBudget);
    setDateChoice(dateChoiceFor(today, entry.date));
    setPickedDate(entry.date);
    setNotes(entry.notes);
    setHydratedFor(entry.id);
  }
  if (!open && hydratedFor != null) {
    setHydratedFor(null);
  }

  const paise = amountPaise(amount);
  const date = resolveDate(today, dateChoice, pickedDate);
  const month = yearMonthFromIsoDate(date);
  const monthQ = useQuery({
    queryKey: ["month", month],
    queryFn: () => getMonth(month),
    enabled: open,
    staleTime: 30_000,
  });
  const cap = monthQ.data?.pace.cap ?? 0;
  const slots = visibleAccountSlots(type);
  const typeCategories = categoriesForType(type, categories);
  const fromOptions = namedOptions(accountsForSlot(type, "from", accounts));
  const toOptions = namedOptions(accountsForSlot(type, "to", accounts));
  const hints = quickAddHints(
    {
      date,
      type,
      amount: paise > 0 ? paise : 1,
      fromAccountId: fromId,
      toAccountId: toId,
      categoryId,
    },
    { accounts: [...accounts], categories: [...categories] },
  );
  const canSave = paise > 0 && hints.length === 0 && !saving;

  function selectType(next: LedgerType) {
    const defaults = defaultAccounts(next, [...accounts], [...entries]);
    const fromOk = accountsForSlot(next, "from", accounts).some((row) => row.id === fromId);
    const toOk = accountsForSlot(next, "to", accounts).some((row) => row.id === toId);
    const nextCats = categoriesForType(next, categories);
    const catOk = nextCats.some((row) => row.id === categoryId);
    const nextCatId = catOk
      ? categoryId
      : defaultCategoryId(next, [...categories], [...entries]);
    setType(next);
    setFromId(fromOk ? fromId : defaults.fromId);
    setToId(toOk ? toId : defaults.toId);
    setCategoryId(nextCatId);
    const nextCat = categories.find((row) => row.id === nextCatId);
    if (nextCat && showsInBudget(next)) setInBudget(nextCat.defaultInBudget);
  }

  function selectCategory(id: string) {
    setCategoryId(id);
    const row = categories.find((c) => c.id === id);
    if (row && showsInBudget(type)) setInBudget(row.defaultInBudget);
  }

  function submit() {
    if (!canSave) return;
    onSave({
      date,
      time: date === today ? (entry.time ?? null) : null,
      type,
      amount: paise,
      fromAccountId: fromId,
      toAccountId: toId,
      categoryId,
      inBudget,
      notes: notes.trim(),
      source: entry.source,
    });
  }

  if (!open) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
        <div
          role="radiogroup"
          aria-label="Type"
          className="-mx-1 flex gap-2 overflow-x-auto px-1"
        >
          {QUICK_ADD_TYPES.map((row) => {
            const selected = type === row.id;
            return (
              <button
                key={row.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => selectType(row.id)}
                className={chipClass(selected)}
              >
                {row.more && !selected ? "More" : row.label}
              </button>
            );
          })}
        </div>

        <AmountField amount={amount} onChange={setAmount} />

        <div className={`grid gap-2 ${slots.from && slots.to ? "grid-cols-2" : "grid-cols-1"}`}>
          {slots.from ? (
            <FormSelect
              label="From"
              value={fromId}
              onChange={setFromId}
              placeholder="Pick account"
              options={fromOptions}
            />
          ) : null}
          {slots.to ? (
            <FormSelect
              label="To"
              value={toId}
              onChange={setToId}
              placeholder="Pick account"
              options={toOptions}
            />
          ) : null}
        </div>

        <FormSelect
          label="Category"
          value={categoryId}
          onChange={selectCategory}
          options={categoryOptions(typeCategories)}
        />

        {showsInBudget(type) ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">In budget</p>
              <p className="text-xs text-muted">counts against {formatInr(cap)} cap</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={inBudget}
              onClick={() => setInBudget(!inBudget)}
              className={`relative h-7 w-12 shrink-0 rounded-full ${inBudget ? "bg-accent" : "bg-line"}`}
            >
              <span
                className={`absolute top-0.5 size-6 rounded-full bg-card shadow-sm transition-transform ${
                  inBudget ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDateChoice("today")} className={chipClass(dateChoice === "today")}>
            Today
          </button>
          <button
            type="button"
            onClick={() => setDateChoice("yesterday")}
            className={chipClass(dateChoice === "yesterday")}
          >
            Yesterday
          </button>
          <label className={`${chipClass(dateChoice === "pick")} inline-flex items-center`}>
            {dateChoice === "pick" && isIsoDate(pickedDate) ? pickedDate : "Pick"}
            <input
              type="date"
              value={pickedDate}
              onChange={(e) => {
                setDateChoice("pick");
                setPickedDate(e.target.value);
              }}
              className="sr-only"
            />
          </label>
        </div>

        <label className="block">
          <span className="sr-only">Note</span>
          <input
            type="text"
            value={notes}
            placeholder="Note"
            onChange={(e) => setNotes(e.target.value)}
            className="field"
          />
        </label>

        {hints.length > 0 ? (
          <ul className="space-y-1">{hintItems(hints)}</ul>
        ) : null}
      </div>

      <div className="mt-3 shrink-0 border-t border-line pt-3">
        <button type="button" disabled={!canSave} onClick={submit} className="btn-primary w-full">
          Save
        </button>
      </div>
    </div>
  );
}

function hintItems(hints: { field: string; message: string }[]) {
  return hints.map((hint) => (
    <li key={`${hint.field}:${hint.message}`} className="text-sm text-warn">
      {hint.message}
    </li>
  ));
}
