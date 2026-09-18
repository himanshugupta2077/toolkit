import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getLedgerMonth } from "../api/store.ts";
import { FetchError } from "./FetchError.tsx";
import {
  addMonths,
  formatInr,
  LEDGER_SOURCES,
  LEDGER_TYPES,
  todayIst,
  yearMonthFromIsoDate,
  type LedgerSource,
  type YearMonth,
} from "../engine/index.ts";
import type { Account, Category, LedgerEntry } from "../engine/types.ts";
import { BottomSheet } from "./BottomSheet.tsx";
import { FilterIcon, SearchIcon } from "./icons.tsx";
import {
  accountChip,
  activeFilterCount,
  amountClass,
  categoryInitial,
  dayHeaderText,
  EMPTY_LEDGER_FILTERS,
  filterLedgerEntries,
  flowKind,
  formatMonthTitle,
  groupLedgerByDay,
  ledgerSearchParams,
  ledgerStrip,
  LEDGER_SOURCE_LABELS,
  LEDGER_TYPE_LABELS,
  parseLedgerSearchParams,
  rowTitle,
  type LedgerFilters,
} from "./ledger.ts";

function chipClass(on: boolean): string {
  return `chip ${on ? "chip-on" : "chip-off"}`;
}

function LedgerRow({
  entry,
  accounts,
  categories,
  search,
}: {
  entry: LedgerEntry;
  accounts: readonly Account[];
  categories: readonly Category[];
  search: string;
}) {
  const category = categories.find((row) => row.id === entry.categoryId);
  const title = rowTitle(entry, categories);
  const chip = accountChip(entry, accounts);
  const kind = flowKind(entry.type);
  const to = search ? `/ledger/${entry.id}?${search}` : `/ledger/${entry.id}`;
  return (
    <Link
      to={to}
      className="flex min-h-11 items-center gap-3 py-2 [content-visibility:auto] [contain-intrinsic-size:auto_3.5rem] desk:grid desk:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_8.5rem] desk:gap-4"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="avatar"
        >
          {categoryInitial(category?.name ?? title)}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-base text-ink">{title}</span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted desk:hidden">
            <span className="truncate">{chip}</span>
            {entry.inBudget ? (
              <span
                title="In budget"
                className="inline-flex size-4 items-center justify-center rounded bg-card-2 text-[10px] font-semibold text-muted"
              >
                B
              </span>
            ) : null}
          </span>
        </span>
      </span>
      <span className="hidden truncate text-sm text-muted desk:block">{chip}</span>
      <span className={`shrink-0 text-base font-semibold tabular-nums ${amountClass(kind)} desk:text-right`}>
        {formatInr(entry.amount)}
      </span>
    </Link>
  );
}

