import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import {
  getPlan,
  patchInflow,
  patchOneTime,
  patchRecurring,
  postInflow,
  postOneTime,
  postRecurring,
  putBudget,
  type InflowWriteBody,
  type OneTimeWriteBody,
  type PlanResponse,
  type RecurringWriteBody,
} from "../api/store.ts";
import {
  addMonths,
  formatInr,
  todayIst,
  yearMonthFromIsoDate,
  type ForecastMonth,
  type OneTimePlan,
  type PaceBand,
  type RecurringKind,
  type RecurringPlan,
  type YearMonth,
} from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { formatPct, stackedMonthBars } from "./home.ts";
import { formatMonthShort, formatMonthTitle } from "./ledger.ts";
import {
  BudgetCapSheet,
  InflowFormSheet,
  OneTimeFormSheet,
  RecurringFormSheet,
} from "./PlanFormSheets.tsx";
import {
  accountName,
  addMonthClamped,
  categoryBarWidth,
  chipClass,
  frequencyLabel,
  INFLOW_STATUS_LABELS,
  inflowsSorted,
  kindLabel,
  nextDueLabel,
  ONE_TIME_STATUS_LABELS,
  oneTimeSorted,
  paceDotClass,
  parsePlanSearchParams,
  planSearchParams,
  PLAN_TAB_LABELS,
  PLAN_TABS,
  PRIORITY_LABELS,
  RECURRING_FILTER_LABELS,
  RECURRING_FILTERS,
  RECURRING_KIND_LABELS,
  recurringSections,
  type RecurringFilter,
} from "./plan.ts";

