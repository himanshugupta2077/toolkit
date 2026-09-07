import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  getInvest,
  postDipBuy,
  putInvestPlan,
  seedInvestDefaults,
  type InvestResponse,
} from "../api/store.ts";
import {
  formatBpPct,
  formatInr,
  normaliseActiveTargets,
  type InvestAsset,
  type InvestPlan,
  type Paise,
} from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { apiErrorText } from "./copy.ts";
import { FetchError } from "./FetchError.tsx";
import {
  activeThemeTierId,
  addAsset,
  dipSuggestion,
  moveDipPriority,
  removeAsset,
  replaceAsset,
  setSipPct,
  setTierBelowAmount,
  sipForDraft,
  sipOrderCaption,
  sipPct,
  themeAssets,
  themeTierCaption,
  toggleAssetActive,
  toggleTierAsset,
  versionCaption,
  weightSumLabel,
} from "./invest.ts";
import { assetToForm, emptyAssetForm } from "./invest.ts";
import { AssetFormSheet, DeploySheet, type DeployLineDraft } from "./InvestSheets.tsx";
import { Amount } from "./Privacy.tsx";
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from "./icons.tsx";
import { parseRupeesInput, rupeesInput } from "./wealth.ts";

function invalidateInvest(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["invest"] });
  void qc.invalidateQueries({ queryKey: ["allocation"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["ledger"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["engine-summary"] });
  void qc.invalidateQueries({ queryKey: ["counts"] });
}

const inputClass =
  "mt-1 field";

function AssetRow({
  asset,
  sipAmount,
  isFirstDip,
  isLastDip,
  onToggle,
  onEdit,
  onRemove,
  onMoveDip,
}: {
  asset: InvestAsset;
  sipAmount: Paise;
  isFirstDip: boolean;
  isLastDip: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onMoveDip: (dir: -1 | 1) => void;
}) {
  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
          <h3 className="flex min-w-0 items-center gap-2 text-base font-medium text-ink">
            <span className="truncate">{asset.name}</span>
            <span className="inline-flex shrink-0 items-center rounded-md bg-card-2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink">
              {formatBpPct(asset.targetBp)}
            </span>
          </h3>
          {asset.instrumentNote ? (
            <p className="mt-0.5 text-xs text-muted">{asset.instrumentNote}</p>
          ) : null}
        </button>
        <Amount className="shrink-0 text-base font-medium tabular-nums text-ink">
          {formatInr(sipAmount)}
        </Amount>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          role="switch"
          aria-checked={asset.active}
          aria-label={`${asset.name} active`}
          onClick={onToggle}
          className={`min-h-11 rounded-full px-3 text-sm font-medium ${
            asset.active ? "bg-accent text-accent-fg" : "border border-line text-muted"
          }`}
        >
          {asset.active ? "On" : "Off"}
        </button>
        <button
          type="button"
          aria-label={`Move ${asset.name} up`}
          disabled={isFirstDip || asset.dipPriority == null}
          onClick={() => onMoveDip(-1)}
          className="icon-btn"
        >
          <ChevronUpIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={`Move ${asset.name} down`}
          disabled={isLastDip || asset.dipPriority == null}
          onClick={() => onMoveDip(1)}
          className="icon-btn"
        >
          <ChevronDownIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={`Remove ${asset.name}`}
          onClick={onRemove}
          className="icon-btn text-danger"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>
    </article>
  );
}

