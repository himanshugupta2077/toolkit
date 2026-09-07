import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getAllocation, postAllocationRun } from "../api/store.ts";
import {
  DEFAULT_BUCKET_IDS,
  formatInr,
  runWaterfall,
  splitInvest,
  ZERO_PAISE,
  type Paise,
  type WaterfallOverrides,
} from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import {
  afterCaption,
  COMMITTED_BEYOND_LIQUID,
  confirmBlockedReason,
  historyLineCaption,
  historyTitle,
  pickerAccounts,
  picksFromSuggested,
  ruleCaption,
  toConfirmLines,
  type LinePick,
} from "./allocate.ts";
import { BottomSheet } from "./BottomSheet.tsx";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { Amount } from "./Privacy.tsx";
import { parseRupeesInput, rupeesInput } from "./wealth.ts";
import { signedLineAmount } from "./home.ts";

function invalidateAfterAllocate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["allocation"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["ledger"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["month"] });
  void qc.invalidateQueries({ queryKey: ["accounts"] });
  void qc.invalidateQueries({ queryKey: ["account"] });
  void qc.invalidateQueries({ queryKey: ["plan"] });
  void qc.invalidateQueries({ queryKey: ["counts"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
  void qc.invalidateQueries({ queryKey: ["invest"] });
}

const selectClass = "field mt-1";

export function AllocateScreen() {
  const { onToast } = useOutletContext<AppShellOutlet>();
  const qc = useQueryClient();
  const allocQ = useQuery({
    queryKey: ["allocation"],
    queryFn: getAllocation,
    staleTime: 15_000,
  });
  const data = allocQ.data;

  const [surplusOverride, setSurplusOverride] = useState<Paise | null>(null);
  const [reason, setReason] = useState("");
  const [overrides, setOverrides] = useState<WaterfallOverrides>({});
  const [picks, setPicks] = useState<Record<string, LinePick>>({});
  const [whyOpen, setWhyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [surplusOpen, setSurplusOpen] = useState(false);
  const [draftSurplus, setDraftSurplus] = useState("");
  const [saving, setSaving] = useState(false);

  const surplus: Paise =
    surplusOverride ?? (data && data.freeCash.free > 0 ? data.freeCash.free : ZERO_PAISE);
  const activePicks =
    Object.keys(picks).length > 0 || !data
      ? picks
      : picksFromSuggested(data.example.lines, data.suggested);

  const currentMap = useMemo(() => {
    const map: Record<string, Paise> = {};
    for (const bucket of data?.buckets ?? []) map[bucket.id] = bucket.current;
    return map;
  }, [data]);

  const waterfall = useMemo(() => {
    if (!data || data.buckets.length === 0) return null;
    try {
      return runWaterfall(
        surplus,
        data.buckets,
        currentMap,
        data.essentialsAverage,
        overrides,
      );
    } catch {
      return null;
    }
  }, [data, surplus, currentMap, overrides]);

  const investAmount =
    waterfall?.lines.find((row) => row.bucketId === DEFAULT_BUCKET_IDS.investment)?.amount ??
    ZERO_PAISE;
  let investSplit = null;
  if (data?.investPlan && investAmount > 0) {
    try {
      investSplit = splitInvest(investAmount, data.investPlan);
    } catch {
      investSplit = null;
    }
  }

  const blocked = data
    ? confirmBlockedReason({
        canAllocate: data.canAllocate,
        free: data.freeCash.free,
        surplus,
        reason,
        lines: waterfall?.lines ?? [],
        picks: activePicks,
      })
    : "Loading…";

  const pickers = pickerAccounts(data?.linkableAccounts ?? []);

  function setPick(bucketId: string, patch: Partial<LinePick>) {
    setPicks((prev) => ({
      ...prev,
      [bucketId]: {
        fromAccountId: prev[bucketId]?.fromAccountId ?? "",
        toAccountId: prev[bucketId]?.toAccountId ?? "",
        ...patch,
      },
    }));
  }

  function resetPlan() {
    setOverrides({});
    setSurplusOverride(null);
    setReason("");
    setPicks({});
  }

  async function confirm() {
    if (!data || !waterfall || blocked) return;
    setSaving(true);
    try {
      const res = await postAllocationRun({
        surplusInput: surplus,
        overrideReason: reason.trim() === "" ? null : reason.trim(),
        confirm: true,
        lines: toConfirmLines(waterfall.lines, activePicks),
      });
      onToast(`Allocated ${formatInr(res.run?.surplusInput ?? surplus)}`);
      setSurplusOverride(null);
      setReason("");
      setOverrides({});
      setPicks({});
      await invalidateAfterAllocate(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  const free = data?.freeCash.free ?? 0;
  const negative = free < 0;

  return (
    <section className="px-5 pb-8">
      <div className="flex items-center gap-2">
        <Link
          to="/wealth"
          className="btn-ghost"
        >
          ← Wealth
        </Link>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Allocate</h1>
      <p className="mt-1 text-sm text-muted">Confirm writes ledger transfers. History is not rewritten.</p>

      {allocQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading Allocate…</p>
      ) : allocQ.error ? (
        <FetchError error={allocQ.error} onRetry={() => void allocQ.refetch()} />
      ) : data ? (
        <>
          {negative ? (
            <div className="mt-4 card-danger p-4">
              <p className="text-base font-medium text-danger">
                {COMMITTED_BEYOND_LIQUID}
              </p>
              <p className="mt-1 text-sm text-muted">
                Free to allocate is negative. The breakdown on Home shows why. Allocate stays off
                until free cash is positive.
              </p>
            </div>
          ) : null}

          <div className="mt-4 card p-4">
            <p className="kicker">Surplus</p>
            <div className="mt-1 flex items-start justify-between gap-3">
              <p className={`hero-num ${negative ? "text-danger" : "text-ink"}`}>
                <Amount>{formatInr(surplus)}</Amount>
              </p>
              <button
                type="button"
                className="min-h-11 text-sm font-medium text-accent"
                onClick={() => {
                  setDraftSurplus(rupeesInput(surplus));
                  setSurplusOpen(true);
                }}
                disabled={negative}
              >
                Edit
              </button>
            </div>
            {surplus !== free ? (
              <p className="mt-1 text-xs text-muted">
                Engine free is <Amount>{formatInr(free)}</Amount>
                {reason.trim() ? ` · ${reason.trim()}` : " · add a reason to confirm"}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">Prefill is today’s free to allocate.</p>
            )}
            <button
              type="button"
              className="mt-2 min-h-11 text-sm font-medium text-accent"
              aria-expanded={whyOpen}
              onClick={() => setWhyOpen((open) => !open)}
            >
              {whyOpen ? "Hide why" : "Why this number?"}
            </button>
            {whyOpen ? (
              <ul className="mt-1 space-y-1 text-sm">
                {data.freeCash.breakdown.map((row) => (
                  <li key={row.key} className="flex justify-between gap-3 tabular-nums">
                    <span className="text-muted">{row.label}</span>
                    <Amount className="text-ink">{signedLineAmount(row.sign, row.amount)}</Amount>
                  </li>
                ))}
                <li className="flex justify-between gap-3 pt-1 font-medium tabular-nums">
                  <span>Free</span>
                  <Amount>{formatInr(data.freeCash.free)}</Amount>
                </li>
              </ul>
            ) : null}
          </div>

          {waterfall ? (
            <div className="mt-3 space-y-3">
              {waterfall.lines.map((row) => (
                <article key={row.bucketId} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-medium text-ink">{row.name}</h2>
                      <p className="text-xs text-muted">{ruleCaption(row.fillMode)}</p>
                    </div>
                    <Amount className="text-lg font-semibold tabular-nums text-ink">
                      {formatInr(row.amount)}
                    </Amount>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    <Amount>{afterCaption(row)}</Amount>
                  </p>
                  <label className="mt-3 block">
                    <span className="kicker">
                      Amount ₹
                    </span>
                    <input
                      inputMode="decimal"
                      value={rupeesInput(overrides[row.bucketId] ?? row.amount)}
                      onChange={(e) => {
                        const parsed = parseRupeesInput(e.target.value);
                        if (parsed == null) return;
                        setOverrides((prev) => ({ ...prev, [row.bucketId]: parsed }));
                      }}
                      className="field mt-1 tabular-nums"
                      aria-label={`${row.name} amount rupees`}
                      disabled={!data.canAllocate}
                    />
                  </label>
                  {row.amount > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label>
                        <span className="kicker">
                          From
                        </span>
                        <select
                          className={selectClass}
                          value={activePicks[row.bucketId]?.fromAccountId ?? ""}
                          onChange={(e) => setPick(row.bucketId, { fromAccountId: e.target.value })}
                          aria-label={`${row.name} from account`}
                        >
                          <option value="">Choose…</option>
                          {pickers.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="kicker">
                          To
                        </span>
                        <select
                          className={selectClass}
                          value={activePicks[row.bucketId]?.toAccountId ?? ""}
                          onChange={(e) => setPick(row.bucketId, { toAccountId: e.target.value })}
                          aria-label={`${row.name} to account`}
                        >
                          <option value="">Choose…</option>
                          {pickers.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Fix bucket rules before running the waterfall.</p>
          )}

          <button
            type="button"
            className="mt-3 min-h-11 text-sm font-medium text-accent"
            onClick={resetPlan}
          >
            Reset to plan
          </button>

          {investSplit ? (
            <article className="mt-3 card p-4">
              <h2 className="text-base font-medium text-ink">This month’s SIP</h2>
              <p className="mt-1 text-sm text-muted">
                Read-only preview.{" "}
                <Link to="/wealth/invest" className="font-medium text-accent">
                  Edit plan
                </Link>
              </p>
              <p className="mt-2 text-sm text-ink">
                SIP pool <Amount className="font-medium tabular-nums">{formatInr(investSplit.sipPool)}</Amount>
                {" · "}
                Dip reserve{" "}
                <Amount className="font-medium tabular-nums">{formatInr(investSplit.dipCredit)}</Amount>
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {investSplit.orders
                  .filter((row) => row.activeForSplit)
                  .map((row) => (
                    <li key={row.assetId} className="flex justify-between gap-3">
                      <span className="truncate text-ink">{row.name}</span>
                      <Amount className="shrink-0 tabular-nums text-muted">
                        {formatInr(row.amount)}
                      </Amount>
                    </li>
                  ))}
              </ul>
            </article>
          ) : null}

          <button
            type="button"
            disabled={Boolean(blocked) || saving}
            onClick={() => void confirm()}
            className="mt-4 w-full btn-primary min-h-12 w-full rounded-2xl"
          >
            {saving ? "Confirming…" : "Confirm allocation"}
          </button>
          {blocked && data.canAllocate ? (
            <p className="mt-2 text-sm text-muted">{blocked}</p>
          ) : null}

          <div className="mt-6">
            <button
              type="button"
              className="min-h-11 text-sm font-medium text-accent"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              {historyOpen ? "Hide history" : "History"}
            </button>
            {historyOpen ? (
              data.history.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No allocation runs yet.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {data.history.map((run) => (
                    <li key={run.id} className="card p-4">
                      <p className="text-sm font-medium text-ink">{historyTitle(run)}</p>
                      <p className="mt-1 text-sm text-muted">{historyLineCaption(run)}</p>
                      {run.overrideReason ? (
                        <p className="mt-1 text-xs text-muted">{run.overrideReason}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </>
      ) : null}

      <BottomSheet
        open={surplusOpen}
        title="Edit surplus"
        onClose={() => setSurplusOpen(false)}
      >
        <div className="px-5 pb-6">
          <label className="block">
            <span className="kicker">Amount ₹</span>
            <input
              inputMode="decimal"
              value={draftSurplus}
              onChange={(e) => setDraftSurplus(e.target.value)}
              className="field mt-1 tabular-nums"
              aria-label="Surplus rupees"
            />
          </label>
          <label className="mt-3 block">
            <span className="kicker">Reason</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 field"
              placeholder="Why not today’s free cash?"
              aria-label="Surplus override reason"
            />
          </label>
          <button
            type="button"
            className="mt-4 w-full min-h-12 rounded-2xl bg-accent px-4 text-base font-medium text-accent-fg"
            onClick={() => {
              const parsed = parseRupeesInput(draftSurplus);
              if (parsed == null) return;
              setSurplusOverride(parsed);
              setSurplusOpen(false);
            }}
          >
            Apply
          </button>
        </div>
      </BottomSheet>
    </section>
  );
}
