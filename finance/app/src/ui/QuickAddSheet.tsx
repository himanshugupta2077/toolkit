import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { QuickAddPrefill } from "./AppShell.tsx";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  getBooks,
  parseOsLedger,
  postCategory,
  postLedger,
  postOsVoice,
  type BooksResponse,
  type LedgerPostBody,
  type MonthResponse,
  type OsParsedEntry,
} from "../api/store.ts";
import {
  addDays,
  formatInr,
  isIsoDate,
  nowTimeIst,
  todayIst,
  yearMonthFromIsoDate,
  type Books,
  type IsoDate,
  type LedgerEntry,
  type LedgerType,
} from "../engine/index.ts";
import {
  AmountField,
  categoryOptions,
  chipClass,
  FormSelect,
  namedOptions,
} from "./formFields.tsx";
import { AiAddPanel } from "./AiAddPanel.tsx";
import {
  ADD_MODE_LABELS,
  catalogFromBooks,
  readAddMode,
  toLedgerPostBody,
  voiceSttPrefs,
  writeAddMode,
  type AddMode,
} from "./ledgerParse.ts";
import {
  accountsForSlot,
  amountPaise,
  categoriesForType,
  defaultAccounts,
  defaultCategoryGroup,
  defaultCategoryId,
  EMPTY_AMOUNT,
  filterCategories,
  groupCategories,
  hasExactCategory,
  lastNoteForCategory,
  QUICK_ADD_TYPES,
  quickAddHints,
  showsInBudget,
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

const BOOKS_SINCE_DAYS = 180;

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
  const [picker, setPicker] = useState<"category" | null>(null);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [goalName, setGoalName] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<AddMode>("form");
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const booksQ = useQuery({
    queryKey: ["books", since],
    queryFn: () => getBooks(since),
    enabled: open,
    staleTime: 30_000,
  });
  const books = booksQ.data?.books;

  if (!open && hydrated) {
    setHydrated(false);
    setAiText("");
    setAiBusy(false);
    setAiStatus(null);
    setAiError(null);
    setPicker(null);
  }

  if (books && open && !hydrated) {
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
    setAddMode(prefill ? "form" : readAddMode());
    setAiText("");
    setAiBusy(false);
    setAiStatus(null);
    setAiError(null);
    setHydrated(true);
  }

  const paise = amountPaise(amount);
  const date = books ? resolveDate(books.today, dateChoice, pickedDate) : todayIst();
  const slots = visibleAccountSlots(type);
  const category = books?.categories.find((row) => row.id === categoryId);
  const typeCategories = books ? categoriesForType(type, books.categories) : [];
  const fromOptions = books ? namedOptions(accountsForSlot(type, "from", books.accounts)) : [];
  const toOptions = books ? namedOptions(accountsForSlot(type, "to", books.accounts)) : [];
  const notePlaceholder = books
    ? lastNoteForCategory(books.entries, categoryId) || "Note"
    : "Note";

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
    setCategoryQuery("");
  }

  async function createCategoryFromQuery() {
    const name = categoryQuery.trim();
    if (!name || creatingCategory) return;
    setCreatingCategory(true);
    try {
      const res = await postCategory({
        name,
        group: defaultCategoryGroup(type),
        defaultInBudget: showsInBudget(type),
      });
      const created = res.category;
      if (!created) throw new Error("Category was not created.");
      qc.setQueryData<BooksResponse>(["books", since], (prev) => {
        if (!prev) return prev;
        if (prev.books.categories.some((row) => row.id === created.id)) return prev;
        return {
          ...prev,
          books: {
            ...prev.books,
            categories: [...prev.books.categories, created],
          },
        };
      });
      void qc.invalidateQueries({ queryKey: ["categories"] });
      onToast(`${created.name} added`);
      selectCategory(created.id);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setCreatingCategory(false);
    }
  }

  function selectAddMode(next: AddMode) {
    setAddMode(next);
    writeAddMode(next);
    setAiError(null);
    setAiStatus(null);
  }

  async function saveAiEntries(entries: OsParsedEntry[]) {
    if (!books || entries.length === 0) return;
    const bodies = entries.map((entry) => toLedgerPostBody(entry, books.today));
    const first = bodies[0];
    if (!first) return;
    const firstCat =
      books.categories.find((row) => row.id === first.categoryId)?.name ?? first.type;
    onToast(
      bodies.length === 1
        ? `${formatInr(first.amount)} · ${firstCat}`
        : `${bodies.length} entries`,
    );
    setSaving(true);
    onClose();
    void (async () => {
      const snaps = [];
      try {
        for (const body of bodies) {
          snaps.push(await writeOptimistic(qc, since, body));
          await postLedger(body);
        }
        const last = bodies[bodies.length - 1];
        const catName =
          last != null
            ? (books.categories.find((row) => row.id === last.categoryId)?.name ?? last.type)
            : firstCat;
        onToast(
          bodies.length === 1
            ? `${formatInr(first.amount)} · ${catName} · saved`
            : `${bodies.length} entries · saved`,
        );
      } catch (err) {
        for (const snap of snaps.reverse()) rollbackOptimistic(qc, snap);
        onToast(apiErrorText(err) || "not saved");
      } finally {
        setSaving(false);
        refetchAfterSave(qc);
      }
    })();
  }

  async function submitAiText() {
    if (!books || aiBusy || saving) return;
    const text = aiText.trim();
    if (!text) {
      setAiError("Type a money event first.");
      return;
    }
    setAiBusy(true);
    setAiError(null);
    setAiStatus("Reading…");
    try {
      const result = await parseOsLedger({
        text,
        catalog: catalogFromBooks(books),
      });
      if (!result.ok || !result.entries?.length) {
        setAiError(result.error || "No transaction found.");
        setAiStatus(null);
        return;
      }
      await saveAiEntries(result.entries);
    } catch (err) {
      setAiError(apiErrorText(err));
      setAiStatus(null);
    } finally {
      setAiBusy(false);
    }
  }

  async function submitAiVoice(blob: Blob, filename: string) {
    if (!books || aiBusy || saving) return;
    setAiBusy(true);
    setAiError(null);
    setAiStatus("Transcribing…");
    try {
      const result = await postOsVoice(blob, filename, catalogFromBooks(books), voiceSttPrefs());
      const heard = (result.transcript || result.note?.transcript || "").trim();
      if (heard) setAiText(heard);
      if (!result.ok || !result.entries?.length) {
        setAiError(result.error || "Heard that, but no transaction found. Edit the text and add.");
        setAiStatus(null);
        selectAddMode("type");
        return;
      }
      await saveAiEntries(result.entries);
    } catch (err) {
      setAiError(apiErrorText(err));
      setAiStatus(null);
    } finally {
      setAiBusy(false);
    }
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

  if (picker === "category") {
    const filteredCats = filterCategories(typeCategories, categoryQuery);
    const grouped = groupCategories(filteredCats);
    const canCreateCategory =
      categoryQuery.trim() !== "" && !hasExactCategory(typeCategories, categoryQuery);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPicker(null);
              setCategoryQuery("");
            }}
            className="btn-ghost -ml-3"
          >
            Back
          </button>
          <p className="text-base font-semibold text-ink">Category</p>
        </div>
        <label className="mb-3 block">
          <span className="kicker">Search</span>
          <input
            type="search"
            value={categoryQuery}
            onChange={(e) => setCategoryQuery(e.target.value)}
            placeholder="Find or create"
            className="mt-1 field"
            autoFocus
          />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {canCreateCategory ? (
            <button
              type="button"
              disabled={creatingCategory}
              onClick={() => void createCategoryFromQuery()}
              className="mb-3 min-h-11 w-full rounded-xl bg-accent-soft px-3 text-left text-base font-medium text-ink"
            >
              {creatingCategory ? "Creating…" : `Create “${categoryQuery.trim()}”`}
            </button>
          ) : null}
          {grouped.length === 0 && !canCreateCategory ? (
            <p className="text-sm text-muted">No categories match.</p>
          ) : null}
          {grouped.map((g) => (
            <section key={g.group} className="mb-4">
              <h3 className="kicker mb-2">{g.group}</h3>
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
          ))}
        </div>
      </div>
    );
  }

  const modeSwitch = (
    <div
      role="radiogroup"
      aria-label="How"
      className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1"
    >
      {(["form", "type", "speak"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={addMode === mode}
          onClick={() => selectAddMode(mode)}
          className={chipClass(addMode === mode)}
        >
          {ADD_MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  );

  if (addMode !== "form") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {modeSwitch}
        <AiAddPanel
          mode={addMode}
          busy={aiBusy || saving}
          status={aiStatus}
          error={aiError}
          text={aiText}
          onText={setAiText}
          onSubmitText={() => void submitAiText()}
          onSubmitVoice={(blob, filename) => void submitAiVoice(blob, filename)}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {modeSwitch}
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

        {goalName ? (
          <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-ink">
            This save also funds {goalName}.
          </p>
        ) : null}

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

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <FormSelect
              label="Category"
              value={categoryId}
              onChange={selectCategory}
              options={categoryOptions(typeCategories)}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setCategoryQuery("");
              setPicker("category");
            }}
            className="btn-secondary shrink-0"
            aria-label="New category"
          >
            New
          </button>
        </div>

        {showsInBudget(type) ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink">In budget</p>
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

        <div className="flex flex-wrap gap-2">
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
          <span className="kicker">Comment</span>
          <input
            type="text"
            value={notes}
            placeholder={notePlaceholder}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 field"
          />
        </label>

        {hints.length > 0 ? (
          <ul className="space-y-1">
            {hints.map((hint) => (
              <li key={`${hint.field}:${hint.message}`} className="text-sm font-medium text-warn">
                {hint.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 border-t border-line pt-3">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => submit()}
          className="btn-primary min-h-12"
        >
          Save
        </button>
        <button type="button" onClick={onClose} className="btn-close min-h-12">
          Cancel
        </button>
      </div>
    </div>
  );
}
