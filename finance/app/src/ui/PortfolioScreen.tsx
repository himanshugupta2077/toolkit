import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  getPortfolio,
  postHolding,
  postSnapshot,
  type PortfolioDriftRow,
  type PortfolioHoldingCard,
} from "../api/store.ts";
import { formatBpPct, formatInr, type HistoryRange } from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { apiErrorText } from "./copy.ts";
import { useDisplayPrefs } from "./displayPrefs.ts";
import { FetchError } from "./FetchError.tsx";
import { NetWorthSparkline } from "./NetWorthSparkline.tsx";
import {
  RANGE_CHIPS,
  driftCaption,
  gainCaption,
  holdingValueCaption,
  pieConic,
  pieSlices,
} from "./portfolio.ts";
import { Amount } from "./Privacy.tsx";

function invalidatePortfolio(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["portfolio"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["invest"] });
}

function DriftBar({ row }: { row: PortfolioDriftRow }) {
  const actualPct = Math.min(100, Math.max(0, row.actualBp / 100));
  const targetPct = Math.min(100, Math.max(0, row.targetBp / 100));
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-base text-ink">{row.name}</p>
        <p className={`shrink-0 text-xs ${row.hint ? "font-medium text-warn" : "text-muted"}`}>
          {driftCaption(row)}
        </p>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-line">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent/80"
          style={{ width: `${actualPct}%` }}
        />
        <div
          className="absolute top-[-3px] h-3.5 w-0.5 bg-ink"
          style={{ left: `${targetPct}%` }}
          title="Plan target"
        />
      </div>
    </li>
  );
}