function FilterSheet({
  filters,
  accounts,
  categories,
  onChange,
}: {
  filters: LedgerFilters;
  accounts: readonly Account[];
  categories: readonly Category[];
  onChange: (next: LedgerFilters) => void;
}) {
  const liveAccounts = accounts.filter((row) => !row.isArchived);
  const liveCategories = categories
    .filter((row) => !row.isArchived)
    .slice()
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <p className="mb-2 kicker">Type</p>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={chipClass(filters.type == null)}
            onClick={() => onChange({ ...filters, type: null })}
          >
            All
          </button>
          {LEDGER_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={chipClass(filters.type === type)}
              onClick={() =>
                onChange({ ...filters, type: filters.type === type ? null : type })
              }
            >
              {LEDGER_TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        <p className="mb-2 kicker">Account</p>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={chipClass(filters.accountId == null)}
            onClick={() => onChange({ ...filters, accountId: null })}
          >
            All
          </button>
          {liveAccounts.map((row) => (
            <button
              key={row.id}
              type="button"
              className={chipClass(filters.accountId === row.id)}
              onClick={() =>
                onChange({
                  ...filters,
                  accountId: filters.accountId === row.id ? null : row.id,
                })
              }
            >
              {row.name}
            </button>
          ))}
        </div>

        <p className="mb-2 kicker">Category</p>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={chipClass(filters.categoryId == null)}
            onClick={() => onChange({ ...filters, categoryId: null })}
          >
            All
          </button>
          {liveCategories.map((row) => (
            <button
              key={row.id}
              type="button"
              className={chipClass(filters.categoryId === row.id)}
              onClick={() =>
                onChange({
                  ...filters,
                  categoryId: filters.categoryId === row.id ? null : row.id,
                })
              }
            >
              {row.name}
            </button>
          ))}
        </div>

        <p className="mb-2 kicker">In budget</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              [null, "All"],
              [true, "Yes"],
              [false, "No"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              className={chipClass(filters.inBudget === value)}
              onClick={() => onChange({ ...filters, inBudget: value })}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mb-2 kicker">Source</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={chipClass(filters.source == null)}
            onClick={() => onChange({ ...filters, source: null })}
          >
            All
          </button>
          {LEDGER_SOURCES.map((source: LedgerSource) => (
            <button
              key={source}
              type="button"
              className={chipClass(filters.source === source)}
              onClick={() =>
                onChange({
                  ...filters,
                  source: filters.source === source ? null : source,
                })
              }
            >
              {LEDGER_SOURCE_LABELS[source]}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="mt-2 btn-ghost w-full"
        onClick={() => onChange({ ...EMPTY_LEDGER_FILTERS, q: filters.q })}
      >
        Clear filters
      </button>
    </div>
  );
}

export function LedgerScreen() {
  const [params, setParams] = useSearchParams();
  const fallbackMonth = yearMonthFromIsoDate(todayIst());
  const { month, filters } = parseLedgerSearchParams(params, fallbackMonth);
  const [searchOpen, setSearchOpen] = useState(filters.q !== "");
  const [filterOpen, setFilterOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(0);
  const thisMonth = yearMonthFromIsoDate(todayIst());

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sync = () => setBarH(el.getBoundingClientRect().height);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [searchOpen, filters.q]);

  const listQ = useQuery({
    queryKey: ["ledger", month],
    queryFn: () => getLedgerMonth(month),
    staleTime: 15_000,
  });

  function write(nextMonth: YearMonth, nextFilters: LedgerFilters) {
    setParams(ledgerSearchParams(nextMonth, nextFilters), { replace: true });
  }

  const data = listQ.data;
  const accounts = data?.accounts ?? [];
  const categories = data?.categories ?? [];
  const entries = data?.entries ?? [];
  const visible = useMemo(() => {
    if (!data) return [];
    return filterLedgerEntries(data.entries, filters, data.accounts, data.categories);
  }, [data, filters]);
  const groups = useMemo(() => groupLedgerByDay(visible), [visible]);
  const strip = useMemo(() => ledgerStrip(visible), [visible]);
  const filterCount = activeFilterCount(filters);
  const search = params.toString();

  const canNext = month < thisMonth;

  return (
    <section className="page">
      <div ref={barRef} className="sticky top-0 z-10 -mx-5 bg-app px-5 pt-1 pb-3 desk:mx-0 desk:mb-4 desk:rounded-2xl desk:border desk:border-line desk:bg-card desk:px-5 desk:py-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            className="icon-btn text-lg"
            onClick={() => write(addMonths(month, -1), filters)}
          >
            ←
          </button>
          <h1 className="min-w-0 flex-1 text-center text-lg font-semibold tracking-tight text-ink desk:text-xl">
            {formatMonthTitle(month)}
          </h1>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canNext}
            className="icon-btn text-lg"
            onClick={() => {
              if (!canNext) return;
              write(addMonths(month, 1), filters);
            }}
          >
            →
          </button>
          <button
            type="button"
            aria-label={searchOpen || filters.q ? "Hide search" : "Search"}
            aria-pressed={searchOpen || filters.q !== ""}
            className={searchOpen || filters.q ? "icon-btn bg-card-2" : "icon-btn"}
            onClick={() => setSearchOpen((open) => !open)}
          >
            <SearchIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label={
              filterCount > 0 ? `Filters, ${filterCount} active` : "Filters"
            }
            className="relative icon-btn"
            onClick={() => setFilterOpen(true)}
          >
            <FilterIcon className="h-5 w-5" />
            {filterCount > 0 ? (
              <span className="absolute top-1.5 right-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">
                {filterCount}
              </span>
            ) : null}
          </button>
        </div>

        <label className={searchOpen || filters.q ? "mt-2 block" : "mt-2 hidden desk:block"}>
            <span className="sr-only">Search</span>
            <input
              type="search"
              value={filters.q}
              placeholder="Note, category, account, amount"
              onChange={(e) => write(month, { ...filters, q: e.target.value })}
              className="field"
            />
          </label>

        <p className="mt-3 text-sm tabular-nums text-muted">
          In <span className="font-medium text-ok">{formatInr(strip.inflow)}</span>
          <span className="mx-1.5 text-line-strong">·</span>
          Out <span className="font-medium text-ink">{formatInr(strip.outflow)}</span>
          <span className="mx-1.5 text-line-strong">·</span>
          Budget {formatInr(strip.budgetSpent)}
        </p>
      </div>

      {listQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading this month…</p>
      ) : listQ.error ? (
        <FetchError error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : entries.length === 0 ? (
        <div className="py-10">
          <p className="text-lg font-medium text-ink">Nothing yet. Add your first one.</p>
          <p className="mt-1 text-sm text-muted">Quick Add opens a new row. Rows live on the laptop.</p>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-sm text-muted">No matches for this filter.</p>
      ) : (
        <div className="pb-8 desk:card desk:px-5 desk:pt-2">
          <div className="data-head desk:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_8.5rem] desk:pt-3">
            <span>Entry</span>
            <span>Account</span>
            <span className="text-right">Amount</span>
          </div>
          {groups.map((group) => (
            <section key={group.date} className="mb-4">
              <h2
                className="sticky z-[1] -mx-5 bg-app px-5 py-1.5 text-[13px] font-semibold text-muted desk:mx-0 desk:rounded-lg desk:px-2"
                style={{ top: barH }}
              >
                {dayHeaderText(group)}
              </h2>
              <ul>
                {group.entries.map((row) => (
                  <li key={row.id}>
                    <LedgerRow
                      entry={row}
                      accounts={accounts}
                      categories={categories}
                      search={search}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <BottomSheet
        open={filterOpen}
        title="Filters"
        tall
        onClose={() => setFilterOpen(false)}
      >
        <FilterSheet
          filters={filters}
          accounts={accounts}
          categories={categories}
          onChange={(next) => write(month, next)}
        />
      </BottomSheet>
    </section>
  );
}
