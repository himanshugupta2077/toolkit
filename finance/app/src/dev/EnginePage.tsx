import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/http.ts";
import {
  getEngineSummary,
  saveInvestSeed,
  seedInvestDefaults,
  type EngineSummary,
} from "../api/store.ts";
import { formatInr, paiseToRupees } from "../engine/index.ts";
import { importInvestFile } from "../import/upload.ts";

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | null;
    if (body?.error) return body.error;
    return `HTTP ${err.status}`;
  }
  if (err instanceof Error) return err.message;
  return "Request failed";
}

type SeedForm = {
  savingsRupees: number;
  efRupees: number;
  sip: number;
  dip: number;
  goldInactive: boolean;
};

function sipPct(summary: EngineSummary): number {
  return summary.investPlan ? Math.round(summary.investPlan.sipBp / 100) : 70;
}

function formFromSummary(summary: EngineSummary): SeedForm {
  const sip = sipPct(summary);
  const gold = summary.investPlan?.assets.find(
    (row) => row.name.trim().toLowerCase() === "gold",
  );
  return {
    savingsRupees: Math.round(paiseToRupees(summary.savingsTarget)),
    efRupees: Math.round(paiseToRupees(summary.efTarget)),
    sip,
    dip: 100 - sip,
    goldInactive: gold ? !gold.active : true,
  };
}

const EMPTY_FORM: SeedForm = {
  savingsRupees: 10_000,
  efRupees: 0,
  sip: 70,
  dip: 30,
  goldInactive: true,
};

