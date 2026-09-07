import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getWealth, putBuckets, type WealthBucketCard } from "../api/store.ts";
import {
  FILL_MODES,
  runWaterfall,
  TARGET_RULES,
  validateBuckets,
  type FillMode,
  type TargetRule,
} from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { Amount } from "./Privacy.tsx";
import { BucketRing } from "./WealthScreen.tsx";
import {
  applyAccountToggle,
  bucketHeroCaption,
  exampleCaption,
  FILL_MODE_LABELS,
  moveBucket,
  parseRupeesInput,
  resolveDraftCards,
  rupeesInput,
  TARGET_RULE_LABELS,
  toBucketWrite,
} from "./wealth.ts";

function invalidateWealth(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["settings"] });
  void qc.invalidateQueries({ queryKey: ["accounts"] });
}

function patchBucket(
  list: WealthBucketCard[],
  id: string,
  patch: Partial<WealthBucketCard>,
): WealthBucketCard[] {
  return list.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

function FieldLabel({ children }: { children: string }) {
  return (
    <span className="kicker">{children}</span>
  );
}

function selectClass() {
  return "mt-1 field";
}

function BucketFields({
  bucket,
  linkable,
  onChange,
  onToggleAccount,
  onMove,
  isFirst,
  isLast,
}: {
  bucket: WealthBucketCard;
  linkable: { id: string; name: string }[];
  onChange: (patch: Partial<WealthBucketCard>) => void;
  onToggleAccount: (accountId: string, on: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <article className="card p-4">
      <div className="flex items-start gap-3">
        <BucketRing
          fillPct={bucket.fillPct}
          colour={bucket.colour}
          label={`${bucket.name} ${bucket.fillPct == null ? "no target" : "fill"}`}
        />
        <div className="min-w-0 flex-1">
          <label className="block">
            <FieldLabel>Name</FieldLabel>
            <input
              value={bucket.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="mt-1 field"
            />
          </label>
          <p className="mt-1 text-sm text-muted">
            <Amount>{bucketHeroCaption(bucket)}</Amount>
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={isFirst}
          onClick={() => onMove(-1)}
          className="btn-secondary flex-1 text-sm"
        >
          Up
        </button>
        <button
          type="button"
          disabled={isLast}
          onClick={() => onMove(1)}
          className="btn-secondary flex-1 text-sm"
        >
          Down
        </button>
      </div>

      <label className="mt-3 flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={bucket.active}
          onChange={(e) => onChange({ active: e.target.checked })}
        />
        <span className="text-sm text-ink">Active</span>
      </label>

      <label className="mt-3 block">
        <FieldLabel>Target rule</FieldLabel>
        <select
          value={bucket.targetRule}
          onChange={(e) => {
            const targetRule = e.target.value as TargetRule;
            onChange({
              targetRule,
              targetAmount: targetRule === "fixed" ? bucket.targetAmount : null,
              targetMonths: targetRule === "months_of_essentials" ? bucket.targetMonths : null,
            });
          }}
          className={selectClass()}
        >
          {TARGET_RULES.map((rule) => (
            <option key={rule} value={rule}>
              {TARGET_RULE_LABELS[rule]}
            </option>
          ))}
        </select>
      </label>

      {bucket.targetRule === "fixed" ? (
        <label className="mt-3 block">
          <FieldLabel>Target ₹</FieldLabel>
          <input
            inputMode="decimal"
            value={rupeesInput(bucket.targetAmount)}
            onChange={(e) => onChange({ targetAmount: parseRupeesInput(e.target.value) })}
            className="field mt-1 tabular-nums"
            aria-label={`${bucket.name} target rupees`}
          />
        </label>
      ) : null}

      {bucket.targetRule === "months_of_essentials" ? (
        <label className="mt-3 block">
          <FieldLabel>Months</FieldLabel>
          <input
            inputMode="numeric"
            value={bucket.targetMonths ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange({
                targetMonths:
                  e.target.value === "" || !Number.isInteger(n) || n < 1 ? null : n,
              });
            }}
            className="field mt-1 tabular-nums"
            aria-label={`${bucket.name} target months`}
          />
        </label>
      ) : null}

      <label className="mt-3 block">
        <FieldLabel>Fill mode</FieldLabel>
        <select
          value={bucket.fillMode}
          onChange={(e) => {
            const fillMode = e.target.value as FillMode;
            onChange({
              fillMode,
              fillValue: fillMode === "percent" || fillMode === "fixed" ? bucket.fillValue : null,
            });
          }}
          className={selectClass()}
        >
          {FILL_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {FILL_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>

      {bucket.fillMode === "percent" ? (
        <label className="mt-3 block">
          <FieldLabel>% of surplus</FieldLabel>
          <input
            inputMode="numeric"
            value={bucket.fillValue ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange({
                fillValue:
                  e.target.value === "" || !Number.isInteger(n) ? null : n,
              });
            }}
            className="field mt-1 tabular-nums"
            aria-label={`${bucket.name} percent of surplus`}
          />
        </label>
      ) : null}

      {bucket.fillMode === "fixed" ? (
        <label className="mt-3 block">
          <FieldLabel>Fill ₹</FieldLabel>
          <input
            inputMode="decimal"
            value={rupeesInput(bucket.fillValue)}
            onChange={(e) => onChange({ fillValue: parseRupeesInput(e.target.value) })}
            className="field mt-1 tabular-nums"
            aria-label={`${bucket.name} fill rupees`}
          />
        </label>
      ) : null}

      <label className="mt-3 block">
        <FieldLabel>Min monthly ₹</FieldLabel>
        <input
          inputMode="decimal"
          value={rupeesInput(bucket.minMonthly)}
          onChange={(e) => onChange({ minMonthly: parseRupeesInput(e.target.value) })}
          className="field mt-1 tabular-nums"
          aria-label={`${bucket.name} min monthly rupees`}
        />
        <span className="mt-1 block text-xs text-muted">Stored; the waterfall does not apply it yet.</span>
      </label>

      <fieldset className="mt-3">
        <legend className="kicker">
          Linked accounts
        </legend>
        <ul className="mt-2 space-y-1">
          {linkable.map((account) => {
            const checked = bucket.accountIds.includes(account.id);
            return (
              <li key={account.id}>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onToggleAccount(account.id, e.target.checked)}
                  />
                  <span className="text-sm text-ink">{account.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <label className="mt-3 block">
        <FieldLabel>Notes</FieldLabel>
        <textarea
          value={bucket.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          rows={2}
          className="field mt-1 py-2"
        />
      </label>
    </article>
  );
}

export function BucketEditorScreen() {
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const wealthQ = useQuery({
    queryKey: ["wealth"],
    queryFn: getWealth,
    staleTime: 15_000,
  });
  const [draft, setDraft] = useState<WealthBucketCard[] | null>(null);
  const [saving, setSaving] = useState(false);
  const source = draft ?? wealthQ.data?.buckets ?? null;

  const essentialsAverage = wealthQ.data?.essentialsAverage ?? 0;
  const surplus = wealthQ.data?.free ?? 0;
  const resolved = useMemo(
    () => (source ? resolveDraftCards(source, essentialsAverage) : []),
    [source, essentialsAverage],
  );
  const checked = validateBuckets(resolved);
  const preview = useMemo(() => {
    if (!checked.ok) return null;
    try {
      const current: Record<string, number> = {};
      for (const bucket of resolved) current[bucket.id] = bucket.current;
      return runWaterfall(surplus, resolved, current, essentialsAverage);
    } catch {
      return null;
    }
  }, [checked.ok, essentialsAverage, resolved, surplus]);

  function baseRows(): WealthBucketCard[] {
    return draft ?? wealthQ.data?.buckets ?? [];
  }

  function onChange(id: string, patch: Partial<WealthBucketCard>) {
    setDraft(patchBucket(baseRows(), id, patch));
  }

  async function onSave() {
    if (!source || !checked.ok) return;
    setSaving(true);
    try {
      const res = await putBuckets(resolved.map(toBucketWrite));
      setDraft(res.buckets);
      onToast("Bucket rules saved");
      await invalidateWealth(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

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
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Bucket rules</h1>
      <p className="mt-1 text-sm text-muted">
        Changing a target does not post a ledger row. Confirm transfers on Allocate.
      </p>

      {wealthQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading buckets…</p>
      ) : wealthQ.error ? (
        <FetchError error={wealthQ.error} onRetry={() => void wealthQ.refetch()} />
      ) : wealthQ.data && source ? (
        <>
          <div className="mt-4 card p-4">
            <p className="text-sm text-ink">
              {preview
                ? exampleCaption(preview.surplus, preview.lines)
                : "Fix the rules below to see today’s split."}
            </p>
            {!checked.ok ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
                {checked.issues.map((row) => (
                  <li key={`${row.field}-${row.code}`}>{row.message}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mt-3 space-y-3">
            {resolved.map((bucket, index) => (
              <BucketFields
                key={bucket.id}
                bucket={bucket}
                linkable={wealthQ.data.linkableAccounts.map((row) => ({
                  id: row.id,
                  name: row.name,
                }))}
                isFirst={index === 0}
                isLast={index === resolved.length - 1}
                onMove={(dir) => setDraft(moveBucket(baseRows(), bucket.id, dir))}
                onChange={(patch) => onChange(bucket.id, patch)}
                onToggleAccount={(accountId, on) =>
                  setDraft(applyAccountToggle(baseRows(), bucket.id, accountId, on))
                }
              />
            ))}
          </div>

          <button
            type="button"
            disabled={saving || !checked.ok}
            onClick={() => void onSave()}
            className="mt-4 btn-primary w-full"
          >
            {saving ? "Saving…" : "Save rules"}
          </button>
        </>
      ) : null}
    </section>
  );
}
