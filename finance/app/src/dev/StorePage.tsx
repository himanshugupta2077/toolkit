import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/http.ts";
import {
  addDummyExpense,
  getCounts,
  getHealth,
  getMonth,
  wipeStore,
  type BalanceMatchLine,
  type ImportReport,
} from "../api/store.ts";
import { formatInr, todayIst, yearMonthFromIsoDate } from "../engine/index.ts";
import { importFinanceFile } from "../import/upload.ts";

const MONTH = yearMonthFromIsoDate(todayIst());

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; issues?: { message: string }[] } | null;
    if (body?.error) return body.error;
    if (body?.issues?.length) return body.issues.map((i) => i.message).join(" ");
    return `HTTP ${err.status}`;
  }
  if (err instanceof Error) return err.message;
  return "Request failed";
}

export function StorePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [wipeInput, setWipeInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const health = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const counts = useQuery({ queryKey: ["counts"], queryFn: getCounts });
  const month = useQuery({
    queryKey: ["month", MONTH],
    queryFn: () => getMonth(MONTH),
  });

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["health"] }),
      qc.invalidateQueries({ queryKey: ["counts"] }),
      qc.invalidateQueries({ queryKey: ["month"] }),
      qc.invalidateQueries({ queryKey: ["home"] }),
      qc.invalidateQueries({ queryKey: ["wealth"] }),
    ]);
  }

  async function onDummy() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await addDummyExpense();
      setMessage(
        `Added dummy expense ${formatInr(res.entry.amount)}. ${MONTH} budget spent is now ${formatInr(res.summary.budgetSpent)}.`,
      );
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
    setSelectedAccountId(null);
    try {
      const res = await importFinanceFile(file, replace, setProgress);
      setReport(res.report);
      const spentNote = res.report.ok
        ? "Real accounts match to ₹1."
        : `${res.report.mismatches.filter((row) => row.type !== "virtual").length} real-account mismatch(es).`;
      setMessage(
        `Imported ${res.report.counts.ledgerInserted} ledger row(s), skipped ${res.report.counts.ledgerSkipped}. ${spentNote}`,
      );
      await refresh();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onWipe() {
    setBusy(true);
    setMessage(null);
    try {
      await wipeStore(wipeInput);
      setWipeInput("");
      setMessage("Wiped. Seed catalog is back; ledger is empty.");
      await refresh();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const countRows = counts.data?.counts;
  const spent = month.data?.summary.budgetSpent;
  const liquid = month.data?.freeCash?.liquid;

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-app px-5 pt-[max(0.85rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-ink">
      <p className="text-sm font-medium text-muted">Finance OS · Phase 11</p>
      <h1 className="mt-1 text-2xl font-semibold">Store</h1>
      <p className="mt-2 text-sm text-muted">
        SQLite on this laptop. Upload a copy of Finance-Mng-V2.xlsx. Clearing
        site data on the phone does not delete rows. Investment seed is on{" "}
        <Link to="/dev/engine" className="text-accent underline">
          /dev/engine
        </Link>
        .
      </p>

      <section className="mt-6 rounded-xl border border-line bg-sheet p-4">
        <h2 className="text-sm font-medium text-muted">Health</h2>
        {health.data ? (
          <dl className="mt-2 space-y-1 text-sm">
            <div>schema {health.data.schemaVersion}</div>
            <div className="break-all">{health.data.dbFile}</div>
            <div>last backup {health.data.lastBackup ?? "never"}</div>
            <div>last import {health.data.lastImport ?? "never"}</div>
          </dl>
        ) : health.error ? (
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">
            {errorText(health.error)}: is the API running on :8787?
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Loading…</p>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-line bg-sheet p-4">
        <h2 className="text-sm font-medium text-muted">Counts</h2>
        {countRows ? (
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
            <li>accounts {countRows.accounts}</li>
            <li>categories {countRows.categories}</li>
            <li>ledger {countRows.ledgerEntries}</li>
            <li>buckets {countRows.buckets}</li>
            <li>recurring {countRows.recurringPlans}</li>
            <li>one-time {countRows.oneTimePlans}</li>
            <li>inflows {countRows.expectedInflows}</li>
            <li>reconcile {countRows.reconciliations ?? 0}</li>
            <li>month budgets {countRows.monthBudgets}</li>
            <li>goals {countRows.goals ?? 0}</li>
            <li>invest plans {countRows.investPlans ?? 0}</li>
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">—</p>
        )}
        <p className="mt-3 text-sm">
          {MONTH} budget spent{" "}
          <span className="font-medium">
            {spent == null ? "—" : formatInr(spent)}
          </span>
        </p>
        <p className="mt-1 text-sm">
          liquid{" "}
          <span className="font-medium">
            {liquid == null ? "—" : formatInr(liquid)}
          </span>
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-line bg-sheet p-4">
        <h2 className="text-sm font-medium text-muted">Import Finance-Mng</h2>
        <p className="mt-1 text-sm text-muted">
          Pick the live workbook or a copy. Does not write Excel. Tick wipe if
          dummy expenses are in the way of a ₹1 match.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="size-4"
          />
          Wipe existing rows first
        </label>
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
          className="mt-3 min-h-11 w-full rounded-xl bg-accent px-4 text-base font-medium text-accent-fg disabled:opacity-50"
        >
          {progress == null ? "Choose xlsx" : `Uploading ${progress}%`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setReport(null);
            setMessage("Skipped. Seed catalog stays. Import when you have the xlsx.");
          }}
          className="mt-2 min-h-11 w-full rounded-xl border border-line px-4 text-base text-ink disabled:opacity-50"
        >
          Skip import
        </button>
      </section>

      {report ? <ImportReportCard report={report} selectedAccountId={selectedAccountId} onSelect={setSelectedAccountId} /> : null}

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDummy()}
          className="min-h-11 rounded-xl bg-accent px-4 text-base font-medium text-accent-fg disabled:opacity-50"
        >
          Add one dummy expense
        </button>

        <div className="rounded-xl border border-red-700/40 bg-sheet p-4">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Wipe
          </p>
          <p className="mt-1 text-sm text-muted">
            Deletes every row, then re-seeds the tiny catalog. Type{" "}
            <span className="font-mono">wipe</span> to enable.
          </p>
          <label className="mt-3 block text-sm text-muted" htmlFor="wipe-confirm">
            Confirm
          </label>
          <input
            id="wipe-confirm"
            value={wipeInput}
            onChange={(e) => setWipeInput(e.target.value)}
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-lg border border-line bg-app px-3 text-base text-ink"
          />
          <button
            type="button"
            disabled={busy || wipeInput !== "wipe"}
            onClick={() => void onWipe()}
            className="mt-3 min-h-11 w-full rounded-xl bg-red-700 px-4 text-base font-medium text-white disabled:opacity-40"
          >
            Wipe
          </button>
        </div>
      </div>

      {message ? <p className="mt-4 text-sm">{message}</p> : null}
    </div>
  );
}

function ImportReportCard({
  report,
  selectedAccountId,
  onSelect,
}: {
  report: ImportReport;
  selectedAccountId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const selected = report.balances.find((row) => row.accountId === selectedAccountId);
  const entries = selected
    ? report.ledger.filter(
        (row) =>
          row.fromAccountId === selected.accountId ||
          row.toAccountId === selected.accountId,
      )
    : [];

  return (
    <section className="mt-4 rounded-xl border border-line bg-sheet p-4">
      <h2 className="text-sm font-medium text-muted">Balance match</h2>
      <p className="mt-1 text-sm">
        {report.ok ? "All real accounts match to ₹1." : "Some real accounts do not match."}{" "}
        Sep Loan/EMI {formatInr(report.recurringCheck.loanEmi)}
        {report.recurringCheck.includesSmartEmi ? " (includes MacBook SmartEMI)." : "."}
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {report.balances.map((row) => (
          <BalanceRow
            key={row.accountId}
            row={row}
            selected={row.accountId === selectedAccountId}
            onSelect={onSelect}
          />
        ))}
      </ul>
      {selected ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-sm font-medium">
            {selected.name} · {entries.length} ledger row(s)
          </p>
          <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm">
            {entries.map((row) => (
              <li key={row.id} className="rounded-lg bg-app px-3 py-2">
                <div>
                  {row.date} · {row.type} · {formatInr(row.amount)}
                  {row.sheetRow != null ? ` · sheet r${row.sheetRow}` : ""}
                </div>
                <div className="text-muted">
                  {row.fromName} → {row.toName} · {row.categoryName}
                  {row.notes ? ` · ${row.notes}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.typeGuideIssues.length > 0 ? (
        <p className="mt-3 text-sm text-muted">
          {report.typeGuideIssues.length} imported row(s) fail the Type Guide
          (kept so balances match the sheet).
        </p>
      ) : null}
    </section>
  );
}

function BalanceRow({
  row,
  selected,
  onSelect,
}: {
  row: BalanceMatchLine;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const mismatch = !row.match;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(selected ? null : row.accountId)}
        className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left ${
          mismatch ? "bg-red-700/10 text-red-800 dark:text-red-300" : ""
        } ${selected ? "ring-1 ring-accent" : ""}`}
      >
        <span>
          {mismatch ? "✗" : "✓"} {row.name}
        </span>
        <span className="font-medium">{formatInr(row.enginePaise)}</span>
      </button>
    </li>
  );
}
