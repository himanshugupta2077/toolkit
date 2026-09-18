import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { getHoldingDetail, patchHoldingNav, postHoldingTxn } from "../api/store.ts";
import { formatInr, formatUnits } from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { FieldLabel, FormSelect, namedOptions } from "./formFields.tsx";
import { gainCaption, holdingValueCaption, parseNavRupees } from "./portfolio.ts";
import { Amount } from "./Privacy.tsx";
import { parseRupeesInput, rupeesInput } from "./wealth.ts";

function invalidateHolding(qc: ReturnType<typeof useQueryClient>, id: string) {
  void qc.invalidateQueries({ queryKey: ["holding", id] });
  void qc.invalidateQueries({ queryKey: ["portfolio"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["ledger"] });
}

const KIND_LABEL: Record<string, string> = {
  buy_sip: "SIP buy",
  buy_dip: "Dip buy",
  sell: "Sell",
  dividend: "Dividend",
};

export function HoldingDetailScreen() {
  const { holdingId = "" } = useParams();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const qc = useQueryClient();
  const [navOpen, setNavOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [navDraft, setNavDraft] = useState("");
  const [buyAmount, setBuyAmount] = useState("");
  const [buyNav, setBuyNav] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");

  const q = useQuery({
    queryKey: ["holding", holdingId],
    queryFn: () => getHoldingDetail(holdingId),
    enabled: holdingId.length > 0,
    staleTime: 15_000,
  });
  const data = q.data;

  const navMut = useMutation({
    mutationFn: () => {
      const lastNav = parseNavRupees(navDraft);
      if (lastNav == null) throw new Error("NAV must be a positive rupee amount.");
      return patchHoldingNav(holdingId, { lastNav });
    },
    onSuccess: () => {
      invalidateHolding(qc, holdingId);
      setNavOpen(false);
      onToast("NAV updated");
    },
    onError: (err) => onToast(apiErrorText(err)),
  });

  const buyMut = useMutation({
    mutationFn: () => {
      const amount = parseRupeesInput(buyAmount);
      const nav = parseNavRupees(buyNav);
      if (amount == null || amount <= 0) throw new Error("Amount must be a positive rupee amount.");
      if (nav == null) throw new Error("NAV must be a positive rupee amount.");
      return postHoldingTxn(holdingId, {
        kind: "buy_sip",
        amount,
        nav,
        fromAccountId: fromAccountId || null,
      });
    },
    onSuccess: () => {
      invalidateHolding(qc, holdingId);
      setBuyOpen(false);
      onToast("Buy recorded");
    },
    onError: (err) => onToast(apiErrorText(err)),
  });

  const holding = data?.holding;

  return (
    <section className="page desk:max-w-2xl">
      <p className="text-sm text-muted">
        <Link to="/wealth/portfolio" className="text-accent">
          Portfolio
        </Link>
        {holding ? ` · ${holding.assetName}` : ""}
      </p>
      <h1 className="page-title">
        {holding?.assetName ?? "Holding"}
      </h1>

      {q.isPending ? (
        <p className="py-8 text-sm text-muted">Loading holding…</p>
      ) : q.error ? (
        <FetchError error={q.error} onRetry={() => void q.refetch()} />
      ) : holding ? (
        <>
          <div className="mt-4 card p-4">
            <p className="kicker">Value</p>
            <p className="mt-1 hero-num text-ink">
              <Amount>{formatInr(holding.value)}</Amount>
            </p>
            <p className="mt-1 text-sm text-muted">
              <Amount>{holdingValueCaption(holding)}</Amount>
            </p>
            <p className="mt-1 text-sm text-muted">
              <Amount>
                Cost {formatInr(holding.cost)}
                {holding.avgCost > 0 ? ` · avg ${formatInr(holding.avgCost)}` : ""}
              </Amount>
              {" · "}
              <Amount>{gainCaption(holding.gain, holding.gainPct)}</Amount>
            </p>
            <p className="mt-1 text-xs text-muted">{holding.accountName}</p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="min-h-11 rounded-2xl bg-accent text-base font-medium text-accent-fg"
              onClick={() => {
                setNavDraft(holding.lastNav != null ? rupeesInput(holding.lastNav) : "");
                setNavOpen(true);
              }}
            >
              Update NAV
            </button>
            <button
              type="button"
              className="min-h-11 rounded-2xl border border-line text-base font-medium text-ink"
              onClick={() => {
                setBuyAmount("");
                setBuyNav(holding.lastNav != null ? rupeesInput(holding.lastNav) : "");
                const from =
                  data.accounts.find((row) => row.group === "savings" || row.group === "cash")
                    ?.id ??
                  data.accounts[0]?.id ??
                  "";
                setFromAccountId(from);
                setBuyOpen(true);
              }}
            >
              Record buy
            </button>
          </div>

          <div className="mt-4 card p-4">
            <p className="kicker">Transactions</p>
            {data.txns.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No buys yet. Record a buy or deploy dip with NAV set.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {data.txns.map((row) => (
                  <li key={row.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-base text-ink">
                        {KIND_LABEL[row.kind] ?? row.kind}
                      </span>
                      <span className="block text-xs text-muted">
                        {row.date} · {formatUnits(row.units)} u · NAV {formatInr(row.nav)}
                      </span>
                    </span>
                    <Amount className="shrink-0 text-base tabular-nums text-ink">
                      {formatInr(row.amount)}
                    </Amount>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      <BottomSheet open={navOpen} title="Update NAV" onClose={() => setNavOpen(false)}>
        <div className="space-y-4 pb-1">
          <label className="block">
            <FieldLabel>NAV (₹ / unit)</FieldLabel>
            <input
              inputMode="decimal"
              value={navDraft}
              onChange={(e) => setNavDraft(e.target.value)}
              placeholder="150.25"
              className="mt-1 field"
            />
          </label>
          <button
            type="button"
            className="btn-primary w-full"
            disabled={parseNavRupees(navDraft) == null || navMut.isPending}
            onClick={() => navMut.mutate()}
          >
            Save NAV
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={buyOpen} title="Record buy" onClose={() => setBuyOpen(false)}>
        <div className="space-y-4 pb-1">
          <label className="block">
            <FieldLabel>Amount (₹)</FieldLabel>
            <input
              inputMode="decimal"
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              className="mt-1 field"
            />
          </label>
          <label className="block">
            <FieldLabel>NAV (₹ / unit)</FieldLabel>
            <input
              inputMode="decimal"
              value={buyNav}
              onChange={(e) => setBuyNav(e.target.value)}
              className="mt-1 field"
            />
          </label>
          <FormSelect
            label="From"
            value={fromAccountId}
            onChange={setFromAccountId}
            options={namedOptions(
              (data?.accounts ?? []).filter((row) => row.id !== holding?.accountId),
            )}
          />
          <p className="text-xs text-muted">
            Writes an Investment ledger row to {holding?.accountName ?? "this account"}.
          </p>
          <button
            type="button"
            className="btn-primary w-full"
            disabled={
              parseRupeesInput(buyAmount) == null ||
              parseNavRupees(buyNav) == null ||
              !fromAccountId ||
              buyMut.isPending
            }
            onClick={() => buyMut.mutate()}
          >
            Save buy
          </button>
        </div>
      </BottomSheet>
    </section>
  );
}
