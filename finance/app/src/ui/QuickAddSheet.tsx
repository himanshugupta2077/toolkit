import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { QuickAddPrefill } from "./AppShell.tsx";
import { FetchError } from "./FetchError.tsx";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  getBooks,
  postLedger,
  type BooksResponse,
  type LedgerPostBody,
  type MonthResponse,
} from "../api/store.ts";
import {
  addDays,
  formatInr,
  isIsoDate,
  nowTimeIst,
  resolveBudgetCap,
  todayIst,
  yearMonthFromIsoDate,
  type Books,
  type IsoDate,
  type LedgerEntry,
  type LedgerType,
} from "../engine/index.ts";
import { Keypad } from "./Keypad.tsx";
import {
  accountsForSlot,
  amountExpression,
  amountPaise,
  applyAmountKey,
  categoriesForType,
  defaultAccounts,
  defaultCategoryId,
  EMPTY_AMOUNT,
  groupCategories,
  lastNoteForCategory,
  QUICK_ADD_TYPES,
  quickAddHints,
  recentCategoryIds,
  showsInBudget,
  sortRecentFirst,
  visibleAccountSlots,
  type AmountDraft,
} from "./quickAdd.ts";

type QuickAddSheetProps = {
  open: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
  prefill?: QuickAddPrefill;
};

type DateChoice = "today" | "yesterday" | "pick";
type Picker = "from" | "to" | "category" | null;

const BOOKS_SINCE_DAYS = 180;

function chipClass(on: boolean): string {
  return `chip ${on ? "chip-on" : "chip-off"}`;
}

function resolveDate(today: IsoDate, choice: DateChoice, picked: string): IsoDate {
  if (choice === "today") return today;
  if (choice === "yesterday") return addDays(today, -1);
  return isIsoDate(picked) ? picked : today;
}

function applyDefaults(type: LedgerType, books: Books) {
  const ids = defaultAccounts(type, books.accounts, books.entries);
  const categoryId = defaultCategoryId(type, books.categories, books.entries);
  const category = books.categories.find((row) => row.id === categoryId);
  return {
    fromId: ids.fromId,
    toId: ids.toId,
    categoryId,
    inBudget: category?.defaultInBudget ?? type === "expense",
  };
}

type OptimisticSnap = {
  booksKey: readonly ["books", string];
  monthKey: readonly ["month", string];
  prevBooks: BooksResponse | undefined;
  prevMonth: MonthResponse | undefined;
};

async function writeOptimistic(
  qc: QueryClient,
  since: string,
  body: LedgerPostBody,
): Promise<OptimisticSnap> {
  await qc.cancelQueries({ queryKey: ["books"] });
  await qc.cancelQueries({ queryKey: ["month"] });
  const booksKey = ["books", since] as const;
  const prevBooks = qc.getQueryData<BooksResponse>(booksKey);
  const month = yearMonthFromIsoDate(body.date);
  const monthKey = ["month", month] as const;
  const prevMonth = qc.getQueryData<MonthResponse>(monthKey);
  if (prevBooks) {
    const now = new Date().toISOString();
    const entry: LedgerEntry = {
      id: `tmp-${now}`,
      date: body.date,
      time: body.time ?? null,
      type: body.type,
      amount: body.amount,
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      categoryId: body.categoryId,
      inBudget: body.inBudget,
      notes: body.notes,
      source: body.source ?? "manual",
      goalId: body.goalId ?? null,
      holdingTxnId: null,
      createdAt: now,
      updatedAt: now,
    };
    qc.setQueryData(booksKey, {
      ...prevBooks,
      books: {
        ...prevBooks.books,
        entries: [...prevBooks.books.entries, entry],
      },
    });
  }
  if (prevMonth && body.inBudget && body.type === "expense") {
    qc.setQueryData(monthKey, {
      ...prevMonth,
      summary: {
        ...prevMonth.summary,
        budgetSpent: prevMonth.summary.budgetSpent + body.amount,
      },
      pace: { ...prevMonth.pace, spent: prevMonth.pace.spent + body.amount },
    });
  }
  return { booksKey, monthKey, prevBooks, prevMonth };
}

function rollbackOptimistic(qc: QueryClient, snap: OptimisticSnap) {
  if (snap.prevBooks) qc.setQueryData(snap.booksKey, snap.prevBooks);
  if (snap.prevMonth) qc.setQueryData(snap.monthKey, snap.prevMonth);
}

