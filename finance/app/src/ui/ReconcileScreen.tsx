import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { getAccount, postReconcile } from "../api/store.ts";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { formatInr, reconCheckedDate, yearMonthFromIsoDate } from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { differenceHint, searchAmountQuery } from "./accounts.ts";
import { AmountField } from "./formFields.tsx";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  amountExpression,
  amountPaise,
  EMPTY_AMOUNT,
  type AmountDraft,
} from "./quickAdd.ts";

function invalidateAfterReconcile(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["accounts"] });
  void qc.invalidateQueries({ queryKey: ["account"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["month"] });
  void qc.invalidateQueries({ queryKey: ["ledger"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
  void qc.invalidateQueries({ queryKey: ["counts"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["plan"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
}

export function ReconcileScreen() {
  const { accountId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [actual, setActual] = useState<AmountDraft>(EMPTY_AMOUNT);
  const [hydrated, setHydrated] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const detailQ = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getAccount(accountId),
    enabled: accountId !== "",
  });

  const data = detailQ.data;
  const calculated = data?.balance ?? 0;

  if (data && !hydrated) {
    setActual(calculated > 0 ? amountDraftFromPaise(calculated) : EMPTY_AMOUNT);
    setHydrated(true);
  }

  const actualPaise = amountPaise(actual);
  const difference = actualPaise - calculated;
  const match = difference === 0;

  const findMissingHref = useMemo(() => {
    if (!data) return "/ledger";
    const last = data.lastReconciledAt ? reconCheckedDate(data.lastReconciledAt) : null;
    const month = yearMonthFromIsoDate(last ?? data.today);
    const q = searchAmountQuery(Math.abs(difference));
    const params = new URLSearchParams({
      month,
      account: data.account.id,
      q,
    });
    return `/ledger?${params.toString()}`;
  }, [data, difference]);

  async function stamp() {
    if (!data || !match) return;
    setSaving(true);
    try {
      await postReconcile({
        accountId: data.account.id,
        actualBalance: actualPaise,
        resolution: "none",
      });
      onToast(`Reconciled · ${data.account.name}`);
      await invalidateAfterReconcile(qc);
      navigate(`/more/accounts/${data.account.id}`);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function adjust() {
    if (!data || match || note.trim() === "") return;
    setSaving(true);
    try {
      const res = await postReconcile({
        accountId: data.account.id,
        actualBalance: actualPaise,
        resolution: "adjustment",
        notes: note.trim(),
      });
      onToast(`Adjustment ${formatInr(res.entry?.amount ?? Math.abs(difference))} · gap closed`);
      await invalidateAfterReconcile(qc);
      navigate(`/more/accounts/${data.account.id}`);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  if (detailQ.isPending) {
    return (
      <section className="page">
        <p className="text-sm text-muted">Loading account…</p>
      </section>
    );
  }
  if (detailQ.error) {
    return (
      <section className="page">
        <Link to="/more/accounts" className="btn-ghost">
          ← Accounts
        </Link>
        <FetchError error={detailQ.error} onRetry={() => void detailQ.refetch()} />
      </section>
    );
  }
  if (!data) {
    return (
      <section className="page">
        <Link to="/more/accounts" className="btn-ghost">
          ← Accounts
        </Link>
        <p className="mt-4 text-sm text-muted">Account not found.</p>
      </section>
    );
  }

  if (!data.canReconcile) {
    return (
      <section className="page">
        <Link
          to={`/more/accounts/${data.account.id}`}
          className="btn-ghost"
        >
          ← {data.account.name}
        </Link>
        <p className="mt-4 text-sm text-muted">Virtual accounts are not reconciled.</p>
      </section>
    );
  }

  return (
    <section className="page flex min-h-0 flex-col desk:max-w-2xl">
      <Link
        to={`/more/accounts/${data.account.id}`}
        className="btn-ghost"
      >
        ← {data.account.name}
      </Link>
      <h1 className="page-title mt-1">Reconcile</h1>
      <p className="mt-1 text-sm text-muted">Type the number from the bank app. Do not edit the calculated balance.</p>

      <dl className="mt-4 space-y-1 text-base">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Calculated</dt>
          <dd className="tabular-nums font-medium">{formatInr(calculated)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Actual</dt>
          <dd className="tabular-nums font-medium">
            {amountExpression(actual) ? formatInr(actualPaise) : formatInr(0)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Difference</dt>
          <dd className={`tabular-nums font-medium ${match ? "text-ink" : "text-warn"}`}>
            {formatInr(difference)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-sm text-muted">{differenceHint(difference)}</p>

      <div className="mt-4">
        <AmountField
          label="Bank actual"
          amount={actual}
          onChange={setActual}
          plus={false}
        />
      </div>

      {match ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void stamp()}
          className="mt-4 btn-primary w-full"
        >
          Mark reconciled today
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <Link
            to={findMissingHref}
            className="flex min-h-11 items-center justify-center rounded-xl border border-line text-base font-medium text-ink"
          >
            Find missing transaction
          </Link>
          <label className="block">
            <span className="kicker">
              Adjustment note
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Required: why the gap"
              className="mt-1 field"
            />
          </label>
          <button
            type="button"
            disabled={saving || note.trim() === ""}
            onClick={() => void adjust()}
            className="btn-primary w-full"
          >
            Add adjustment
          </button>
        </div>
      )}

      {data.reconciliations.length > 0 ? (
        <div className="mt-8">
          <h2 className="kicker">History</h2>
          <ul className="mt-2 space-y-2">
            {data.reconciliations.map((row) => (
              <li key={row.id} className="text-sm text-muted">
                {row.checkedAt.slice(0, 10)} · calc {formatInr(row.calculatedBalance)} · actual{" "}
                {formatInr(row.actualBalance)} · Δ {formatInr(row.difference)}
                {row.resolution === "adjustment" ? " · Adjustment" : ""}
                {row.notes ? ` · ${row.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
