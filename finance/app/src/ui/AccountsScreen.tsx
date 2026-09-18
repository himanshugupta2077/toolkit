import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { getAccounts, postAccount, type AccountPostBody } from "../api/store.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { AccountFormSheet } from "./AccountFormSheet.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import {
  accountFlags,
  formatBalanceHero,
  groupAccountRows,
  lastReconciledLabel,
} from "./accounts.ts";

function invalidateAccounts(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["accounts"] });
  void qc.invalidateQueries({ queryKey: ["account"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["month"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
  void qc.invalidateQueries({ queryKey: ["counts"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["plan"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
}

export function AccountsScreen() {
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [addOpen, setAddOpen] = useState(false);
  const [virtualOpen, setVirtualOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const listQ = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
    staleTime: 15_000,
  });

  const data = listQ.data;
  const sections = groupAccountRows(data?.accounts ?? []);
  const today = data?.today ?? "";

  async function onAdd(body: AccountPostBody) {
    setSaving(true);
    try {
      const res = await postAccount(body);
      onToast(`${res.account.name} added`);
      setAddOpen(false);
      await invalidateAccounts(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page">
      <div className="flex items-center gap-2">
        <Link
          to="/more"
          className="back-link btn-ghost"
        >
          ← More
        </Link>
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="page-title">Accounts</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-accent"
        >
          + Add
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        Balances are calculated. You cannot type one here.
      </p>

      {listQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading accounts…</p>
      ) : listQ.error ? (
        <FetchError error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : (
        <div className="mt-4 desk:grid desk:grid-cols-2 desk:gap-x-10 desk:gap-y-2">
          {sections.map((section) => {
            const collapsed = section.group === "virtual" && !virtualOpen;
            return (
              <section key={section.group} className="mb-5">
                {section.group === "virtual" ? (
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between kicker"
                    onClick={() => setVirtualOpen((open) => !open)}
                    aria-expanded={virtualOpen}
                  >
                    {section.label} · {section.accounts.length}
                    <span>{virtualOpen ? "Hide" : "Show"}</span>
                  </button>
                ) : (
                  <h2 className="kicker">
                    {section.label}
                  </h2>
                )}
                {collapsed ? null : (
                  <ul>
                    {section.accounts.map((row) => {
                      const hero = formatBalanceHero(row, row.balance);
                      const recon = lastReconciledLabel(row.lastReconciledAt, today);
                      const flags = accountFlags(row);
                      const bits = [
                        ...flags,
                        row.type !== "virtual" ? recon.text : null,
                      ].filter(Boolean);
                      return (
                        <li key={row.id}>
                          <Link
                            to={`/more/accounts/${row.id}`}
                            className={`flex min-h-14 items-center gap-3 py-2 ${
                              row.isArchived ? "opacity-60" : ""
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-base text-ink">
                                {row.name}
                                {row.isArchived ? " · archived" : ""}
                              </span>
                              <span
                                className={`block truncate text-xs ${
                                  recon.stale && row.type !== "virtual"
                                    ? "text-warn"
                                    : "text-muted"
                                }`}
                              >
                                {bits.join(" · ")}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-xs text-muted">{hero.label}</span>
                              <span className="block text-base font-medium tabular-nums text-ink">
                                {hero.amount}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <BottomSheet
        open={addOpen}
        title="Add account"
        onClose={() => setAddOpen(false)}
      >
        <AccountFormSheet
          mode="add"
          buckets={data?.buckets ?? []}
          today={data?.today}
          saving={saving}
          onSaveAdd={onAdd}
          onSaveEdit={() => undefined}
        />
      </BottomSheet>
    </section>
  );
}
