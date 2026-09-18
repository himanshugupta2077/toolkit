import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  getGoals,
  getInvest,
  getWealth,
  type WealthAccountLine,
  type WealthBucketCard,
} from "../api/store.ts";
import { DEFAULT_BUCKET_IDS, formatInr } from "../engine/index.ts";
import { FetchError } from "./FetchError.tsx";
import { GearIcon } from "./icons.tsx";
import { Amount } from "./Privacy.tsx";
import { displayPill, goalsStrip, pillClass } from "./goals.ts";
import { sipPct, versionCaption } from "./invest.ts";
import { NetWorthSparkline } from "./NetWorthSparkline.tsx";
import {
  bucketHeroCaption,
  exampleFromWealth,
  FILL_MODE_LABELS,
  formatFillPct,
  ringPercent,
} from "./wealth.ts";

export function BucketRing({
  fillPct,
  colour,
  label,
}: {
  fillPct: number | null;
  colour?: string;
  label: string;
}) {
  const pct = ringPercent(fillPct);
  const text = formatFillPct(fillPct) ?? "—";
  const stroke = colour && colour.length > 0 ? colour : "var(--accent)";
  return (
    <div
      role="img"
      aria-label={label}
      className="relative size-14 shrink-0 rounded-full"
      style={{ background: `conic-gradient(${stroke} ${pct}%, var(--card-2) 0)` }}
    >
      <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-card text-[11px] font-semibold tabular-nums text-ink">
        {text}
      </div>
    </div>
  );
}

function NwRow({ row }: { row: WealthAccountLine }) {
  return (
    <Link
      to={`/more/accounts/${row.id}`}
      className="flex min-h-11 items-center justify-between gap-3 py-2"
    >
      <span className={`min-w-0 truncate text-base ${row.isArchived ? "text-muted" : "text-ink"}`}>
        {row.name}
        {row.isArchived ? " (archived)" : ""}
      </span>
      <Amount className="shrink-0 text-base font-medium tabular-nums text-ink">
        {formatInr(row.balance)}
      </Amount>
    </Link>
  );
}

