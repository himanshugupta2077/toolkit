import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getHome, type HomeCard, type HomeResponse } from "../api/store.ts";
import {
  formatInr,
  todayIst,
  yearMonthFromIsoDate,
  type PaceBand,
  type YearMonth,
} from "../engine/index.ts";
import { BottomSheet } from "./BottomSheet.tsx";
import {
  calendarDaysLeft,
  daysLeftLabel,
  dueInLabel,
  formatPct,
  homeActionCards,
  monthTiles,
  PACE_BAND_LABELS,
  paceHeadline,
  signedLineAmount,
  stackedMonthBars,
} from "./home.ts";
import { formatUtilisation } from "./accounts.ts";
import { FetchError } from "./FetchError.tsx";
import { EyeIcon, EyeOffIcon } from "./icons.tsx";
import { paceDotClass } from "./plan.ts";
import {
  accountChip,
  amountClass,
  categoryInitial,
  flowKind,
  formatMonthShort,
  formatMonthTitle,
  rowTitle,
} from "./ledger.ts";
import { Amount, usePrivacy } from "./Privacy.tsx";

function bandFill(band: PaceBand): string {
  if (band === "on_track") return "bg-ok";
  if (band === "watch") return "bg-warn";
  return "bg-danger";
}

function PaceBar({
  usedPct,
  elapsedPct,
  band,
}: {
  usedPct: number;
  elapsedPct: number;
  band: PaceBand;
}) {
  const used = Math.min(100, Math.max(0, usedPct * 100));
  const elapsed = Math.min(100, Math.max(0, elapsedPct * 100));
  return (
    <div
      className="relative mt-3 h-2 w-full rounded-full bg-card-2"
      role="img"
      aria-label={`Used ${formatPct(usedPct)}, month ${formatPct(elapsedPct)} elapsed, ${PACE_BAND_LABELS[band]}`}
    >
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${bandFill(band)}`}
        style={{ width: `${used}%` }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-ink"
        style={{ left: `${elapsed}%` }}
      />
    </div>
  );
}

function CcRow({ card, today }: { card: HomeCard; today: string }) {
  const dueLabel = dueInLabel(today, card.dueDay);
  const util = formatUtilisation(card.utilisation);
  return (
    <Link
      to={`/more/accounts/${card.accountId}`}
      className="flex min-h-11 items-center justify-between gap-3 py-2"
    >
      <span className="min-w-0">
        <span className="block truncate text-base text-ink">{card.name}</span>
        <span className="block text-xs text-muted">
          Due <Amount>{formatInr(card.due)}</Amount>
          {util ? ` · ${util}` : ""}
          {dueLabel ? ` · ${dueLabel}` : ""}
        </span>
      </span>
      <Amount className="shrink-0 text-base font-semibold tabular-nums text-ink">
        {formatInr(card.due)}
      </Amount>
    </Link>
  );
}

function ForecastStrip({
  months,
}: {
  months: HomeResponse["forecast"]["months"];
}) {
  const bars = stackedMonthBars(months);
  return (
    <Link
      to="/plan?tab=forecast"
      className="card mt-3 block p-4 active:bg-card-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Next 6 months</h2>
        <span className="text-[13px] font-medium text-accent">Forecast</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-1">
        {bars.map((bar) => (
          <div key={bar.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-16 w-7 flex-col justify-end overflow-hidden rounded-md bg-card-2">
              <div
                className="flex w-full flex-col justify-end"
                style={{ height: `${Math.round(bar.height * 100)}%` }}
              >
                {bar.shares.investment > 0 ? (
                  <div
                    className="w-full bg-accent"
                    style={{ height: `${Math.round(bar.shares.investment * 100)}%` }}
                  />
                ) : null}
                {bar.shares.lifestyle > 0 ? (
                  <div
                    className="w-full bg-seg-life"
                    style={{ height: `${Math.round(bar.shares.lifestyle * 100)}%` }}
                  />
                ) : null}
                {bar.shares.loanEmi > 0 ? (
                  <div
                    className="w-full bg-seg-emi"
                    style={{ height: `${Math.round(bar.shares.loanEmi * 100)}%` }}
                  />
                ) : null}
              </div>
            </div>
            <span className="text-[11px] text-muted">{formatMonthShort(bar.month as YearMonth)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">
        <span className="mr-2 inline-block size-2 rounded-sm bg-seg-emi align-middle" />
        Loan/EMI
        <span className="mx-2 inline-block size-2 rounded-sm bg-seg-life align-middle" />
        Lifestyle
        <span className="mx-2 inline-block size-2 rounded-sm bg-accent align-middle" />
        Investment
      </p>
    </Link>
  );
}

export function HomeScreen() {
  const today = todayIst();
  const fallbackMonth = yearMonthFromIsoDate(today);
  const [paceOpen, setPaceOpen] = useState(false);
  const [freeOpen, setFreeOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  const { blurred, toggle } = usePrivacy();

  const homeQ = useQuery({
    queryKey: ["home"],
    queryFn: getHome,
    staleTime: 15_000,
  });

  const data = homeQ.data;
  const month = (data?.month ?? fallbackMonth) as YearMonth;
  const daysLeft = data?.pace.daysLeft ?? calendarDaysLeft(today);
  const actions = data
    ? homeActionCards({
        lastImport: data.lastImport,
        recon: data.recon,
        free: data.free.free,
      })
    : [];
  const tiles = data ? monthTiles(month, data.summary) : [];
  const ccTotal = data?.cards.reduce((sum, row) => sum + row.due, 0) ?? 0;

  return (
    <section className="px-5 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {formatMonthTitle(month)}
          </h1>
          <p className="mt-0.5 text-sm text-muted">{daysLeftLabel(daysLeft)}</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="icon-btn"
          aria-pressed={blurred}
          aria-label={blurred ? "Show amounts" : "Hide amounts"}
        >
          {blurred ? <EyeOffIcon className="h-6 w-6" /> : <EyeIcon className="h-6 w-6" />}
        </button>
      </header>

      {homeQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading Home…</p>
      ) : homeQ.error ? (
        <FetchError error={homeQ.error} onRetry={() => void homeQ.refetch()} />
      ) : data ? (
        <>
          <button
            type="button"
            onClick={() => setPaceOpen(true)}
            className="card mt-4 w-full p-4 text-left active:bg-card-2"
          >
            <p className="kicker flex items-center gap-2">
              <span aria-hidden="true" className={`size-2 rounded-full ${paceDotClass(data.pace.band)}`} />
              Pace · {PACE_BAND_LABELS[data.pace.band]}
            </p>
            <p className="mt-1.5 text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums text-ink">
              <Amount>{paceHeadline(data.pace)}</Amount>
            </p>
            <p className="mt-2 text-sm text-muted">
              Budget remaining <Amount>{formatInr(data.pace.remaining)}</Amount> of{" "}
              <Amount>{formatInr(data.pace.cap)}</Amount> · Used {formatPct(data.pace.usedPct)} ·
              Month {formatPct(data.pace.elapsedPct)} elapsed
            </p>
            <PaceBar
              usedPct={data.pace.usedPct}
              elapsedPct={data.pace.elapsedPct}
              band={data.pace.band}
            />
          </button>

          {actions.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {actions.map((card) => {
                const className = `block w-full p-4 text-left ${
                  card.kind === "negative_free"
                    ? "card-danger"
                    : "card active:bg-card-2"
                }`;
                const inner = (
                  <>
                    <p className={`text-base font-medium ${card.kind === "negative_free" ? "text-danger" : "text-ink"}`}>{card.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{card.body}</p>
                  </>
                );
                if (card.disabled || card.href == null) {
                  return (
                    <li key={card.kind}>
                      {card.disabled ? (
                        <button type="button" disabled className={`${className} opacity-40`}>
                          {inner}
                        </button>
                      ) : (
                        <div className={className}>{inner}</div>
                      )}
                    </li>
                  );
                }
                return (
                  <li key={card.kind}>
                    <Link to={card.href} className={className}>
                      {inner}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {data.cards.length > 0 ? (
            <section className="mt-3 card p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Credit cards</h2>
                <p className="text-sm tabular-nums text-muted">
                  Total <Amount>{formatInr(ccTotal)}</Amount>
                </p>
              </div>
              <ul className="divide-y divide-line">
                {data.cards.map((card) => (
                  <li key={card.accountId}>
                    <CcRow card={card} today={data.today} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-3 card p-4">
            <p className="kicker">
              Free to allocate
            </p>
            <p
              className={`hero-num mt-1.5 ${
                data.free.free < 0 ? "text-danger" : ""
              }`}
            >
              <Amount>{formatInr(data.free.free)}</Amount>
            </p>
            {data.free.free < 0 ? (
              <p className="mt-1.5 text-sm font-medium text-danger">
                Committed beyond liquid
              </p>
            ) : null}
            <button
              type="button"
              className="btn-ghost -ml-3 mt-1"
              aria-expanded={freeOpen}
              onClick={() => setFreeOpen((open) => !open)}
            >
              {freeOpen ? "Hide breakdown" : "Show breakdown"}
            </button>
            {freeOpen ? (
              <ul className="mt-1 space-y-1 text-sm">
                {data.free.breakdown.map((line) => (
                  <li key={line.key} className="flex justify-between gap-3 tabular-nums">
                    <span className="text-muted">{line.label}</span>
                    <Amount className="text-ink">{signedLineAmount(line.sign, line.amount)}</Amount>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-line pt-2 font-semibold tabular-nums text-ink">
                  <span>Free</span>
                  <Amount>{formatInr(data.free.free)}</Amount>
                </li>
              </ul>
            ) : null}
            <p className="mt-2 text-sm text-muted">
              Expected inflows if received: +
              <Amount>{formatInr(data.free.expectedInflowsIfReceived)}</Amount>
            </p>
            <p className="mt-3 border-t border-line pt-3 text-sm text-ink">
              Est. free next month{" "}
              <Amount className="font-semibold tabular-nums">
                {formatInr(data.nextMonth.estimated)}
              </Amount>
            </p>
            <button
              type="button"
              className="btn-ghost -ml-3"
              aria-expanded={nextOpen}
              onClick={() => setNextOpen((open) => !open)}
            >
              {nextOpen ? "Hide next month" : "Next month breakdown"}
            </button>
            {nextOpen ? (
              <ul className="mt-1 space-y-1 text-sm">
                {data.nextMonth.breakdown.map((line) => (
                  <li key={line.key} className="flex justify-between gap-3 tabular-nums">
                    <span className="text-muted">{line.label}</span>
                    <Amount className="text-ink">{signedLineAmount(line.sign, line.amount)}</Amount>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="mt-3">
            <h2 className="text-sm font-semibold text-ink">This month</h2>
            <div className="card mt-2 grid grid-cols-2 overflow-hidden">
              {tiles.map((tile) => (
                <Link
                  key={tile.key}
                  to={tile.href}
                  className="min-h-20 border-b border-line p-3 odd:border-r active:bg-card-2 [&:nth-last-child(-n+2)]:border-b-0"
                >
                  <p className="text-[13px] text-muted">{tile.label}</p>
                  <Amount className="mt-1 block text-lg font-semibold tabular-nums text-ink">
                    {formatInr(tile.amount)}
                  </Amount>
                </Link>
              ))}
            </div>
          </section>

          <ForecastStrip months={data.forecast.months} />

          <section className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Recent</h2>
              <Link to="/ledger" className="btn-ghost -mr-3">
                See all
              </Link>
            </div>
            {data.recent.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing yet. Add your first one.</p>
            ) : (
              <ul>
                {data.recent.map((entry) => {
                  const title = rowTitle(entry, data.categories);
                  const category = data.categories.find((row) => row.id === entry.categoryId);
                  const kind = flowKind(entry.type);
                  return (
                    <li key={entry.id}>
                      <Link
                        to={`/ledger/${entry.id}`}
                        className="flex min-h-11 items-center gap-3 py-2"
                      >
                        <span
                          aria-hidden="true"
                          className="avatar"
                        >
                          {categoryInitial(category?.name ?? title)}
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-base text-ink">{title}</span>
                          <span className="block truncate text-[13px] text-muted">
                            {accountChip(entry, data.accounts)}
                          </span>
                        </span>
                        <Amount
                          className={`shrink-0 text-base font-semibold tabular-nums ${amountClass(kind)}`}
                        >
                          {formatInr(entry.amount)}
                        </Amount>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <BottomSheet open={paceOpen} title="Pace" onClose={() => setPaceOpen(false)}>
        {data ? (
          <div className="pb-4">
            <p className="text-sm text-muted">
              Safe/day is budget remaining ÷ days left (including today). On track when used % is
              at or below elapsed %; watch within +10pp; otherwise over pace.
            </p>
            {data.paceByCategory.length === 0 ? (
              <p className="mt-4 text-sm text-ink">No in-budget spend this month.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {data.paceByCategory.map((row) => (
                  <li key={row.categoryId}>
                    <Link
                      to={`/ledger?${new URLSearchParams({
                        month,
                        category: row.categoryId,
                        inBudget: "1",
                      }).toString()}`}
                      className="flex min-h-11 items-center justify-between gap-3 py-2"
                      onClick={() => setPaceOpen(false)}
                    >
                      <span className="truncate text-base text-ink">{row.name}</span>
                      <Amount className="shrink-0 tabular-nums text-ink">{formatInr(row.spent)}</Amount>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to={`/ledger?${new URLSearchParams({ month, type: "expense", inBudget: "1" }).toString()}`}
              className="btn-ghost -ml-3 mt-2"
              onClick={() => setPaceOpen(false)}
            >
              All in-budget expenses
            </Link>
          </div>
        ) : null}
      </BottomSheet>
    </section>
  );
}
