import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  getGoals,
  patchGoal,
  postGoalContribute,
  type GoalPatchBody,
} from "../api/store.ts";
import { formatInr, todayIst, type GoalContribution } from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import { GoalFormSheet } from "./GoalFormSheet.tsx";
import {
  FILL_TARGET_PROMPT,
  displayPill,
  fundNowAmount,
  fundTodayWhyFor,
  pillClass,
} from "./goals.ts";
import { Amount } from "./Privacy.tsx";
import { parseRupeesInput } from "./wealth.ts";

function invalidateGoals(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["goals"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["ledger"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
}

function contribCaption(row: GoalContribution): string {
  const via = row.ledgerEntryId ? " · ledger" : "";
  const note = row.note ? ` · ${row.note}` : "";
  return `${row.date}${via}${note}`;
}

export function GoalDetailScreen() {
  const { goalId = "" } = useParams();
  const qc = useQueryClient();
  const { onToast, openQuickAdd } = useOutletContext<AppShellOutlet>();
  const [editOpen, setEditOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualDate, setManualDate] = useState(todayIst());

  const goalsQ = useQuery({
    queryKey: ["goals"],
    queryFn: getGoals,
    staleTime: 15_000,
  });
  const data = goalsQ.data;
  const card = data?.goals.find((row) => row.id === goalId);
  const contribs = (data?.contributions ?? []).filter((row) => row.goalId === goalId);
  const shown = card ? displayPill(card) : null;
  const achieved = shown?.pill === "achieved";
  const why = card && data ? fundTodayWhyFor(card, data.goals, data.buckets) : "";

  async function onEdit(body: GoalPatchBody) {
    if (!card) return;
    setSaving(true);
    try {
      await patchGoal(card.id, body);
      onToast("Saved");
      setEditOpen(false);
      await invalidateGoals(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onStatus(status: "paused" | "achieved" | "active") {
    if (!card) return;
    try {
      await patchGoal(card.id, { status });
      onToast(status === "paused" ? "Paused" : status === "achieved" ? "Achieved" : "Resumed");
      await invalidateGoals(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    }
  }

  async function onManual() {
    if (!card) return;
    const amount = parseRupeesInput(manualAmount);
    if (amount == null || amount <= 0) {
      onToast("Enter a positive amount.");
      return;
    }
    if (manualNote.trim() === "") {
      onToast("A note is required when there is no bank move.");
      return;
    }
    setSaving(true);
    try {
      await postGoalContribute(card.id, {
        date: manualDate,
        amount,
        note: manualNote.trim(),
      });
      onToast("Contribution saved");
      setManualOpen(false);
      setManualAmount("");
      setManualNote("");
      await invalidateGoals(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  function onFundNow() {
    if (!card) return;
    const amount = fundNowAmount(card);
    openQuickAdd({
      type: "transfer",
      amount: amount > 0 ? amount : undefined,
      notes: `Goal: ${card.name}`,
      goalId: card.id,
      goalName: card.name,
    });
  }

  const remainingHero =
    card == null
      ? ""
      : card.needsTarget
        ? "No target yet"
        : card.remaining != null && card.remaining <= 0
          ? formatInr(0)
          : formatInr(card.remaining ?? 0);

  return (
    <section className="px-5 pb-8">
      <Link
        to="/wealth/goals"
        className="btn-ghost"
      >
        ← Goals
      </Link>

      {goalsQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading goal…</p>
      ) : goalsQ.error ? (
        <FetchError error={goalsQ.error} onRetry={() => void goalsQ.refetch()} />
      ) : !card ? (
        <p className="mt-8 text-sm text-muted">Goal not found.</p>
      ) : (
        <>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{card.name}</h1>
              {shown ? (
                <span
                  className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${pillClass(shown.pill)}`}
                >
                  {shown.label}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-accent"
            >
              Edit
            </button>
          </div>

          <div className="mt-4 card p-4">
            <p className="kicker">Remaining</p>
            <p className="mt-1 hero-num text-ink">
              <Amount>{remainingHero}</Amount>
            </p>
            {card.needsTarget ? (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="mt-2 text-sm font-medium text-accent"
              >
                {FILL_TARGET_PROMPT}
              </button>
            ) : (
              <p className="mt-1 text-sm text-muted">
                <Amount>
                  {formatInr(card.funded)} of {formatInr(card.targetAmount ?? 0)}
                </Amount>
              </p>
            )}
          </div>

          <div className="mt-3 card p-4">
            <p className="kicker">
              You could fund this today
            </p>
            <p className="mt-1 text-sm text-ink">{why}</p>
          </div>

          {!achieved ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onFundNow}
                className="min-h-11 rounded-full bg-accent text-sm font-medium text-accent-fg"
              >
                Fund now
              </button>
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="min-h-11 rounded-full border border-line text-sm font-medium text-ink"
              >
                Add contribution
              </button>
            </div>
          ) : null}

          <div className="mt-6">
            <h2 className="kicker">
              Contributions
            </h2>
            {contribs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {contribs.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{contribCaption(row)}</p>
                    </div>
                    <Amount className="shrink-0 text-sm font-medium tabular-nums text-ink">
                      {formatInr(row.amount)}
                    </Amount>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 space-y-2">
            {card.status === "paused" ? (
              <button
                type="button"
                onClick={() => void onStatus("active")}
                className="min-h-11 w-full rounded-xl border border-line text-sm font-medium text-ink"
              >
                Resume
              </button>
            ) : !achieved ? (
              <button
                type="button"
                onClick={() => void onStatus("paused")}
                className="min-h-11 w-full rounded-xl border border-line text-sm font-medium text-ink"
              >
                Pause
              </button>
            ) : null}
            {!achieved ? (
              <button
                type="button"
                onClick={() => void onStatus("achieved")}
                className="min-h-11 w-full rounded-xl border border-line text-sm font-medium text-ink"
              >
                Mark achieved
              </button>
            ) : null}
          </div>
        </>
      )}

      <BottomSheet open={editOpen} title="Edit goal" onClose={() => setEditOpen(false)}>
        {card ? (
          <GoalFormSheet
            mode="edit"
            goal={card}
            buckets={data?.buckets ?? []}
            defaultBucketId={card.fundingBucketId}
            saving={saving}
            onSaveAdd={() => undefined}
            onSaveEdit={(body) => void onEdit(body)}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={manualOpen}
        title="Add contribution"
        onClose={() => setManualOpen(false)}
      >
        <div className="pb-4">
          <p className="text-sm text-muted">
            No bank move — just earmark savings. A note is required.
          </p>
          <label className="mt-4 block">
            <span className="kicker">Amount ₹</span>
            <input
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Amount rupees"
              className="mt-1 field"
            />
          </label>
          <label className="mt-4 block">
            <span className="kicker">Date</span>
            <input
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              className="mt-1 field"
            />
          </label>
          <label className="mt-4 block">
            <span className="kicker">Note</span>
            <textarea
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              rows={3}
              aria-label="Note"
              className="field mt-1 py-2"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onManual()}
            className="mt-4 btn-primary w-full rounded-full text-sm"
          >
            {saving ? "Saving…" : "Save contribution"}
          </button>
        </div>
      </BottomSheet>
    </section>
  );
}