function BucketCard({
  bucket,
  href,
}: {
  bucket: WealthBucketCard;
  href?: string;
}) {
  const pctLabel = formatFillPct(bucket.fillPct);
  const title = (
    <>
      <h2 className="text-base font-semibold text-ink">{bucket.name}</h2>
      <p className="mt-0.5 text-sm text-muted">
        <Amount>{bucketHeroCaption(bucket)}</Amount>
      </p>
      <p className="mt-1 text-[13px] text-muted">{FILL_MODE_LABELS[bucket.fillMode]}</p>
    </>
  );
  return (
    <article className="card p-4">
      <div className="flex items-start gap-3">
        {href ? (
          <Link to={href} className="flex min-w-0 flex-1 items-start gap-3 text-left">
            <BucketRing
              fillPct={bucket.fillPct}
              colour={bucket.colour}
              label={`${bucket.name} ${pctLabel ?? "no target"}`}
            />
            <div className="min-w-0 flex-1">{title}</div>
          </Link>
        ) : (
          <>
            <BucketRing
              fillPct={bucket.fillPct}
              colour={bucket.colour}
              label={`${bucket.name} ${pctLabel ?? "no target"}`}
            />
            <div className="min-w-0 flex-1">{title}</div>
          </>
        )}
      </div>
      {bucket.accounts.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {bucket.accounts.map((account) => (
            <li key={account.id}>
              <Link
                to={`/more/accounts/${account.id}`}
                className="flex items-center justify-between gap-3 py-1 text-sm"
              >
                <span className="truncate text-ink">{account.name}</span>
                <Amount className="shrink-0 tabular-nums text-muted">{formatInr(account.balance)}</Amount>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted">No accounts tagged yet.</p>
      )}
    </article>
  );
}

export function WealthScreen() {
  const wealthQ = useQuery({
    queryKey: ["wealth"],
    queryFn: getWealth,
    staleTime: 15_000,
  });
  const goalsQ = useQuery({
    queryKey: ["goals"],
    queryFn: getGoals,
    staleTime: 15_000,
  });
  const investQ = useQuery({
    queryKey: ["invest"],
    queryFn: getInvest,
    staleTime: 15_000,
  });
  const data = wealthQ.data;
  const strip = goalsStrip(goalsQ.data?.goals ?? [], 3);
  const investPlan = investQ.data?.plan ?? null;
  const netClass =
    (data?.netWorth ?? 0) < 0 ? "text-danger" : "";

  return (
    <section className="page">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Wealth</h1>
          <p className="mt-0.5 text-sm text-muted">Buckets, not a typed balance.</p>
        </div>
        <Link
          to="/wealth/buckets"
          className="icon-btn"
          aria-label="Edit bucket rules"
        >
          <GearIcon className="h-6 w-6" />
        </Link>
      </header>

      {wealthQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading Wealth…</p>
      ) : wealthQ.error ? (
        <FetchError error={wealthQ.error} onRetry={() => void wealthQ.refetch()} />
      ) : data ? (
        <>
          <div className="desk-dash mt-4">
          <div className="card p-4 desk:col-span-8 desk:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="kicker">Net worth</p>
                <p className={`hero-num mt-1.5 ${netClass}`}>
                  <Amount>{formatInr(data.netWorth)}</Amount>
                </p>
              </div>
              <Link to="/wealth/portfolio" className="btn-ghost -mr-3 -mt-2">
                Portfolio
              </Link>
            </div>
            <NetWorthSparkline points={data.netWorthHistory ?? []} />
          </div>

          <p className="text-sm text-muted desk:col-span-12">{exampleFromWealth(data)}</p>

          <div className="space-y-3 desk:col-span-12 desk:grid desk:grid-cols-3 desk:gap-5 desk:space-y-0">
            {data.buckets.map((bucket) => (
              <BucketCard
                key={bucket.id}
                bucket={bucket}
                href={
                  bucket.id === DEFAULT_BUCKET_IDS.emergencyFund
                    ? "/emergency"
                    : undefined
                }
              />
            ))}
          </div>

          <div className="card p-3 desk:col-span-4 desk:p-5">
              <p className="kicker">Assets</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                <Amount>{formatInr(data.assetsTotal)}</Amount>
              </p>
              {data.assets.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None flagged for net worth.</p>
              ) : (
                <ul className="mt-1 divide-y divide-line">
                  {data.assets.map((row) => (
                    <li key={row.id}>
                      <NwRow row={row} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card p-3 desk:col-span-4 desk:p-5">
              <p className="kicker">Liabilities</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                <Amount>{formatInr(data.liabilitiesTotal)}</Amount>
              </p>
              {data.liabilities.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None flagged for net worth.</p>
              ) : (
                <ul className="mt-1 divide-y divide-line">
                  {data.liabilities.map((row) => (
                    <li key={row.id}>
                      <NwRow row={row} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

          <div className="card p-4 desk:col-span-4 desk:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Goals</p>
              <Link to="/wealth/goals" className="btn-ghost -mr-3 -my-2">
                See all
              </Link>
            </div>
            {strip.length === 0 ? (
              <Link to="/wealth/goals" className="mt-2 block text-sm text-muted">
                Add a goal
              </Link>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {strip.map((row) => {
                  const shown = displayPill(row);
                  return (
                    <li key={row.id}>
                      <Link
                        to={`/wealth/goals/${row.id}`}
                        className="flex min-h-11 items-center justify-between gap-3 py-2"
                      >
                        <span className="min-w-0 truncate text-base text-ink">{row.name}</span>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${pillClass(shown.pill)}`}
                        >
                          {shown.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card p-4 desk:col-span-4 desk:col-start-9 desk:row-start-1 desk:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Invest</p>
              <Link to="/wealth/invest" className="btn-ghost -mr-3 -my-2">
                Open
              </Link>
            </div>
            {investPlan ? (
              <>
                <p className="mt-2 text-base text-ink">
                  SIP {sipPct(investPlan)}% / Dip {100 - sipPct(investPlan)}%
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  <Amount>
                    Dip reserve {formatInr(investQ.data?.dipBalance ?? 0)}
                  </Amount>
                  {" · "}
                  {versionCaption(investPlan)}
                </p>
              </>
            ) : (
              <Link to="/wealth/invest" className="mt-2 block text-sm text-muted">
                Set up the SIP / dip plan
              </Link>
            )}
          </div>

          {data.free > 0 ? (
            <Link
              to="/wealth/allocate"
              className="btn-primary min-h-12 w-full flex-col gap-0 rounded-2xl py-3 text-left desk:col-span-12"
            >
              <p className="w-full text-base font-medium">
                Allocate this month: <Amount>{formatInr(data.free)}</Amount> free
              </p>
              <p className="mt-0.5 w-full text-sm opacity-80">Preview the waterfall, then confirm transfers.</p>
            </Link>
          ) : data.free < 0 ? (
            <div className="card-danger p-4 desk:col-span-12">
              <p className="text-base font-medium text-danger">
                Committed beyond liquid
              </p>
              <p className="mt-0.5 text-sm text-muted">
                Allocate stays off until free cash is positive.
              </p>
            </div>
          ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