export function EnginePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [edit, setEdit] = useState<SeedForm | null>(null);

  const summaryQ = useQuery({ queryKey: ["engine-summary"], queryFn: getEngineSummary });
  const summary = summaryQ.data?.summary;
  const form = edit ?? (summary ? formFromSummary(summary) : EMPTY_FORM);
  const { savingsRupees, efRupees, sip, dip, goldInactive } = form;

  function patchForm(next: Partial<SeedForm>) {
    setEdit({ ...form, ...next });
  }

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["engine-summary"] });
  }

  async function onDefault() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await seedInvestDefaults();
      setMessage(
        `Default 70/30 plan saved. Tagged ${res.report.tagged} account(s). ${res.report.confirmation}`,
      );
      setEdit(null);
      await refresh();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await saveInvestSeed({
        savingsRupees,
        efRupees,
        sipPct: sip,
        dipPct: dip,
        goldInactive,
      });
      setMessage(`Saved. ${res.summary.confirmation}`);
      setEdit(null);
      await refresh();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onImport(file: File) {
    setBusy(true);
    setMessage(null);
    setProgress(0);
    try {
      const res = await importInvestFile(file, setProgress);
      setMessage(
        `Imported ${res.report.filename}. ${res.report.goals.length} goal(s). ${res.report.confirmation}`,
      );
      setEdit(null);
      await refresh();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const hasGold = Boolean(
    summary?.investPlan?.assets.some((row) => row.name.trim().toLowerCase() === "gold"),
  );
  const sipDipOk = sip + dip === 100 && sip >= 0 && dip >= 0;

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-app px-5 pt-[max(0.85rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-ink">
      <p className="text-sm font-medium text-muted">Finance OS · Phase 11</p>
      <h1 className="mt-1 text-2xl font-semibold">Engine seed</h1>
      <p className="mt-2 text-sm text-muted">
        Tag FD / ICICI / Mutual Fund to buckets, seed the 70/30 plan, import the
        investment xlsx. Wealth overview is the product screen.
      </p>
      <p className="mt-2 text-sm">
        <Link to="/dev/store" className="text-accent underline">
          Back to store
        </Link>
      </p>

      {summaryQ.error ? (
        <p className="mt-4 text-sm text-red-700 dark:text-red-400">
          {errorText(summaryQ.error)}: is the API running on :8787?
        </p>
      ) : null}

      {summary ? (
        <section className="mt-6 rounded-xl border border-line bg-sheet p-4">
          <h2 className="text-sm font-medium text-muted">Confirmation</h2>
          <p className="mt-2 text-sm font-medium">{summary.confirmation}</p>
          <ul className="mt-3 space-y-2 text-sm">
            {summary.buckets.map((row) => (
              <li key={row.id} className="rounded-lg bg-app px-3 py-2">
                <div className="flex justify-between gap-2">
                  <span>{row.name}</span>
                  <span className="font-medium">{formatInr(row.current)}</span>
                </div>
                <div className="text-muted">
                  target {row.target == null ? "remainder" : formatInr(row.target)}
                  {row.accounts.length > 0
                    ? ` · ${row.accounts.map((a) => a.name).join(", ")}`
                    : " · no tagged accounts"}
                </div>
              </li>
            ))}
          </ul>
          {summary.unassignedLiquid.length > 0 ? (
            <p className="mt-3 text-sm text-muted">
              Unassigned liquid:{" "}
              {summary.unassignedLiquid
                .map((row) => `${row.name} ${formatInr(row.balance)}`)
                .join(" · ")}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      )}

      <section className="mt-4 rounded-xl border border-line bg-sheet p-4">
        <h2 className="text-sm font-medium text-muted">Seed wizard</h2>
        <label className="mt-3 block text-sm text-muted" htmlFor="savings-target">
          Savings target (₹)
        </label>
        <input
          id="savings-target"
          type="number"
          min={0}
          step={1}
          value={savingsRupees}
          onChange={(e) => patchForm({ savingsRupees: Number(e.target.value) })}
          className="mt-1 min-h-11 w-full rounded-lg border border-line bg-app px-3 text-base text-ink"
        />
        <label className="mt-3 block text-sm text-muted" htmlFor="ef-target">
          Emergency Fund target (₹)
        </label>
        <input
          id="ef-target"
          type="number"
          min={0}
          step={1}
          value={efRupees}
          onChange={(e) => patchForm({ efRupees: Number(e.target.value) })}
          className="mt-1 min-h-11 w-full rounded-lg border border-line bg-app px-3 text-base text-ink"
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-muted" htmlFor="sip-pct">
              SIP %
            </label>
            <input
              id="sip-pct"
              type="number"
              min={0}
              max={100}
              step={1}
              value={sip}
              onChange={(e) => {
                const next = Number(e.target.value);
                patchForm({ sip: next, dip: 100 - next });
              }}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-app px-3 text-base text-ink"
            />
          </div>
          <div>
            <label className="block text-sm text-muted" htmlFor="dip-pct">
              Dip %
            </label>
            <input
              id="dip-pct"
              type="number"
              min={0}
              max={100}
              step={1}
              value={dip}
              onChange={(e) => {
                const next = Number(e.target.value);
                patchForm({ dip: next, sip: 100 - next });
              }}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-app px-3 text-base text-ink"
            />
          </div>
        </div>
        {hasGold ? (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={goldInactive}
              onChange={(e) => patchForm({ goldInactive: e.target.checked })}
              className="size-4"
            />
            Gold inactive
          </label>
        ) : (
          <p className="mt-3 text-sm text-muted">Default plan has no Gold row.</p>
        )}
        <button
          type="button"
          disabled={busy || !sipDipOk}
          onClick={() => void onSave()}
          className="mt-3 min-h-11 w-full rounded-xl bg-accent px-4 text-base font-medium text-accent-fg disabled:opacity-50"
        >
          Save targets
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDefault()}
          className="mt-2 min-h-11 w-full rounded-xl border border-line px-4 text-base text-ink disabled:opacity-50"
        >
          Use default 70/30 plan
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImport(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="mt-2 min-h-11 w-full rounded-xl border border-line px-4 text-base text-ink disabled:opacity-50"
        >
          {progress == null ? "Upload investment xlsx" : `Uploading ${progress}%`}
        </button>
      </section>

      {summary?.goals.length ? (
        <section className="mt-4 rounded-xl border border-line bg-sheet p-4">
          <h2 className="text-sm font-medium text-muted">Goals</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {summary.goals.map((row) => (
              <li key={row.id}>
                {row.name}
                {row.targetAmount == null
                  ? " · target blank"
                  : ` · ${formatInr(row.targetAmount)}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary?.investPlan ? (
        <section className="mt-4 rounded-xl border border-line bg-sheet p-4">
          <h2 className="text-sm font-medium text-muted">Invest plan</h2>
          <p className="mt-2 text-sm">
            SIP {Math.round(summary.investPlan.sipBp / 100)}% · dip{" "}
            {Math.round(summary.investPlan.dipReserveBp / 100)}%
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.investPlan.assets.map((row) => (
              <li key={row.id} className={row.active ? "" : "text-muted"}>
                {row.active ? "" : "(off) "}
                {row.name} · {row.kind} · {row.targetBp / 100}%
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {message ? <p className="mt-4 text-sm">{message}</p> : null}
    </div>
  );
}
