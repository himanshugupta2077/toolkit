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
import { Keypad } from "./Keypad.tsx";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  accountsForSlot,
  amountExpression,
  amountPaise,
  applyAmountKey,
  categoriesForType,
  defaultAccounts,
  defaultCategoryId,
  groupCategories,
  QUICK_ADD_TYPES,
  quickAddHints,
  recentCategoryIds,
  showsInBudget,
  sortRecentFirst,
  visibleAccountSlots,
  type AmountDraft,
} from "./quickAdd.ts";

type DateChoice = "today" | "yesterday" | "pick";
type Picker = "from" | "to" | "category" | null;

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

function chipClass(on: boolean): string {
  return `chip ${on ? "chip-on" : "chip-off"}`;
}

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
  const [noteFocused, setNoteFocused] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
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
    setNoteFocused(false);
    setPicker(null);
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
  const fromAccount = accounts.find((row) => row.id === fromId);
  const toAccount = accounts.find((row) => row.id === toId);
  const typeCategories = categoriesForType(type, categories);
  const recentCats = recentCategoryIds(entries, type)
    .map((id) => typeCategories.find((row) => row.id === id))
    .filter((row) => row != null);
  const categoryChips = recentCats.length > 0 ? recentCats : typeCategories.slice(0, 8);
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
    setType(next);
    setFromId(fromOk ? fromId : defaults.fromId);
    setToId(toOk ? toId : defaults.toId);
    setCategoryId(catOk ? categoryId : defaultCategoryId(next, [...categories], [...entries]));
    const nextCat = categories.find((row) => row.id === (catOk ? categoryId : defaultCategoryId(next, [...categories], [...entries])));
    if (nextCat && showsInBudget(next)) setInBudget(nextCat.defaultInBudget);
    setPicker(null);
  }

  function selectCategory(id: string) {
    setCategoryId(id);
    const row = categories.find((c) => c.id === id);
    if (row && showsInBudget(type)) setInBudget(row.defaultInBudget);
    setPicker(null);
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

  if (picker) {
    const title = picker === "from" ? "From" : picker === "to" ? "To" : "Category";
    const accountRows =
      picker === "category"
        ? []
        : sortRecentFirst(
            accountsForSlot(type, picker, accounts),
            entries.filter((e) => e.type === type).map((e) => (picker === "from" ? e.fromAccountId : e.toAccountId)),
          );
    const grouped = picker === "category" ? groupCategories(typeCategories) : [];
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPicker(null)}
            className="btn-ghost"
          >
            Back
          </button>
          <p className="text-base font-medium text-ink">{title}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {picker === "category"
            ? grouped.map((g) => (
                <section key={g.group} className="mb-4">
                  <h3 className="mb-2 kicker">
                    {g.group}
                  </h3>
                  <div className="flex flex-col gap-1">
                    {g.rows.map((row) => (
                      <button
                        type="button"
                        key={row.id}
                        onClick={() => selectCategory(row.id)}
                        className={`min-h-11 rounded-xl px-3 text-left text-base ${
                          row.id === categoryId ? "bg-accent-soft font-medium text-ink" : "text-ink"
                        }`}
                      >
                        {row.name}
                      </button>
                    ))}
                  </div>
                </section>
              ))
            : accountRows.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => {
                    if (picker === "from") setFromId(row.id);
                    else setToId(row.id);
                    setPicker(null);
                  }}
                  className={`mb-1 min-h-11 w-full rounded-xl px-3 text-left text-base ${
                    row.id === (picker === "from" ? fromId : toId)
                      ? "bg-accent-soft font-medium text-ink"
                      : "text-ink"
                  }`}
                >
                  {row.name}
                </button>
              ))}
        </div>
      </div>
    );
  }

  const expr = amountExpression(amount);
  const amountLabel =
    amount.parts.length > 0 ? formatInr(paise) : amount.buffer ? `₹${amount.buffer}` : "₹0";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          role="radiogroup"
          aria-label="Type"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-3"
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

        <p className="kicker">Amount</p>
        <p className="text-4xl font-semibold tracking-tight text-ink" aria-live="polite">
          {amountLabel}
        </p>
        {amount.parts.length > 0 ? <p className="text-sm text-muted">{expr}</p> : null}

        <div className={`mt-4 grid gap-2 ${slots.from && slots.to ? "grid-cols-2" : "grid-cols-1"}`}>
          {slots.from ? (
            <button
              type="button"
              onClick={() => setPicker("from")}
              className="min-h-11 rounded-xl border border-line px-3 py-2 text-left"
            >
              <span className="block text-xs text-muted">From</span>
              <span className="block text-base font-medium text-ink">
                {fromAccount?.name ?? "Pick account"}
              </span>
            </button>
          ) : null}
          {slots.to ? (
            <button
              type="button"
              onClick={() => setPicker("to")}
              className="min-h-11 rounded-xl border border-line px-3 py-2 text-left"
            >
              <span className="block text-xs text-muted">To</span>
              <span className="block text-base font-medium text-ink">
                {toAccount?.name ?? "Pick account"}
              </span>
            </button>
          ) : null}
        </div>

        <div className="mt-4">
          <p className="mb-2 kicker">Category</p>
          <div className="flex flex-wrap gap-2">
            {categoryChips.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => selectCategory(row.id)}
                className={chipClass(row.id === categoryId)}
              >
                {row.name}
              </button>
            ))}
            {typeCategories.length > categoryChips.length ? (
              <button type="button" onClick={() => setPicker("category")} className={chipClass(false)}>
                All
              </button>
            ) : null}
          </div>
        </div>

        {showsInBudget(type) ? (
          <div className="mt-4 flex items-center justify-between gap-3">
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

        <div className="mt-4 flex flex-wrap gap-2">
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

        <label className="mt-3 block">
          <span className="sr-only">Note</span>
          <input
            type="text"
            value={notes}
            placeholder="Note"
            onChange={(e) => setNotes(e.target.value)}
            onFocus={() => setNoteFocused(true)}
            onBlur={() => setNoteFocused(false)}
            className="field"
          />
        </label>

        {hints.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {hintItems(hints)}
          </ul>
        ) : null}
      </div>

      <div className="shrink-0 pt-3">
        <button
          type="button"
          disabled={!canSave}
          onClick={submit}
          className="btn-primary w-full"
        >
          Save
        </button>
        {noteFocused ? null : (
          <div className="mt-3">
            <Keypad
              onKey={(key) => setAmount((draft) => applyAmountKey(draft, key))}
            />
          </div>
        )}
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