export function InvestScreen() {
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const investQ = useQuery({
    queryKey: ["invest"],
    queryFn: getInvest,
    staleTime: 15_000,
  });
  const data = investQ.data;

  const [draft, setDraft] = useState<InvestPlan | null>(null);
  const [whatIf, setWhatIf] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [assetOpen, setAssetOpen] = useState<"add" | InvestAsset | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployAmount, setDeployAmount] = useState<Paise>(0);
  const [deployFrom, setDeployFrom] = useState("");
  const [deployTo, setDeployTo] = useState("");
  const [deployLines, setDeployLines] = useState<DeployLineDraft[]>([]);

  const plan = draft ?? data?.plan ?? null;
  const whatIfPaise: Paise | null =
    whatIf == null
      ? (data?.lastInvestAmount ?? 0) > 0
        ? data!.lastInvestAmount
        : null
      : parseRupeesInput(whatIf);
  const amount: Paise = whatIfPaise ?? 0;
  const split = plan ? sipForDraft(plan, amount) : null;
  const sipById = useMemo(() => {
    const map: Record<string, Paise> = {};
    for (const row of split?.orders ?? []) map[row.assetId] = row.amount;
    return map;
  }, [split]);

  const dipRanked = (plan?.assets ?? []).filter((row) => row.dipPriority != null);
  const themes = plan ? themeAssets(plan) : [];

  function openDeploy(payload: InvestResponse) {
    if (!payload.plan) return;
    const start = payload.dipBalance > 0 ? payload.dipBalance : 0;
    const suggestion = dipSuggestion(payload.plan, start);
    setDeployAmount(start);
    setDeployFrom(payload.suggestedFromAccountId ?? "");
    setDeployTo(payload.suggestedToAccountId ?? "");
    setDeployLines(
      (suggestion?.orders ?? []).map((row) => ({
        assetId: row.assetId,
        name: row.name,
        amount: row.amount,
      })),
    );
    setDeployOpen(true);
  }

  function setDeployTotal(next: Paise) {
    setDeployAmount(next);
    if (!plan) return;
    const suggestion = dipSuggestion(plan, next);
    setDeployLines(
      (suggestion?.orders ?? []).map((row) => ({
        assetId: row.assetId,
        name: row.name,
        amount: row.amount,
      })),
    );
  }

  async function onSave() {
    if (!plan) return;
    setSaving(true);
    try {
      const res = await putInvestPlan(plan);
      onToast("Invest plan saved as a new version");
      setDraft(res.plan);
      await invalidateInvest(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onSeed() {
    setSaving(true);
    try {
      await seedInvestDefaults();
      onToast("Default 70/30 plan seeded");
      setDraft(null);
      await invalidateInvest(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDeploy() {
    setSaving(true);
    try {
      await postDipBuy({
        amount: deployAmount,
        fromAccountId: deployFrom,
        toAccountId: deployTo,
        lines: deployLines.map((row) => ({ assetId: row.assetId, amount: row.amount })),
      });
      onToast(`Deployed ${formatInr(deployAmount)}`);
      setDeployOpen(false);
      await invalidateInvest(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="px-5 pb-8">
      <Link to="/wealth" className="btn-ghost">
        ← Wealth
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Invest</h1>
          <p className="mt-0.5 text-sm text-muted">{versionCaption(plan)}</p>
        </div>
        {plan ? (
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-accent"
          >
            {saving ? "Saving…" : "Save version"}
          </button>
        ) : null}
      </div>

      {investQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading invest plan…</p>
      ) : investQ.error ? (
        <FetchError error={investQ.error} onRetry={() => void investQ.refetch()} />
      ) : !plan ? (
        <div className="mt-6 card p-4">
          <p className="text-sm text-muted">No invest plan yet. Seed the locked 70/30 default.</p>
          <button
            type="button"
            onClick={() => void onSeed()}
            disabled={saving}
            className="mt-3 min-h-11 w-full rounded-2xl bg-accent text-sm font-medium text-accent-fg"
          >
            Use 70/30 default
          </button>
        </div>
      ) : (
        <>
          <article className="mt-4 card p-4">
            <p className="kicker">SIP / dip</p>
            <p className="mt-1 text-lg font-medium text-ink">
              SIP {sipPct(plan)}% / Dip reserve {100 - sipPct(plan)}%
            </p>
            <label className="mt-3 block">
              <span className="kicker">SIP %</span>
              <input
                type="range"
                min={0}
                max={100}
                value={sipPct(plan)}
                onChange={(e) => setDraft(setSipPct(plan, Number(e.target.value)))}
                aria-label="SIP percent"
                className="mt-2 w-full"
              />
            </label>
          </article>

          <article className="mt-3 card p-4">
            <h2 className="text-base font-medium text-ink">This month’s SIP</h2>
            <p className="mt-1 text-xs text-muted">
              {data && data.lastInvestAmount > 0
                ? `Last confirmed allocation ${formatInr(data.lastInvestAmount)}. Try another amount below.`
                : "No confirmed investment allocation yet. Try an amount."}
            </p>
            <label className="mt-3 block">
              <span className="kicker">
                Amount ₹
              </span>
              <input
                value={whatIf ?? (data && data.lastInvestAmount > 0 ? rupeesInput(data.lastInvestAmount) : "")}
                onChange={(e) => setWhatIf(e.target.value)}
                inputMode="decimal"
                aria-label="SIP what-if rupees"
                className={inputClass}
              />
            </label>
            {split ? (
              <>
                <p className="mt-2 text-sm text-ink">
                  <Amount>{sipOrderCaption(split)}</Amount>
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {split.orders
                    .filter((row) => row.activeForSplit)
                    .map((row) => (
                      <li key={row.assetId} className="flex justify-between gap-3">
                        <span className="truncate text-ink">{row.name}</span>
                        <Amount className="shrink-0 tabular-nums text-muted">
                          {formatInr(row.amount)}
                        </Amount>
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">Enter an amount to see the split.</p>
            )}
          </article>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-medium text-ink">Assets</h2>
              <p className="text-xs text-muted">{weightSumLabel(plan.assets)}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setDraft({ ...plan, assets: normaliseActiveTargets(plan.assets) })
                }
                className="btn-ghost"
              >
                Normalise
              </button>
              <button
                type="button"
                onClick={() => setAssetOpen("add")}
                className="btn-ghost"
              >
                + Add asset
              </button>
            </div>
          </div>
          <div className="mt-2 space-y-3">
            {plan.assets.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                sipAmount={sipById[asset.id] ?? 0}
                isFirstDip={dipRanked[0]?.id === asset.id}
                isLastDip={dipRanked[dipRanked.length - 1]?.id === asset.id}
                onToggle={() => setDraft(toggleAssetActive(plan, asset.id))}
                onEdit={() => setAssetOpen(asset)}
                onRemove={() => setDraft(removeAsset(plan, asset.id))}
                onMoveDip={(dir) => setDraft(moveDipPriority(plan, asset.id, dir))}
              />
            ))}
          </div>

          <article className="mt-4 card p-4">
            <h2 className="text-base font-medium text-ink">Theme engine</h2>
            {plan.themeTiers.map((tier) => {
              const active =
                amount > 0 && activeThemeTierId(plan, amount) === tier.id;
              return (
                <div key={tier.id} className="mt-3 border-t border-line pt-3">
                  <p className="text-sm text-ink">
                    {themeTierCaption(tier, plan.assets, plan.themeTiers)}
                    {active ? " · active now" : ""}
                  </p>
                  {tier.belowAmount != null ? (
                    <label className="mt-2 block">
                      <span className="kicker">
                        Below ₹
                      </span>
                      <input
                        value={rupeesInput(tier.belowAmount)}
                        onChange={(e) => {
                          const parsed = parseRupeesInput(e.target.value);
                          if (parsed != null) {
                            setDraft(setTierBelowAmount(plan, tier.id, parsed));
                          }
                        }}
                        inputMode="decimal"
                        aria-label="Theme threshold rupees"
                        className={inputClass}
                      />
                    </label>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {themes.map((theme) => {
                      const on = tier.allowedAssetIds.includes(theme.id);
                      return (
                        <button
                          key={`${tier.id}-${theme.id}`}
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${theme.name} allowed in ${tier.id}`}
                          onClick={() => setDraft(toggleTierAsset(plan, tier.id, theme.id))}
                          className={`min-h-11 rounded-full px-3 text-xs font-medium ${
                            on ? "bg-accent text-accent-fg" : "border border-line text-muted"
                          }`}
                        >
                          {theme.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </article>

          <article className="mt-3 card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-medium text-ink">Dip reserve</h2>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                  <Amount>{formatInr(data?.dipBalance ?? 0)}</Amount>
                </p>
              </div>
              <button
                type="button"
                onClick={() => data && openDeploy(data)}
                disabled={!data || data.dipBalance <= 0}
                className="btn-ghost"
              >
                Deploy
              </button>
            </div>
            {data && data.dipHistory.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                Credits land when you confirm an allocation with Investment &gt; 0.
              </p>
            ) : (
              <ul className="mt-3 space-y-1 text-sm">
                {(data?.dipHistory ?? []).slice(0, 8).map((row) => (
                  <li key={row.id} className="flex justify-between gap-3">
                    <span className="truncate text-muted">
                      {row.date}
                      {row.note ? ` · ${row.note}` : ""}
                    </span>
                    <Amount className="shrink-0 tabular-nums text-ink">
                      {row.credit > 0 ? `+${formatInr(row.credit)}` : `−${formatInr(row.debit)}`}
                    </Amount>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="mt-3 rounded-2xl border border-dashed border-line bg-card p-4">
            <p className="text-sm font-medium text-ink">AI research (coming)</p>
            <p className="mt-1 text-xs text-muted">Phase 26. Nothing to tap yet.</p>
          </article>
        </>
      )}

      <BottomSheet
        open={assetOpen !== null}
        title={assetOpen === "add" ? "Add asset" : "Edit asset"}
        onClose={() => setAssetOpen(null)}
      >
        {assetOpen !== null && plan ? (
          <AssetFormSheet
            key={assetOpen === "add" ? "add" : assetOpen.id}
            mode={assetOpen === "add" ? "add" : "edit"}
            assetId={assetOpen === "add" ? undefined : assetOpen.id}
            initial={assetOpen === "add" ? emptyAssetForm() : assetToForm(assetOpen)}
            saving={saving}
            onSave={(asset) => {
              if (assetOpen === "add") setDraft(addAsset(plan, asset));
              else setDraft(replaceAsset(plan, { ...asset, id: assetOpen.id }));
              setAssetOpen(null);
            }}
          />
        ) : null}
      </BottomSheet>

      <BottomSheet open={deployOpen} title="Deploy dip reserve" onClose={() => setDeployOpen(false)}>
        {data ? (
          <DeploySheet
            balance={data.dipBalance}
            accounts={data.accounts}
            fromAccountId={deployFrom}
            toAccountId={deployTo}
            lines={deployLines}
            amount={deployAmount}
            saving={saving}
            onChangeFrom={setDeployFrom}
            onChangeTo={setDeployTo}
            onChangeAmount={setDeployTotal}
            onChangeLine={(assetId, next) =>
              setDeployLines((rows) =>
                rows.map((row) => (row.assetId === assetId ? { ...row, amount: next } : row)),
              )
            }
            onDeploy={() => void onDeploy()}
          />
        ) : null}
      </BottomSheet>
    </section>
  );
}