function refetchAfterSave(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["month"] });
  void qc.invalidateQueries({ queryKey: ["ledger"] });
  void qc.invalidateQueries({ queryKey: ["ledger-entry"] });
  void qc.invalidateQueries({ queryKey: ["counts"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
  void qc.invalidateQueries({ queryKey: ["accounts"] });
  void qc.invalidateQueries({ queryKey: ["account"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["plan"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["goals"] });
  void qc.invalidateQueries({ queryKey: ["allocation"] });
}

export function QuickAddSheet({ open, onClose, onToast, prefill }: QuickAddSheetProps) {
  const qc = useQueryClient();
  const since = addDays(todayIst(), -BOOKS_SINCE_DAYS);

  const [type, setType] = useState<LedgerType>("expense");
  const [amount, setAmount] = useState<AmountDraft>(EMPTY_AMOUNT);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [inBudget, setInBudget] = useState(true);
  const [dateChoice, setDateChoice] = useState<DateChoice>("today");
  const [pickedDate, setPickedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [noteFocused, setNoteFocused] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [goalName, setGoalName] = useState<string | null>(null);

  const booksQ = useQuery({
    queryKey: ["books", since],
    queryFn: () => getBooks(since),
    enabled: open,
    staleTime: 30_000,
  });
  const books = booksQ.data?.books;

  if (books && !hydrated) {
    const nextType = prefill?.type ?? "expense";
    const next = applyDefaults(nextType, books);
    setType(nextType);
    setAmount(
      prefill?.amount && prefill.amount > 0
        ? amountDraftFromPaise(prefill.amount)
        : EMPTY_AMOUNT,
    );
    setFromId(prefill?.fromAccountId || next.fromId);
    setToId(prefill?.toAccountId || next.toId);
    setCategoryId(next.categoryId);
    setInBudget(next.inBudget);
    setDateChoice("today");
    setPickedDate(books.today);
    setNotes(prefill?.notes ?? "");
    setGoalId(prefill?.goalId ?? null);
    setGoalName(prefill?.goalName ?? null);
    setHydrated(true);
  }

  const paise = amountPaise(amount);
  const date = books ? resolveDate(books.today, dateChoice, pickedDate) : todayIst();
  const slots = visibleAccountSlots(type);
  const fromAccount = books?.accounts.find((row) => row.id === fromId);
  const toAccount = books?.accounts.find((row) => row.id === toId);
  const category = books?.categories.find((row) => row.id === categoryId);
  const typeCategories = books ? categoriesForType(type, books.categories) : [];
  const recentCats = books
    ? recentCategoryIds(books.entries, type)
        .map((id) => typeCategories.find((row) => row.id === id))
        .filter((row) => row != null)
    : [];
  const categoryChips =
    recentCats.length > 0
      ? recentCats
      : typeCategories.slice(0, 8);
  const notePlaceholder = books
    ? lastNoteForCategory(books.entries, categoryId) || "Note"
    : "Note";
  const cap = books
    ? resolveBudgetCap(
        yearMonthFromIsoDate(date),
        books.monthBudgets,
        books.settings.defaultBudget,
      )
    : 0;

  const hints = books
    ? quickAddHints(
        {
          date,
          type,
          // Non-zero stand-in so an empty keypad does not hide From/To hints.
          amount: paise > 0 ? paise : 1,
          fromAccountId: fromId,
          toAccountId: toId,
          categoryId,
        },
        books,
      )
    : [];
  const canSave = paise > 0 && hints.length === 0 && !saving && books != null;

  function selectType(next: LedgerType) {
    if (!books) return;
    const defaults = applyDefaults(next, books);
    setType(next);
    setFromId(defaults.fromId);
    setToId(defaults.toId);
    setCategoryId(defaults.categoryId);
    setInBudget(defaults.inBudget);
    setPicker(null);
  }

  function selectCategory(id: string) {
    setCategoryId(id);
    const row = books?.categories.find((c) => c.id === id);
    if (row && showsInBudget(type)) setInBudget(row.defaultInBudget);
    setPicker(null);
  }

  function submit() {
    if (!books || !canSave) return;
    const body: LedgerPostBody = {
      date,
      time: date === books.today ? nowTimeIst() : null,
      type,
      amount: paise,
      fromAccountId: fromId,
      toAccountId: toId,
      categoryId,
      inBudget,
      notes: notes.trim(),
      source: "manual",
      goalId: goalId,
    };
    const catName = category?.name ?? type;
    onToast(`${formatInr(paise)} · ${catName}`);
    setSaving(true);
    onClose();
    void (async () => {
      const snap = await writeOptimistic(qc, since, body);
      try {
        const data = await postLedger(body);
        const paceBit = showsInBudget(data.entry.type)
          ? ` · Safe/day now ${formatInr(data.pace.safePerDay)}`
          : " · saved";
        onToast(`${formatInr(data.entry.amount)} · ${catName}${paceBit}`);
      } catch {
        rollbackOptimistic(qc, snap);
        onToast("not saved");
      } finally {
        setSaving(false);
        refetchAfterSave(qc);
      }
    })();
  }

  if (!open) return null;

  if (!books && (booksQ.isPending || booksQ.isFetching)) {
    return <p className="pb-4 text-sm text-muted">Loading accounts…</p>;
  }
  if (booksQ.error || !books) {
    return (
      <FetchError
        compact
        error={booksQ.error ?? new Error("Failed to fetch")}
        onRetry={() => void booksQ.refetch()}
      />
    );
  }
  if (!hydrated) {
    return <p className="pb-4 text-sm text-muted">Loading accounts…</p>;
  }

  if (picker) {
    const title =
      picker === "from" ? "From" : picker === "to" ? "To" : "Category";
    const accountRows =
      picker === "category"
        ? []
        : sortRecentFirst(
            accountsForSlot(type, picker, books.accounts),
            books.entries
              .filter((e) => e.type === type)
              .map((e) => (picker === "from" ? e.fromAccountId : e.toAccountId)),
          );
    const grouped = picker === "category" ? groupCategories(typeCategories) : [];
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPicker(null)}
            className="btn-ghost -ml-3"
          >
            Back
          </button>
          <p className="text-base font-semibold text-ink">{title}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {picker === "category"
            ? grouped.map((g) => (
                <section key={g.group} className="mb-4">
                  <h3 className="kicker mb-2">
                    {g.group}
                  </h3>
                  <div className="flex flex-col gap-1">
                    {g.rows.map((row) => (
                      <button
                        type="button"
                        key={row.id}
                        onClick={() => selectCategory(row.id)}
                        className={`min-h-11 rounded-xl px-3 text-left text-base transition-colors active:bg-card-2 ${
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
                  className={`mb-1 min-h-11 w-full rounded-xl px-3 text-left text-base transition-colors active:bg-card-2 ${
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

        {goalName ? (
          <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-sm text-ink">
            This save also funds {goalName}.
          </p>
        ) : null}

        <p className="kicker">Amount</p>
        <p className="mt-1 text-[2.5rem] leading-none font-semibold tracking-tight tabular-nums text-ink" aria-live="polite">
          {amountLabel}
        </p>
        {amount.parts.length > 0 ? (
          <p className="mt-1.5 text-sm tabular-nums text-muted">{expr}</p>
        ) : null}

        <div className={`mt-4 grid gap-2 ${slots.from && slots.to ? "grid-cols-2" : "grid-cols-1"}`}>
          {slots.from ? (
            <button
              type="button"
              onClick={() => setPicker("from")}
              className="min-h-11 rounded-xl border border-line-strong bg-card px-3 py-2 text-left transition-colors active:bg-card-2"
            >
              <span className="block text-[13px] text-muted">From</span>
              <span className="block text-base font-medium text-ink">
                {fromAccount?.name ?? "Pick account"}
              </span>
            </button>
          ) : null}
          {slots.to ? (
            <button
              type="button"
              onClick={() => setPicker("to")}
              className="min-h-11 rounded-xl border border-line-strong bg-card px-3 py-2 text-left transition-colors active:bg-card-2"
            >
              <span className="block text-[13px] text-muted">To</span>
              <span className="block text-base font-medium text-ink">
                {toAccount?.name ?? "Pick account"}
              </span>
            </button>
          ) : null}
        </div>

        <div className="mt-4">
          <p className="kicker mb-2">Category</p>
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
              <button
                type="button"
                onClick={() => setPicker("category")}
                className={chipClass(false)}
              >
                All
              </button>
            ) : null}
          </div>
        </div>

        {showsInBudget(type) ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">In budget</p>
              <p className="text-[13px] text-muted">
                counts against {formatInr(cap)} cap
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={inBudget}
              aria-label="In budget"
              onClick={() => setInBudget(!inBudget)}
              className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors ${
                inBudget ? "bg-accent" : "bg-line-strong"
              }`}
            >
              <span
                className={`size-5 rounded-full bg-card shadow-sm transition-transform ${
                  inBudget ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDateChoice("today")}
            className={chipClass(dateChoice === "today")}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDateChoice("yesterday")}
            className={chipClass(dateChoice === "yesterday")}
          >
            Yesterday
          </button>
          <label
            className={`${chipClass(dateChoice === "pick")} inline-flex items-center`}
          >
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
            placeholder={notePlaceholder}
            onChange={(e) => setNotes(e.target.value)}
            onFocus={() => setNoteFocused(true)}
            onBlur={() => setNoteFocused(false)}
            className="field"
          />
        </label>

        {hints.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {hints.map((hint) => (
              <li key={`${hint.field}:${hint.message}`} className="text-sm font-medium text-warn">
                {hint.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line pt-3">
        {noteFocused ? null : (
          <Keypad
            plus={false}
            onKey={(key) => setAmount((draft) => applyAmountKey(draft, key))}
          />
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <button
            type="button"
            aria-label="Add"
            onClick={() => setAmount((draft) => applyAmountKey(draft, "+"))}
            className="min-h-12 rounded-2xl border border-line-strong bg-card text-lg font-medium text-ink transition-colors active:bg-card-2"
          >
            +
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => submit()}
            className="btn-primary min-h-12"
          >
            Save
          </button>
          <button type="button" onClick={onClose} className="btn-quiet min-h-12">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
