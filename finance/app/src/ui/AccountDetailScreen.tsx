import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { getAccount, patchAccount, type AccountPatchBody } from "../api/store.ts";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { formatInr, yearMonthFromIsoDate } from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { AccountFormSheet } from "./AccountFormSheet.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import {
  accountFlags,
  formatBalanceHero,
  formatUtilisation,
  lastReconciledLabel,
} from "./accounts.ts";
import {
  accountChip,
  amountClass,
  categoryInitial,
  flowKind,
  formatMonthTitle,
  rowTitle,
} from "./ledger.ts";

function invalidateAccounts(qc: ReturnType<typeof useQueryClient>) {
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

export function AccountDetailScreen() {
  const { accountId = "" } = useParams();
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [saving, setSaving] = useState(false);

  const detailQ = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getAccount(accountId),
    enabled: accountId !== "",
  });

  const data = detailQ.data;
  const account = data?.account;
  const today = data?.today ?? "";

  async function onSave(body: AccountPatchBody) {
    if (!account) return;
    setSaving(true);
    try {
      await patchAccount(account.id, body);
      onToast("Saved");
      setEditOpen(false);
      await invalidateAccounts(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onArchive(next: boolean) {
    if (!account) return;
    setSaving(true);
    try {
      await patchAccount(account.id, { isArchived: next });
      onToast(next ? "Archived" : "Restored");
      setConfirmArchive(false);
      await invalidateAccounts(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  if (detailQ.isPending) {
    return (
      <section className="px-5">
        <p className="text-sm text-muted">Loading account…</p>
      </section>
    );
  }
  if (detailQ.error) {
    return (
      <section className="px-5">
        <Link to="/more/accounts" className="btn-ghost">
          ← Accounts
        </Link>
        <FetchError error={detailQ.error} onRetry={() => void detailQ.refetch()} />
      </section>
    );
  }
  if (!account || !data) {
    return (
      <section className="px-5">
        <Link to="/more/accounts" className="btn-ghost">
          ← Accounts
        </Link>
        <p className="mt-4 text-sm text-muted">Account not found.</p>
      </section>
    );
  }

  const hero = formatBalanceHero(account, data.balance);
  const recon = lastReconciledLabel(data.lastReconciledAt, today);
  const flags = accountFlags(account);
  const util = formatUtilisation(data.utilisation);
  const ledgerMonth = yearMonthFromIsoDate(today);
  const ledgerHref = `/ledger?month=${ledgerMonth}&account=${account.id}`;

  return (
    <section className="px-5 pb-8">
      <Link
        to="/more/accounts"
        className="btn-ghost"
      >
        ← Accounts
      </Link>

      <p className="mt-2 text-sm text-muted">{account.name}</p>
      <p className="kicker">{hero.label}</p>
      <p className="text-4xl font-semibold tracking-tight tabular-nums text-ink">{hero.amount}</p>
      <p className="mt-2 text-sm text-muted">
        {flags.join(" · ")}
        {account.isArchived ? " · archived" : ""}
      </p>
      <p className="mt-1 text-xs text-muted">
        Opening {formatInr(account.openingBalance)} on {account.openingDate}. Calculated from
        the ledger — there is no balance field to type.
      </p>

      {account.group === "credit_card" ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="card p-3">
            <p className="text-xs text-muted">Limit</p>
            <p className="text-base font-medium tabular-nums">
              {account.creditLimit == null ? "—" : formatInr(account.creditLimit)}
            </p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-muted">Available</p>
            <p className="text-base font-medium tabular-nums">
              {data.available == null ? "—" : formatInr(data.available)}
            </p>
            {util ? <p className="text-xs text-muted">{util} used</p> : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4 card p-3">
        <p className="text-xs text-muted">This cycle spend</p>
        <p className="text-base font-medium tabular-nums">{formatInr(data.cycleSpent)}</p>
        <p className="text-xs text-muted">Since {data.cycleStart}</p>
      </div>

      {data.canReconcile ? (
        <div className="mt-4">
          <p
            className={`text-sm ${
              recon.stale ? "text-warn" : "text-muted"
            }`}
          >
            {recon.text}
          </p>
          <Link
            to={`/more/accounts/${account.id}/reconcile`}
            className="mt-2 flex min-h-11 items-center justify-center rounded-xl bg-accent text-base font-medium text-accent-fg"
          >
            Reconcile
          </Link>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="btn-secondary"
        >
          Edit
        </button>
        {data.canArchive ? (
          <button
            type="button"
            onClick={() => {
              if (account.isArchived) void onArchive(false);
              else setConfirmArchive(true);
            }}
            className="btn-secondary"
          >
            {account.isArchived ? "Unarchive" : "Archive"}
          </button>
        ) : null}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="kicker">Ledger</h2>
        <Link to={ledgerHref} className="btn-ghost">
          Open in Ledger
        </Link>
      </div>
      {data.entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No rows yet on this account.</p>
      ) : (
        <ul className="mt-2">
          {data.entries.map((entry) => {
            const kind = flowKind(entry.type);
            const title = rowTitle(entry, data.categories);
            const category = data.categories.find((row) => row.id === entry.categoryId);
            return (
              <li key={entry.id}>
                <Link
                  to={`/ledger/${entry.id}?month=${yearMonthFromIsoDate(entry.date)}`}
                  className="flex min-h-11 items-center gap-3 py-2"
                >
                  <span
                    aria-hidden="true"
                    className="avatar"
                  >
                    {categoryInitial(category?.name ?? title)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{title}</span>
                    <span className="block truncate text-xs text-muted">
                      {formatMonthTitle(yearMonthFromIsoDate(entry.date))} ·{" "}
                      {accountChip(entry, data.accounts)}
                    </span>
                  </span>
                  <span className={`shrink-0 text-base font-medium tabular-nums ${amountClass(kind)}`}>
                    {formatInr(entry.amount)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <BottomSheet open={editOpen} title="Edit account" tall onClose={() => setEditOpen(false)}>
        <AccountFormSheet
          key={account.id}
          mode="edit"
          account={account}
          buckets={data.buckets}
          today={today}
          saving={saving}
          onSaveAdd={() => undefined}
          onSaveEdit={onSave}
        />
      </BottomSheet>

      <BottomSheet
        open={confirmArchive}
        title="Archive account"
        onClose={() => setConfirmArchive(false)}
      >
        <p className="text-base text-ink">
          Archive {account.name}? Old ledger rows stay. Accounts with history cannot be
          deleted.
        </p>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onArchive(true)}
          className="mt-4 btn-primary w-full"
        >
          Archive
        </button>
      </BottomSheet>
    </section>
  );
}
