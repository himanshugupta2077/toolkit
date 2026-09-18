import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  getGoals,
  postGoal,
  putGoalOrder,
  type GoalWriteBody,
} from "../api/store.ts";
import { DEFAULT_BUCKET_IDS, formatInr, type GoalCard } from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { GoalFormSheet } from "./GoalFormSheet.tsx";
import {
  EMPTY_GOALS_HINT,
  FILL_TARGET_PROMPT,
  displayPill,
  goalFillPct,
  moveGoal,
  pillClass,
} from "./goals.ts";
import { ChevronDownIcon, ChevronUpIcon } from "./icons.tsx";
import { Amount } from "./Privacy.tsx";
import { BucketRing } from "./WealthScreen.tsx";

function invalidateGoals(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["goals"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
}

function GoalRow({
  row,
  isFirst,
  isLast,
  onMove,
}: {
  row: GoalCard;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const shown = displayPill(row);
  const fill = goalFillPct(row.funded, row.targetAmount);
  const targetText =
    row.targetAmount == null ? FILL_TARGET_PROMPT : formatInr(row.targetAmount);
  return (
    <article className="card p-4">
      <div className="flex items-start gap-3">
        <BucketRing
          fillPct={fill}
          label={`${row.name} ${fill == null ? "no target" : `${Math.round(fill * 100)}%`}`}
        />
        <div className="min-w-0 flex-1">
          <Link to={`/wealth/goals/${row.id}`} className="block">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-medium text-ink">{row.name}</h2>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${pillClass(shown.pill)}`}
              >
                {shown.label}
              </span>
            </div>
          </Link>
          <div className="mt-0.5 flex items-end justify-between gap-2">
            <Link to={`/wealth/goals/${row.id}`} className="min-w-0">
              <p className="text-sm text-muted">
                <Amount>
                  {row.needsTarget
                    ? FILL_TARGET_PROMPT
                    : `${formatInr(row.funded)} / ${targetText}`}
                </Amount>
              </p>
              {row.targetDate ? (
                <p className="mt-0.5 text-xs text-muted">By {row.targetDate}</p>
              ) : null}
              {row.status === "paused" ? (
                <p className="mt-1 text-xs text-muted">Paused</p>
              ) : null}
            </Link>
            <div className="flex shrink-0">
              <button
                type="button"
                aria-label={`Move ${row.name} up`}
                disabled={isFirst}
                onClick={() => onMove(-1)}
                className="icon-btn"
              >
                <ChevronUpIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${row.name} down`}
                disabled={isLast}
                onClick={() => onMove(1)}
                className="icon-btn"
              >
                <ChevronDownIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function GoalsScreen() {
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const goalsQ = useQuery({
    queryKey: ["goals"],
    queryFn: getGoals,
    staleTime: 15_000,
  });
  const data = goalsQ.data;
  const rows = data?.goals ?? [];

  async function onAdd(body: GoalWriteBody) {
    setSaving(true);
    try {
      await postGoal(body);
      onToast(`${body.name} added`);
      setAddOpen(false);
      await invalidateGoals(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onMove(id: string, dir: -1 | 1) {
    const next = moveGoal(rows, id, dir);
    if (next.every((row, i) => row.id === rows[i]?.id)) return;
    try {
      await putGoalOrder(next.map((row) => row.id));
      await invalidateGoals(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    }
  }

  return (
    <section className="page">
      <Link to="/wealth" className="back-link btn-ghost">
        ← Wealth
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Goals</h1>
          {data ? (
            <>
              <p className="mt-0.5 text-sm text-muted">
                <Amount>{formatInr(data.totalRemaining)} remaining</Amount>
              </p>
              <p className="mt-0.5 text-xs text-muted">{data.fundingNote}</p>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-accent"
        >
          + Add goal
        </button>
      </div>

      {goalsQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading goals…</p>
      ) : goalsQ.error ? (
        <FetchError error={goalsQ.error} onRetry={() => void goalsQ.refetch()} />
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{EMPTY_GOALS_HINT}</p>
      ) : (
        <div className="mt-4 space-y-3 desk:grid desk:grid-cols-3 desk:gap-5 desk:space-y-0">
          {rows.map((row, index) => (
            <GoalRow
              key={row.id}
              row={row}
              isFirst={index === 0}
              isLast={index === rows.length - 1}
              onMove={(dir) => void onMove(row.id, dir)}
            />
          ))}
        </div>
      )}

      <BottomSheet open={addOpen} title="Add goal" onClose={() => setAddOpen(false)}>
        <GoalFormSheet
          mode="add"
          buckets={data?.buckets ?? []}
          defaultBucketId={DEFAULT_BUCKET_IDS.savingsBuffer}
          saving={saving}
          onSaveAdd={(body) => void onAdd(body)}
          onSaveEdit={() => undefined}
        />
      </BottomSheet>
    </section>
  );
}