function invalidatePlan(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["plan"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["month"] });
  void qc.invalidateQueries({ queryKey: ["counts"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
}

function bandFill(band: PaceBand): string {
  if (band === "on_track") return "bg-ok";
  if (band === "watch") return "bg-warn";
  return "bg-danger";
}

function PaceBar({
  usedPct,
  elapsedPct,
  band,
}: {
  usedPct: number;
  elapsedPct: number;
  band: PaceBand;
}) {
  const used = Math.min(100, Math.max(0, usedPct * 100));
  const elapsed = Math.min(100, Math.max(0, elapsedPct * 100));
  return (
    <div className="relative mt-3 h-2 w-full rounded-full bg-card-2">
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${bandFill(band)}`}
        style={{ width: `${used}%` }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-ink"
        style={{ left: `${elapsed}%` }}
      />
    </div>
  );
}

export function PlanScreen() {
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [params, setParams] = useSearchParams();
  const today = todayIst();
  const todayMonth = yearMonthFromIsoDate(today);
  const search = parsePlanSearchParams(params, todayMonth);
  const { tab, month, assumeInflows } = search;

  const [saving, setSaving] = useState(false);
  const [capOpen, setCapOpen] = useState(false);
  const [recurringFilter, setRecurringFilter] = useState<RecurringFilter>("all");
  const [oneStatus, setOneStatus] = useState<"planned" | "completed" | "cancelled">("planned");
  const [inflowStatus, setInflowStatus] = useState<"expected" | "received" | "dropped">("expected");
  const [recurringEdit, setRecurringEdit] = useState<RecurringPlan | "new" | null>(null);
  const [oneTimeEdit, setOneTimeEdit] = useState<OneTimePlan | "new" | null>(null);
  const [inflowEdit, setInflowEdit] = useState<PlanResponse["inflows"][number] | "new" | null>(null);
  const [forecastKind, setForecastKind] = useState<{
    month: YearMonth;
    kind: RecurringKind;
  } | null>(null);

  const planQ = useQuery({
    queryKey: ["plan", month, assumeInflows],
    queryFn: () => getPlan(month, assumeInflows),
    staleTime: 15_000,
  });
  const data = planQ.data;

  function write(next: Partial<typeof search>) {
    setParams(planSearchParams({ ...search, ...next }), { replace: true });
  }

  async function afterWrite(_res: PlanResponse, toast: string) {
    onToast(toast);
    await invalidatePlan(qc);
  }

  async function onSaveCap(cap: number, applyToFuture: boolean) {
    setSaving(true);
    try {
      const res = await putBudget(month, { cap, applyToFuture });
      setCapOpen(false);
      await afterWrite(res, `Cap ${formatInr(cap)}`);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onSaveRecurring(body: RecurringWriteBody) {
    setSaving(true);
    try {
      const res =
        recurringEdit && recurringEdit !== "new"
          ? await patchRecurring(recurringEdit.id, body)
          : await postRecurring(body);
      setRecurringEdit(null);
      await afterWrite(res, recurringEdit === "new" ? "Recurring added" : "Recurring saved");
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleRecurring(plan: RecurringPlan, active: boolean) {
    try {
      const res = await patchRecurring(plan.id, { active });
      await afterWrite(res, active ? `${plan.name} on` : `${plan.name} off`);
    } catch (err) {
      onToast(apiErrorText(err));
    }
  }

  async function onSaveOneTime(body: OneTimeWriteBody) {
    setSaving(true);
    try {
      const res =
        oneTimeEdit && oneTimeEdit !== "new"
          ? await patchOneTime(oneTimeEdit.id, body)
          : await postOneTime(body);
      setOneTimeEdit(null);
      await afterWrite(res, oneTimeEdit === "new" ? "One-time added" : "One-time saved");
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onCompleteOneTime(plan: OneTimePlan) {
    try {
      const res = await patchOneTime(plan.id, { status: "completed" });
      await afterWrite(res, `${plan.name} completed — no ledger row`);
    } catch (err) {
      onToast(apiErrorText(err));
    }
  }

  async function onCancelOneTime(plan: OneTimePlan) {
    try {
      const res = await patchOneTime(plan.id, { status: "cancelled" });
      await afterWrite(res, `${plan.name} cancelled`);
    } catch (err) {
      onToast(apiErrorText(err));
    }
  }

  async function onSaveInflow(body: InflowWriteBody) {
    setSaving(true);
    try {
      const res =
        inflowEdit && inflowEdit !== "new"
          ? await patchInflow(inflowEdit.id, body)
          : await postInflow(body);
      setInflowEdit(null);
      await afterWrite(res, inflowEdit === "new" ? "Inflow added" : "Inflow saved");
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  const forecastLines = useMemo(() => {
    if (!data || !forecastKind) return [];
    return data.forecast.months
      .find((row) => row.month === forecastKind.month)
      ?.lines.filter((line) => line.kind === forecastKind.kind) ?? [];
  }, [data, forecastKind]);

  return (
    <section className="px-5 pb-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Plan</h1>
      <p className="mt-1 text-sm text-muted">Planning never posts to the ledger.</p>

      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
        {PLAN_TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={chipClass(tab === id)}
            onClick={() => write({ tab: id })}
          >
            {PLAN_TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {planQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading Plan…</p>
      ) : planQ.error ? (
        <FetchError error={planQ.error} onRetry={() => void planQ.refetch()} />
      ) : data ? (
        <>
          {tab === "budget" ? (
            <BudgetPanel
              data={data}
              month={month as YearMonth}
              todayMonth={todayMonth}
              onMonth={(next) => write({ month: next })}
              onEditCap={() => setCapOpen(true)}
            />
          ) : null}
          {tab === "recurring" ? (
            <RecurringPanel
              data={data}
              filter={recurringFilter}
              onFilter={setRecurringFilter}
              onAdd={() => setRecurringEdit("new")}
              onEdit={setRecurringEdit}
              onToggle={onToggleRecurring}
            />
          ) : null}
          {tab === "one-time" ? (
            <OneTimePanel
              data={data}
              status={oneStatus}
              onStatus={setOneStatus}
              onAdd={() => setOneTimeEdit("new")}
              onEdit={setOneTimeEdit}
              onComplete={onCompleteOneTime}
              onCancel={onCancelOneTime}
            />
          ) : null}
          {tab === "inflows" ? (
            <InflowsPanel
              data={data}
              status={inflowStatus}
              onStatus={setInflowStatus}
              onAdd={() => setInflowEdit("new")}
              onEdit={setInflowEdit}
            />
          ) : null}
          {tab === "forecast" ? (
            <ForecastPanel
              data={data}
              assumeInflows={assumeInflows}
              onAssume={(next) => write({ assumeInflows: next, tab: "forecast" })}
              onKind={(m, kind) => setForecastKind({ month: m, kind })}
            />
          ) : null}
        </>
      ) : null}

      <BottomSheet open={capOpen} title="Budget cap" tall onClose={() => setCapOpen(false)}>
        {data ? (
          <BudgetCapSheet cap={data.pace.cap} saving={saving} onSave={onSaveCap} />
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={recurringEdit != null}
        title={recurringEdit === "new" ? "Add recurring" : "Edit recurring"}
        tall
        onClose={() => setRecurringEdit(null)}
      >
        {data ? (
          <RecurringFormSheet
            key={recurringEdit === "new" || recurringEdit == null ? "new" : recurringEdit.id}
            mode={recurringEdit === "new" ? "add" : "edit"}
            plan={recurringEdit && recurringEdit !== "new" ? recurringEdit : undefined}
            categories={data.categories}
            accounts={data.accounts}
            today={data.today}
            saving={saving}
            onSave={onSaveRecurring}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={oneTimeEdit != null}
        title={oneTimeEdit === "new" ? "Add one-time" : "Edit one-time"}
        tall
        onClose={() => setOneTimeEdit(null)}
      >
        {data ? (
          <OneTimeFormSheet
            key={oneTimeEdit === "new" || oneTimeEdit == null ? "new" : oneTimeEdit.id}
            mode={oneTimeEdit === "new" ? "add" : "edit"}
            plan={oneTimeEdit && oneTimeEdit !== "new" ? oneTimeEdit : undefined}
            categories={data.categories}
            accounts={data.accounts}
            today={data.today}
            saving={saving}
            onSave={onSaveOneTime}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={inflowEdit != null}
        title={inflowEdit === "new" ? "Add inflow" : "Edit inflow"}
        tall
        onClose={() => setInflowEdit(null)}
      >
        {data ? (
          <InflowFormSheet
            key={inflowEdit === "new" || inflowEdit == null ? "new" : inflowEdit.id}
            mode={inflowEdit === "new" ? "add" : "edit"}
            inflow={inflowEdit && inflowEdit !== "new" ? inflowEdit : undefined}
            categories={data.categories}
            today={data.today}
            saving={saving}
            onSave={onSaveInflow}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={forecastKind != null}
        title={
          forecastKind
            ? `${RECURRING_KIND_LABELS[forecastKind.kind]} · ${formatMonthTitle(forecastKind.month)}`
            : "Rows"
        }
        onClose={() => setForecastKind(null)}
      >
        {forecastLines.length === 0 ? (
          <p className="pb-4 text-sm text-muted">No rows make up this kind in that month.</p>
        ) : (
          <ul className="divide-y divide-line pb-4">
            {forecastLines.map((line) => (
              <li key={line.planId} className="flex min-h-11 items-center justify-between gap-3 py-2">
                <span className="truncate text-base text-ink">{line.name}</span>
                <span className="shrink-0 tabular-nums text-ink">{formatInr(line.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
    </section>
  );
}

function BudgetPanel({
  data,
  month,
  todayMonth,
  onMonth,
  onEditCap,
}: {
  data: PlanResponse;
  month: YearMonth;
  todayMonth: YearMonth;
  onMonth: (month: YearMonth) => void;
  onEditCap: () => void;
}) {
  const min = addMonths(todayMonth, -11);
  const max = addMonths(todayMonth, 6);
  const maxSpend = Math.max(0, ...data.paceByCategory.map((row) => row.spent));

  return (
    <div className="mt-4">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous month"
          disabled={month <= min}
          className="icon-btn text-lg"
          onClick={() => onMonth(addMonthClamped(month, -1, todayMonth))}
        >
          ←
        </button>
        <h2 className="flex-1 text-center text-lg font-semibold text-ink">
          {formatMonthTitle(month)}
        </h2>
        <button
          type="button"
          aria-label="Next month"
          disabled={month >= max}
          className="icon-btn text-lg"
          onClick={() => onMonth(addMonthClamped(month, 1, todayMonth))}
        >
          →
        </button>
      </div>

      <div className="mt-3 card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="kicker">Cap</p>
            <p className="hero-num mt-1.5">
              {formatInr(data.pace.cap)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Edit cap"
            onClick={onEditCap}
            className="btn-ghost -mr-3 -mt-2"
          >
            Edit
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          Spent {formatInr(data.pace.spent)} · Remaining {formatInr(data.pace.remaining)} · Used{" "}
          {formatPct(data.pace.usedPct)} · Month {formatPct(data.pace.elapsedPct)} elapsed
        </p>
        <PaceBar usedPct={data.pace.usedPct} elapsedPct={data.pace.elapsedPct} band={data.pace.band} />
      </div>

      <h3 className="mt-5 text-sm font-semibold text-ink">Spend by category</h3>
      {data.paceByCategory.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No in-budget spend this month.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {data.paceByCategory.map((row) => (
            <li key={row.categoryId}>
              <Link
                to={`/ledger?${new URLSearchParams({
                  month,
                  category: row.categoryId,
                  inBudget: "1",
                }).toString()}`}
                className="block"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-ink">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-ink">{formatInr(row.spent)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-card-2">
                  <div
                    className="h-full rounded-full bg-seg-emi"
                    style={{ width: `${Math.round(categoryBarWidth(row.spent, maxSpend) * 100)}%` }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 text-sm font-semibold text-ink">Months</h3>
      <ul className="mt-2 divide-y divide-line">
        {data.budgetMonths.map((row) => (
          <li key={row.month}>
            <button
              type="button"
              onClick={() => onMonth(row.month)}
              className={`-mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left text-ink transition-colors active:bg-card-2 ${
                row.month === month ? "bg-accent-soft font-medium" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${paceDotClass(row.band)}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-base">{formatMonthTitle(row.month)}</span>
                <span className="block text-xs text-muted">
                  Cap {formatInr(row.cap)} · In {formatInr(row.income)} · Exp{" "}
                  {formatInr(row.budgetSpent)}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums">
                {formatInr(row.estSavings)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecurringPanel({
  data,
  filter,
  onFilter,
  onAdd,
  onEdit,
  onToggle,
}: {
  data: PlanResponse;
  filter: RecurringFilter;
  onFilter: (filter: RecurringFilter) => void;
  onAdd: () => void;
  onEdit: (plan: RecurringPlan) => void;
  onToggle: (plan: RecurringPlan, active: boolean) => void;
}) {
  const sections = recurringSections(data.recurring, filter, data.today, data.categories);

  return (
    <div className="mt-4">
      <div className="card p-4">
        <p className="kicker">
          Monthly fixed cost
        </p>
        <p className="hero-num mt-1.5">
          {formatInr(data.recurringHeader.monthlyFixed)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {data.recurringHeader.activeCount} active · Yearly commitments{" "}
          {formatInr(data.recurringHeader.yearlyCommitments)}
        </p>
      </div>

      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
        {RECURRING_FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            className={chipClass(filter === id)}
            onClick={() => onFilter(id)}
          >
            {RECURRING_FILTER_LABELS[id]}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="mt-3 btn-secondary w-full text-sm"
      >
        + Add recurring
      </button>

      {sections.live.length === 0 && sections.ended.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No recurring plans in this filter.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {sections.live.map((plan) => (
            <li key={plan.id} className="py-3">
              <RecurringCard
                plan={plan}
                data={data}
                onEdit={() => onEdit(plan)}
                onToggle={(active) => onToggle(plan, active)}
              />
            </li>
          ))}
        </ul>
      )}

      {sections.ended.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-medium text-muted">Ended</h3>
          <ul className="mt-1 divide-y divide-line opacity-50">
            {sections.ended.map((plan) => (
              <li key={plan.id} className="py-3">
                <RecurringCard plan={plan} data={data} onEdit={() => onEdit(plan)} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function RecurringCard({
  plan,
  data,
  onEdit,
  onToggle,
}: {
  plan: RecurringPlan;
  data: PlanResponse;
  onEdit: () => void;
  onToggle?: (active: boolean) => void;
}) {
  const pay = accountName(plan.payFromAccountId, data.accounts);
  return (
    <div className="flex items-start gap-3">
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-base text-ink">{plan.name}</span>
        <span className="mt-0.5 block text-[13px] text-muted">
          {formatInr(plan.amount)} · {frequencyLabel(plan)} · {nextDueLabel(plan, data.today)}
          {pay ? ` · ${pay}` : ""} · {kindLabel(plan, data.categories)}
        </span>
      </button>
      {onToggle ? (
        <button
          type="button"
          role="switch"
          aria-checked={plan.active}
          aria-label={`${plan.name} active`}
          onClick={() => onToggle(!plan.active)}
          className={`mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors ${
            plan.active ? "bg-accent" : "bg-line-strong"
          }`}
        >
          <span
            className={`size-5 rounded-full bg-card shadow-sm transition-transform ${
              plan.active ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      ) : null}
    </div>
  );
}

function OneTimePanel({
  data,
  status,
  onStatus,
  onAdd,
  onEdit,
  onComplete,
  onCancel,
}: {
  data: PlanResponse;
  status: "planned" | "completed" | "cancelled";
  onStatus: (status: "planned" | "completed" | "cancelled") => void;
  onAdd: () => void;
  onEdit: (plan: OneTimePlan) => void;
  onComplete: (plan: OneTimePlan) => void;
  onCancel: (plan: OneTimePlan) => void;
}) {
  const rows = oneTimeSorted(data.oneTime, status);
  return (
    <div className="mt-4">
      <div className="card p-4">
        <p className="kicker">Next 30 days</p>
        <p className="hero-num mt-1.5">
          {formatInr(data.oneTimeHeader.next30)}
        </p>
        <p className="mt-2 text-sm text-muted">
          Next 90 days {formatInr(data.oneTimeHeader.next90)} · Total planned{" "}
          {formatInr(data.oneTimeHeader.totalPlanned)}
        </p>
      </div>
      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
        {(["planned", "completed", "cancelled"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={chipClass(status === id)}
            onClick={() => onStatus(id)}
          >
            {ONE_TIME_STATUS_LABELS[id]}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-3 btn-secondary w-full text-sm"
      >
        + Add one-time
      </button>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing in {ONE_TIME_STATUS_LABELS[status]}.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((plan) => {
            const pay = accountName(plan.payFromAccountId, data.accounts);
            return (
              <li key={plan.id} className="py-3">
                <button type="button" onClick={() => onEdit(plan)} className="w-full text-left">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-base text-ink">{plan.name}</span>
                      <span className="mt-0.5 block text-[13px] text-muted">
                        {plan.expectedDate} · {PRIORITY_LABELS[plan.priority]}
                        {pay ? ` · ${pay}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-ink">
                      {formatInr(plan.amount)}
                    </span>
                  </span>
                </button>
                {status === "planned" ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onComplete(plan)}
                      className="btn-secondary rounded-full text-sm"
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancel(plan)}
                      className="btn-quiet"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function InflowsPanel({
  data,
  status,
  onStatus,
  onAdd,
  onEdit,
}: {
  data: PlanResponse;
  status: "expected" | "received" | "dropped";
  onStatus: (status: "expected" | "received" | "dropped") => void;
  onAdd: () => void;
  onEdit: (row: PlanResponse["inflows"][number]) => void;
}) {
  const rows = inflowsSorted(data.inflows, status);
  return (
    <div className="mt-4">
      <div className="card p-4">
        <p className="kicker">
          Expected, not counted
        </p>
        <p className="hero-num mt-1.5">
          {formatInr(data.inflowsHeader.expectedNotCounted)}
        </p>
        <p className="mt-2 text-sm text-muted">
          Free to allocate ignores these until they land in the ledger.
        </p>
      </div>
      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
        {(["expected", "received", "dropped"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={chipClass(status === id)}
            onClick={() => onStatus(id)}
          >
            {INFLOW_STATUS_LABELS[id]}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-3 btn-secondary w-full text-sm"
      >
        + Add inflow
      </button>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {status === "expected" ? "None expected. That's fine." : `Nothing ${status}.`}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onEdit(row)}
                className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base text-ink">{row.name}</span>
                  <span className="block text-[13px] text-muted">
                    {row.expectedDate}
                    {row.isLiquid ? " · Liquid" : ""}
                  </span>
                </span>
                <span className="shrink-0 text-base font-semibold tabular-nums text-ink">
                  {formatInr(row.amount)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ForecastPanel({
  data,
  assumeInflows,
  onAssume,
  onKind,
}: {
  data: PlanResponse;
  assumeInflows: boolean;
  onAssume: (next: boolean) => void;
  onKind: (month: YearMonth, kind: RecurringKind) => void;
}) {
  const bars = stackedMonthBars(data.forecast.months);
  return (
    <div className="mt-4">
      <button
        type="button"
        role="switch"
        aria-checked={assumeInflows}
        onClick={() => onAssume(!assumeInflows)}
        className={chipClass(assumeInflows)}
      >
        Assume expected inflows arrive
      </button>
      <p className="mt-2 text-[13px] text-muted">Off by default. Inflows stay out of free cash either way.</p>

      <div className="card mt-4 p-4">
        <h3 className="text-sm font-semibold text-ink">Next 6 months</h3>
        <div className="mt-3 flex items-end justify-between gap-1">
          {bars.map((bar) => (
            <div key={bar.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-20 w-7 flex-col justify-end overflow-hidden rounded-md bg-card-2">
                <div
                  className="flex w-full flex-col justify-end"
                  style={{ height: `${Math.round(bar.height * 100)}%` }}
                >
                  {bar.shares.investment > 0 ? (
                    <div
                      className="w-full bg-accent"
                      style={{ height: `${Math.round(bar.shares.investment * 100)}%` }}
                    />
                  ) : null}
                  {bar.shares.lifestyle > 0 ? (
                    <div
                      className="w-full bg-seg-life"
                      style={{ height: `${Math.round(bar.shares.lifestyle * 100)}%` }}
                    />
                  ) : null}
                  {bar.shares.loanEmi > 0 ? (
                    <div
                      className="w-full bg-seg-emi"
                      style={{ height: `${Math.round(bar.shares.loanEmi * 100)}%` }}
                    />
                  ) : null}
                </div>
              </div>
              <span className="text-[11px] text-muted">{formatMonthShort(bar.month)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          <span className="mr-2 inline-block size-2 rounded-sm bg-seg-emi align-middle" />
          Loan/EMI
          <span className="mx-2 inline-block size-2 rounded-sm bg-seg-life align-middle" />
          Lifestyle
          <span className="mx-2 inline-block size-2 rounded-sm bg-accent align-middle" />
          Investment
        </p>
      </div>

      <ul className="mt-3 space-y-2">
        {data.forecast.months.map((row) => (
          <ForecastCard key={row.month} row={row} onKind={onKind} />
        ))}
      </ul>

      <div className="card mt-3 p-4">
        <p className="kicker">6-month total</p>
        <p className="hero-num mt-1.5 text-2xl">
          {formatInr(data.forecast.totals.total)}
        </p>
        <p className="mt-2 text-sm text-muted">
          Loan/EMI {formatInr(data.forecast.totals.loanEmi)} · Lifestyle{" "}
          {formatInr(data.forecast.totals.lifestyle)} · Investment{" "}
          {formatInr(data.forecast.totals.investment)}
        </p>
      </div>
    </div>
  );
}

function ForecastCard({
  row,
  onKind,
}: {
  row: ForecastMonth;
  onKind: (month: YearMonth, kind: RecurringKind) => void;
}) {
  const kinds: { key: RecurringKind; label: string; amount: number }[] = [
    { key: "loan_emi", label: "Loan/EMI", amount: row.loanEmi },
    { key: "lifestyle", label: "Lifestyle", amount: row.lifestyle },
    { key: "investment", label: "Investment", amount: row.investment },
  ];
  return (
    <li className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">{formatMonthTitle(row.month)}</h3>
        <span className="text-base font-semibold tabular-nums text-ink">{formatInr(row.total)}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {kinds.map((kind) => (
          <li key={kind.key}>
            <button
              type="button"
              onClick={() => onKind(row.month, kind.key)}
              className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 text-left text-sm transition-colors active:bg-card-2"
            >
              <span className="text-muted">{kind.label}</span>
              <span className="tabular-nums text-ink">{formatInr(kind.amount)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p
        className={`mt-2 border-t border-line pt-2 text-sm tabular-nums ${
          row.projectedLiquid < 0 ? "font-medium text-danger" : "text-muted"
        }`}
      >
        Projected liquid {formatInr(row.projectedLiquid)}
      </p>
    </li>
  );
}
