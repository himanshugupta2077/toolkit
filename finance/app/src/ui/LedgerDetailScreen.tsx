import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/http.ts";
import {
  deleteLedger,
  getLedgerEntry,
  getLedgerMonth,
  patchLedger,
  postLedger,
  type LedgerPostBody,
} from "../api/store.ts";
import { FetchError } from "./FetchError.tsx";
import {
  formatInr,
  nowTimeIst,
  todayIst,
  yearMonthFromIsoDate,
} from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { LedgerEditSheet } from "./LedgerEditSheet.tsx";
import {
  accountChip,
  amountClass,
  flowKind,
  formatMonthTitle,
  inBudgetExplainer,
  LEDGER_SOURCE_LABELS,
  LEDGER_TYPE_LABELS,
} from "./ledger.ts";

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function invalidateLedger(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["ledger"] });
  void qc.invalidateQueries({ queryKey: ["ledger-entry"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["month"] });
  void qc.invalidateQueries({ queryKey: ["counts"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
  void qc.invalidateQueries({ queryKey: ["accounts"] });
  void qc.invalidateQueries({ queryKey: ["account"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["plan"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
}

export function LedgerDetailScreen() {
  const { entryId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const detailQ = useQuery({
    queryKey: ["ledger-entry", entryId],
    queryFn: () => getLedgerEntry(entryId),
    enabled: entryId !== "",
  });

  const entry = detailQ.data?.entry;
  const accounts = detailQ.data?.accounts ?? [];
  const categories = detailQ.data?.categories ?? [];
  const today = detailQ.data?.today ?? todayIst();
  const month = entry ? yearMonthFromIsoDate(entry.date) : (params.get("month") ?? yearMonthFromIsoDate(today));
  const backTo = params.toString() ? `/ledger?${params.toString()}` : `/ledger?month=${month}`;

  const monthQ = useQuery({
    queryKey: ["ledger", month],
    queryFn: () => getLedgerMonth(month),
    enabled: Boolean(entry),
    staleTime: 15_000,
  });
  const monthEntries = monthQ.data?.entries ?? [];

  const from = accounts.find((row) => row.id === entry?.fromAccountId);
  const to = accounts.find((row) => row.id === entry?.toAccountId);
  const category = categories.find((row) => row.id === entry?.categoryId);

  async function onSave(body: LedgerPostBody) {
    if (!entry) return;
    setBusy(true);
    try {
      const data = await patchLedger(entry.id, body);
      onToast(`${formatInr(data.entry.amount)} · saved`);
      setEditOpen(false);
      await invalidateLedger(qc);
    } catch (err) {
      onToast("not saved");
      if (err instanceof ApiError && err.status === 400) {
        const body = err.body as { issues?: { message: string }[] } | null;
        if (body?.issues?.[0]?.message) onToast(body.issues[0].message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDuplicate() {
    if (!entry) return;
    setBusy(true);
    try {
      const data = await postLedger({
        date: today,
        time: nowTimeIst(),
        type: entry.type,
        amount: entry.amount,
        fromAccountId: entry.fromAccountId,
        toAccountId: entry.toAccountId,
        categoryId: entry.categoryId,
        inBudget: entry.inBudget,
        notes: entry.notes,
        source: "manual",
      });
      onToast(`Duplicated to today · ${formatInr(data.entry.amount)}`);
      await invalidateLedger(qc);
      navigate(`/ledger/${data.entry.id}?month=${yearMonthFromIsoDate(data.entry.date)}`);
    } catch {
      onToast("not saved");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!entry) return;
    setBusy(true);
    try {
      await deleteLedger(entry.id);
      onToast("Deleted");
      await invalidateLedger(qc);
      navigate(backTo);
    } catch {
      onToast("not deleted");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (detailQ.isPending) {
    return (
      <section className="page">
        <p className="text-sm text-muted">Loading this row…</p>
      </section>
    );
  }
  if (detailQ.error) {
    return (
      <section className="page">
        <Link to={backTo} className="btn-ghost">
          ← Ledger
        </Link>
        <FetchError error={detailQ.error} onRetry={() => void detailQ.refetch()} />
      </section>
    );
  }
  if (!entry) {
    return (
      <section className="page">
        <Link to={backTo} className="btn-ghost">
          ← Ledger
        </Link>
        <p className="mt-4 text-sm text-muted">This row is gone.</p>
      </section>
    );
  }

  const kind = flowKind(entry.type);

  return (
    <section className="page desk:max-w-2xl">
      <div className="flex items-center gap-2">
        <Link
          to={backTo}
          className="btn-ghost"
        >
          ← {formatMonthTitle(month)}
        </Link>
      </div>

      <p className={`mt-4 text-4xl font-semibold tracking-tight ${amountClass(kind)}`}>
        {formatInr(entry.amount)}
      </p>
      <p className="mt-1 text-base text-muted">{LEDGER_TYPE_LABELS[entry.type]}</p>

      <dl className="mt-6 space-y-3 text-base">
        <div>
          <dt className="kicker">From → To</dt>
          <dd className="text-ink">
            {from?.name ?? "From"} → {to?.name ?? "To"}
          </dd>
        </div>
        <div>
          <dt className="kicker">Category</dt>
          <dd className="flex items-center gap-2 text-ink">
            {category?.name ?? "—"}
            {entry.inBudget ? (
              <span className="inline-flex size-4 items-center justify-center rounded-sm border border-line text-[10px] font-semibold">
                B
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="kicker">Account</dt>
          <dd className="text-ink">{accountChip(entry, accounts)}</dd>
        </div>
        <div>
          <dt className="kicker">Date</dt>
          <dd className="text-ink">
            {entry.date}
            {entry.time ? ` · ${entry.time}` : ""}
          </dd>
        </div>
        <div>
          <dt className="kicker">Note</dt>
          <dd className="text-ink">{entry.notes.trim() || "—"}</dd>
        </div>
        <div>
          <dt className="kicker">In budget</dt>
          <dd className="text-ink">
            {entry.inBudget ? "Yes" : "No"}
            <span className="mt-1 block text-sm text-muted">
              {inBudgetExplainer(entry, category)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="kicker">Source</dt>
          <dd className="text-ink">{LEDGER_SOURCE_LABELS[entry.source]}</dd>
        </div>
        <div>
          <dt className="kicker">Recorded</dt>
          <dd className="text-sm text-muted">
            Created {formatStamp(entry.createdAt)}
            <br />
            Updated {formatStamp(entry.updatedAt)}
          </dd>
        </div>
      </dl>

      <p className="mt-6 text-xs text-muted">
        Account balances are calculated from the ledger. There is no balance field to type.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditOpen(true)}
          className="btn-primary"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDuplicate()}
          className="btn-secondary"
        >
          Duplicate
        </button>
      </div>

      {confirmDelete ? (
        <div className="card-danger mt-4 p-3">
          <p className="text-sm text-ink">Delete this row? Balances will move. This is a soft delete.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDelete()}
              className="btn-danger"
            >
              Delete row
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
              className="btn-quiet text-base"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
          className="btn-quiet mt-3 w-full text-danger"
        >
          Delete
        </button>
      )}

      <BottomSheet open={editOpen} title="Edit" onClose={() => setEditOpen(false)}>
        <LedgerEditSheet
          open={editOpen}
          entry={entry}
          today={today}
          accounts={accounts}
          categories={categories}
          entries={monthEntries}
          saving={busy}
          onSave={(body) => void onSave(body)}
        />
      </BottomSheet>
    </section>
  );
}