export function PortfolioScreen() {
  const { onToast } = useOutletContext<AppShellOutlet>();
  const qc = useQueryClient();
  const [range, setRange] = useState<HistoryRange>("All");
  const [addOpen, setAddOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [prefs] = useDisplayPrefs();

  const q = useQuery({
    queryKey: ["portfolio", range],
    queryFn: () => getPortfolio(range),
    staleTime: 15_000,
  });
  const data = q.data;

  const add = useMutation({
    mutationFn: () => postHolding({ assetId, accountId }),
    onSuccess: () => {
      invalidatePortfolio(qc);
      setAddOpen(false);
      onToast("Holding added");
    },
    onError: (err) => onToast(apiErrorText(err)),
  });

  const snap = useMutation({
    mutationFn: postSnapshot,
    onSuccess: () => {
      invalidatePortfolio(qc);
      onToast("Snapshot saved");
    },
    onError: (err) => onToast(apiErrorText(err)),
  });

  const unusedAssets = useMemo(() => {
    if (!data) return [];
    const used = new Set(data.holdings.map((row) => `${row.assetId}:${row.accountId}`));
    return data.assets.filter((asset) =>
      data.accounts.some((account) => !used.has(`${asset.id}:${account.id}`)),
    );
  }, [data]);
  const slices = useMemo(
    () => (data ? pieSlices(data, prefs.pieBy) : []),
    [data, prefs.pieBy],
  );
  const pieTotal = slices.reduce((sum, row) => sum + row.value, 0);

  return (
    <section className="page">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            <Link to="/wealth" className="text-accent">
              Wealth
            </Link>
            {" · Portfolio"}
          </p>
          <h1 className="page-title">Portfolio</h1>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => snap.mutate()}
          disabled={snap.isPending}
        >
          Snapshot
        </button>
      </header>

      {q.isPending ? (
        <p className="py-8 text-sm text-muted">Loading portfolio…</p>
      ) : q.error ? (
        <FetchError error={q.error} onRetry={() => void q.refetch()} />
      ) : data ? (
        <>
          <div className="desk-dash mt-4">
          <div className="card p-4 desk:col-span-8 desk:p-5">
            <p className="kicker">Current value</p>
            <p className="mt-1 hero-num text-ink">
              <Amount>{formatInr(data.value)}</Amount>
            </p>
            <p className="mt-1 text-sm text-muted">
              <Amount>Invested {formatInr(data.invested)}</Amount>
              {" · "}
              <Amount>{gainCaption(data.gain, data.gainPct)}</Amount>
            </p>
            <NetWorthSparkline points={data.history} />
            <div className="mt-2 flex flex-wrap gap-2">
              {RANGE_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={range === chip.id ? "chip chip-on" : "chip chip-off"}
                  onClick={() => setRange(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {prefs.showPie ? (
            <div className="card p-4 desk:col-span-4 desk:p-5">
              <p className="kicker">Where the money sits</p>
              {slices.length === 0 || pieTotal <= 0 ? (
                <p className="mt-2 text-sm text-muted">Add holdings to see the split.</p>
              ) : (
                <div className="mt-3 flex items-center gap-4">
                  <div
                    role="img"
                    aria-label="Allocation pie"
                    className="size-28 shrink-0 rounded-full desk:size-40"
                    style={{ background: pieConic(slices) }}
                  />
                  <ul className="min-w-0 flex-1 space-y-1.5">
                    {slices.map((slice) => (
                      <li key={slice.key} className="flex items-center gap-2 text-sm">
                        <span
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ background: slice.color }}
                        />
                        <span className="min-w-0 truncate text-ink">{slice.label}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-muted">
                          {formatBpPct(Math.round((slice.value / pieTotal) * 10_000))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-2 text-[12px] text-muted">Change the grouping in Settings.</p>
            </div>
          ) : null}

          <div className="card p-4 desk:col-span-6 desk:p-5">
            <p className="kicker">Allocation drift</p>
            {data.drift.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Add holdings to compare with the plan.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {data.drift.map((row) => (
                  <DriftBar key={row.assetId} row={row} />
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4 desk:col-span-6 desk:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="kicker">Holdings</p>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setAssetId(data.assets[0]?.id ?? "");
                  setAccountId(
                    data.accounts.find((row) => row.group === "investment")?.id ??
                      data.accounts[0]?.id ??
                      "",
                  );
                  setAddOpen(true);
                }}
              >
                Add
              </button>
            </div>
            {data.holdings.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No funds tracked yet. Add a holding to type NAV.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {data.holdings.map((row: PortfolioHoldingCard) => (
                  <li key={row.id}>
                    <Link
                      to={`/wealth/portfolio/${row.id}`}
                      className="flex min-h-11 items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base text-ink">{row.assetName}</span>
                        <span className="block text-xs text-muted">
                          {holdingValueCaption(row)}
                          {row.accountName ? ` · ${row.accountName}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <Amount className="block text-base font-medium tabular-nums text-ink">
                          {formatInr(row.value)}
                        </Amount>
                        <Amount className="block text-xs text-muted">{gainCaption(row.gain, row.gainPct)}</Amount>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4 desk:col-span-12 desk:p-5">
            <p className="kicker">Fixed deposits</p>
            {data.fds.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No FD accounts.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {data.fds.map((row) => (
                  <li key={row.accountId}>
                    <Link
                      to={`/more/accounts/${row.accountId}`}
                      className="flex min-h-11 items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base text-ink">{row.name}</span>
                        {row.daysCaption ? (
                          <span className="block text-xs text-muted">{row.daysCaption}</span>
                        ) : (
                          <span className="block text-xs text-muted">No maturity date</span>
                        )}
                      </span>
                      <Amount className="shrink-0 text-base font-medium tabular-nums text-ink">
                        {formatInr(row.balance)}
                      </Amount>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </div>
        </>
      ) : null}

      <BottomSheet open={addOpen} title="Add holding" onClose={() => setAddOpen(false)}>
        <label className="block">
          <span className="kicker">Asset</span>
          <select
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className="mt-1 field"
          >
            {unusedAssets.length === 0
              ? data?.assets.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))
              : unusedAssets.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
          </select>
        </label>
        <label className="mt-4 block">
          <span className="kicker">Account</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 field"
          >
            {(data?.accounts ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="mt-6 btn-primary min-h-12 w-full rounded-2xl"
          disabled={!assetId || !accountId || add.isPending}
          onClick={() => add.mutate()}
        >
          Save holding
        </button>
      </BottomSheet>
    </section>
  );
}
