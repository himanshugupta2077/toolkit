import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getAccounts, getWealth, postAccount, putBuckets } from "../api/store.ts";
import {
  DEFAULT_BUCKET_IDS,
  formatInr,
  todayIst,
} from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { apiErrorText } from "./copy.ts";
import {
  defaultHoldingName,
  EMERGENCY_KIND_LABELS,
  EMERGENCY_KINDS,
  emergencyHoldings,
  emergencyIncludeLiquid,
  groupEmergencyHoldings,
  isEmergencyKind,
  type EmergencyKind,
} from "./emergency.ts";
import { AmountField, FieldLabel, FormSelect } from "./formFields.tsx";
import { FetchError } from "./FetchError.tsx";
import { Amount } from "./Privacy.tsx";
import { amountPaise, EMPTY_AMOUNT, type AmountDraft } from "./quickAdd.ts";
import { BucketRing } from "./WealthScreen.tsx";
import {
  bucketHeroCaption,
  FILL_MODE_LABELS,
  formatFillPct,
  parseRupeesInput,
  rupeesInput,
  withEmergencyFundTarget,
} from "./wealth.ts";

function invalidateEmergency(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["accounts"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["portfolio"] });
  void qc.invalidateQueries({ queryKey: ["settings"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
}

function AddEmergencySheet({
  existingNames,
  saving,
  onSave,
}: {
  existingNames: readonly { name: string }[];
  saving: boolean;
  onSave: (kind: EmergencyKind, name: string, openingBalance: number) => void;
}) {
  const [kind, setKind] = useState<EmergencyKind>("savings");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState<AmountDraft>(EMPTY_AMOUNT);
  const canSave = name.trim() !== "" && !saving;

  function onKind(next: string) {
    if (!isEmergencyKind(next)) return;
    setKind(next);
    setName(defaultHoldingName(next, existingNames));
  }

  return (
    <div className="pb-4">
      <FormSelect
        label="Type"
        value={kind}
        onChange={onKind}
        options={EMERGENCY_KINDS.map((id) => ({
          value: id,
          label: EMERGENCY_KIND_LABELS[id],
        }))}
      />
      <label className="mt-3 block">
        <FieldLabel>Label</FieldLabel>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Label"
          placeholder={kind === "fd" ? "FD1" : "Name"}
          className="mt-1 field"
        />
      </label>
      <div className="mt-3">
        <AmountField label="Amount" amount={amount} onChange={setAmount} plus={false} />
      </div>
      <button
        type="button"
        disabled={!canSave}
        onClick={() => onSave(kind, name.trim(), amountPaise(amount))}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : "Add"}
      </button>
    </div>
  );
}

export function EmergencyFundScreen() {
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [addOpen, setAddOpen] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const wealthQ = useQuery({
    queryKey: ["wealth"],
    queryFn: getWealth,
    staleTime: 15_000,
  });
  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
    staleTime: 15_000,
  });
  const data = wealthQ.data;
  const bucket = data?.buckets.find((row) => row.id === DEFAULT_BUCKET_IDS.emergencyFund);
  const holdings = emergencyHoldings(bucket, [
    ...(accountsQ.data?.accounts ?? []),
    ...(data?.linkableAccounts ?? []),
  ]);
  const sections = groupEmergencyHoldings(holdings);
  const pctLabel = formatFillPct(bucket?.fillPct ?? null);
  const storedTarget = bucket?.targetAmount ?? bucket?.target ?? 0;
  const targetText = targetDraft ?? rupeesInput(storedTarget);
  const parsedTarget = parseRupeesInput(targetText);
  const canSaveTarget =
    parsedTarget != null && parsedTarget !== storedTarget && !savingTarget;

  async function onAdd(kind: EmergencyKind, name: string, openingBalance: number) {
    setSavingAdd(true);
    try {
      await postAccount({
        name,
        group: kind,
        openingBalance,
        openingDate: data?.today ?? todayIst(),
        includeNetWorth: true,
        includeLiquid: emergencyIncludeLiquid(kind),
        bucketId: DEFAULT_BUCKET_IDS.emergencyFund,
      });
      onToast(`${name} added`);
      setAddOpen(false);
      await invalidateEmergency(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSavingAdd(false);
    }
  }

  async function onSaveTarget() {
    if (!data || parsedTarget == null) return;
    setSavingTarget(true);
    try {
      await putBuckets(withEmergencyFundTarget(data.buckets, parsedTarget));
      setTargetDraft(null);
      onToast("Target saved");
      await invalidateEmergency(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSavingTarget(false);
    }
  }

  return (
    <section className="page">
      <Link to="/more" className="back-link btn-ghost desk:hidden">
        ← More
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h1 className="page-title">Emergency</h1>
        <button type="button" onClick={() => setAddOpen(true)} className="btn-ghost -mr-3">
          + Add
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">
        Savings, FDs, and invested money tagged here. The total is your emergency money.
      </p>

      {wealthQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading Emergency…</p>
      ) : wealthQ.error ? (
        <FetchError error={wealthQ.error} onRetry={() => void wealthQ.refetch()} />
      ) : !data || !bucket ? (
        <p className="mt-8 text-sm text-muted">Emergency Fund bucket is missing.</p>
      ) : (
        <div className="desk-stack mt-4">
          <article className="card p-4">
            <div className="flex items-start gap-3">
              <BucketRing
                fillPct={bucket.fillPct}
                colour={bucket.colour}
                label={`${bucket.name} ${pctLabel ?? "no target"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="kicker">Total emergency</p>
                <p className="hero-num">
                  <Amount>{formatInr(bucket.current)}</Amount>
                </p>
                <p className="mt-1 text-sm text-muted">
                  <Amount>{bucketHeroCaption(bucket)}</Amount>
                </p>
                <p className="mt-1 text-[13px] text-muted">{FILL_MODE_LABELS[bucket.fillMode]}</p>
              </div>
            </div>
          </article>

          <section className="card p-4">
            <label className="block">
              <span className="kicker">Target ₹</span>
              <input
                inputMode="decimal"
                aria-label="Emergency Fund target rupees"
                value={targetText}
                onChange={(e) => setTargetDraft(e.target.value)}
                className="field mt-1 tabular-nums"
              />
            </label>
            <button
              type="button"
              disabled={!canSaveTarget}
              onClick={() => void onSaveTarget()}
              className="mt-4 btn-primary w-full"
            >
              {savingTarget ? "Saving…" : "Save target"}
            </button>
          </section>

          <section className="desk:col-span-2">
            {sections.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                Nothing tagged yet. Add a savings account, FD, or invested amount.
              </p>
            ) : (
              sections.map((section) => (
                <div key={section.kind} className="mb-5 last:mb-0">
                  <h2 className="kicker">{section.label}</h2>
                  <ul className="card mt-2 divide-y divide-line">
                    {section.accounts.map((account) => (
                      <li key={account.id}>
                        <Link
                          to={`/more/accounts/${account.id}`}
                          className="flex min-h-11 items-center justify-between gap-3 px-4 py-2"
                        >
                          <span className="truncate text-base text-ink">{account.name}</span>
                          <Amount className="shrink-0 tabular-nums text-ink">
                            {formatInr(account.balance)}
                          </Amount>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </div>
      )}

      <BottomSheet open={addOpen} title="Add to emergency" onClose={() => setAddOpen(false)}>
        <AddEmergencySheet
          key={holdings.map((row) => row.name).join("|") ?? "add"}
          existingNames={holdings}
          saving={savingAdd}
          onSave={(kind, name, opening) => void onAdd(kind, name, opening)}
        />
      </BottomSheet>
    </section>
  );
}
