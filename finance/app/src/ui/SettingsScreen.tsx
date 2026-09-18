import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  deletePin,
  getHealth,
  getSettings,
  postPin,
  putSettings,
} from "../api/store.ts";
import { formatInr } from "../engine/index.ts";
import type { AppShellOutlet } from "./AppShell.tsx";
import { BottomSheet } from "./BottomSheet.tsx";
import { AmountField } from "./formFields.tsx";
import { amountDraftFromPaise } from "./ledger.ts";
import {
  AUTO_LOCK_OPTIONS,
  autoLockLabel,
  biometricAvailable,
  clearWebauthnId,
  isPinDigits,
  readWebauthnId,
  registerBiometric,
  writeWebauthnId,
} from "./lock.ts";
import { apiErrorText } from "./copy.ts";
import { PIE_BY, useDisplayPrefs, type PieBy } from "./displayPrefs.ts";
import { FetchError } from "./FetchError.tsx";
import {
  amountPaise,
  EMPTY_AMOUNT,
  type AmountDraft,
} from "./quickAdd.ts";

const PIE_BY_LABELS: Record<PieBy, string> = {
  asset: "By asset",
  kind: "By core / theme",
  account: "By account",
};

function invalidateSettings(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["settings"] });
  void qc.invalidateQueries({ queryKey: ["lock"] });
  void qc.invalidateQueries({ queryKey: ["categories"] });
  void qc.invalidateQueries({ queryKey: ["books"] });
  void qc.invalidateQueries({ queryKey: ["home"] });
  void qc.invalidateQueries({ queryKey: ["plan"] });
  void qc.invalidateQueries({ queryKey: ["month"] });
  void qc.invalidateQueries({ queryKey: ["wealth"] });
}

function AmountSheet({
  label,
  initial,
  saving,
  onSave,
}: {
  label: string;
  initial: number;
  saving: boolean;
  onSave: (paise: number) => void;
}) {
  const [amount, setAmount] = useState<AmountDraft>(
    initial > 0 ? amountDraftFromPaise(initial) : EMPTY_AMOUNT,
  );
  const paise = amountPaise(amount);
  return (
    <div className="pb-1">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-4">
        <AmountField amount={amount} onChange={setAmount} plus={false} />
      </div>
      <button
        type="button"
        disabled={saving || paise <= 0}
        onClick={() => onSave(paise)}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function PinSheet({
  mode,
  hasPin,
  saving,
  onSet,
  onClear,
}: {
  mode: "set" | "clear";
  hasPin: boolean;
  saving: boolean;
  onSet: (pin: string, current: string | null) => void;
  onClear: (current: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [current, setCurrent] = useState("");
  const needCurrent = hasPin;
  const can =
    mode === "clear"
      ? isPinDigits(current) && !saving
      : isPinDigits(pin) && (!needCurrent || isPinDigits(current)) && !saving;
  return (
    <div className="pb-4">
      {needCurrent ? (
        <label className="block">
          <span className="kicker">Current PIN</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            value={current}
            onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-1 field"
          />
        </label>
      ) : null}
      {mode === "set" ? (
        <label className="mt-3 block">
          <span className="kicker">New PIN (4–6 digits)</span>
          <input
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-1 field"
          />
        </label>
      ) : (
        <p className="mt-3 text-sm text-muted">This only locks the phone UI. The API still needs the tailnet.</p>
      )}
      <button
        type="button"
        disabled={!can}
        onClick={() => {
          if (mode === "clear") onClear(current);
          else onSet(pin, needCurrent ? current : null);
        }}
        className="mt-5 btn-primary w-full"
      >
        {saving ? "Saving…" : mode === "clear" ? "Remove PIN" : "Save PIN"}
      </button>
    </div>
  );
}

export function SettingsScreen() {
  const qc = useQueryClient();
  const { onToast } = useOutletContext<AppShellOutlet>();
  const [saving, setSaving] = useState(false);
  const [moneySheet, setMoneySheet] = useState<"budget" | "salary" | null>(null);
  const [pinSheet, setPinSheet] = useState<"set" | "clear" | null>(null);
  const [bioOn, setBioOn] = useState(() =>
    typeof localStorage === "undefined" ? false : Boolean(readWebauthnId(localStorage)),
  );
  const [display, setDisplay] = useDisplayPrefs();

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 15_000,
  });
  const healthQ = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    staleTime: 60_000,
  });

  const data = settingsQ.data;
  const money = data?.money;
  const lock = data?.lock;

  async function save(body: Parameters<typeof putSettings>[0]) {
    setSaving(true);
    try {
      await putSettings(body);
      onToast("Saved");
      setMoneySheet(null);
      await invalidateSettings(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onSetPin(pin: string, current: string | null) {
    setSaving(true);
    try {
      await postPin(pin, current);
      onToast("PIN saved");
      setPinSheet(null);
      await invalidateSettings(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function onClearPin(current: string) {
    setSaving(true);
    try {
      await deletePin(current);
      clearWebauthnId(localStorage);
      setBioOn(false);
      onToast("PIN removed");
      setPinSheet(null);
      await invalidateSettings(qc);
    } catch (err) {
      onToast(apiErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleBio() {
    if (bioOn) {
      clearWebauthnId(localStorage);
      setBioOn(false);
      onToast("Phone unlock off");
      return;
    }
    if (!biometricAvailable()) {
      onToast("This browser cannot use biometrics.");
      return;
    }
    try {
      const id = await registerBiometric(window.location.hostname);
      writeWebauthnId(localStorage, id);
      setBioOn(true);
      onToast("Unlock with this phone is on");
    } catch (err) {
      onToast(apiErrorText(err));
    }
  }

  return (
    <section className="page">
      <Link to="/more" className="back-link btn-ghost">
        ← More
      </Link>
      <h1 className="page-title mt-2">Settings</h1>
      <p className="mt-1 text-sm text-muted">Money defaults live in SQLite on the laptop.</p>

      {settingsQ.isPending ? (
        <p className="py-8 text-sm text-muted">Loading settings…</p>
      ) : settingsQ.error ? (
        <FetchError error={settingsQ.error} onRetry={() => void settingsQ.refetch()} />
      ) : money && lock ? (
        <div className="desk-dash mt-6">
        <div className="desk:col-span-6">
          <h2 className="kicker">Money</h2>
          <div className="mt-2 divide-y divide-line card">
            <button
              type="button"
              className="flex min-h-14 w-full items-center justify-between px-4 text-left"
              onClick={() => setMoneySheet("budget")}
            >
              <span className="text-base text-ink">Default monthly budget</span>
              <span className="text-sm tabular-nums text-muted">{formatInr(money.defaultBudget)}</span>
            </button>
            <button
              type="button"
              className="flex min-h-14 w-full items-center justify-between px-4 text-left"
              onClick={() => setMoneySheet("salary")}
            >
              <span className="text-base text-ink">Expected monthly salary</span>
              <span className="text-sm tabular-nums text-muted">{formatInr(money.monthlySalary)}</span>
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Changing the default budget only fills months that do not already have their own cap row.
          </p>
        </div>

        <div className="desk:col-span-6">
          <h2 className="kicker">Security</h2>
          <div className="mt-2 divide-y divide-line card">
            <button
              type="button"
              className="flex min-h-14 w-full items-center justify-between px-4 text-left"
              onClick={() => setPinSheet("set")}
            >
              <span className="text-base text-ink">{lock.pinSet ? "Change PIN" : "Set PIN"}</span>
              <span className="text-sm text-muted">{lock.pinSet ? "On" : "Off"}</span>
            </button>
            {lock.pinSet ? (
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between px-4 text-left"
                onClick={() => setPinSheet("clear")}
              >
                <span className="text-base text-ink">Remove PIN</span>
                <span className="text-sm text-muted">›</span>
              </button>
            ) : null}
            {lock.pinSet ? (
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between px-4 text-left"
                onClick={() => void toggleBio()}
              >
                <span className="text-base text-ink">Unlock with this phone</span>
                <span className="text-sm text-muted">{bioOn ? "On" : "Off"}</span>
              </button>
            ) : null}
            <label className="flex min-h-14 items-center justify-between gap-3 px-4">
              <span className="text-base text-ink">Auto-lock</span>
              <select
                value={lock.autoLockSeconds}
                onChange={(e) => void save({ autoLockSeconds: Number(e.target.value) })}
                className="max-w-[12rem] rounded-lg border border-line-strong bg-card px-2 py-1 text-sm text-ink"
              >
                {AUTO_LOCK_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {autoLockLabel(n)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={lock.blurDefault}
              className="flex min-h-14 w-full items-center justify-between px-4 text-left"
              onClick={() => void save({ blurDefault: !lock.blurDefault })}
            >
              <span className="text-base text-ink">Blur dashboard numbers by default</span>
              <span className="text-sm text-muted">{lock.blurDefault ? "On" : "Off"}</span>
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            PIN is a second layer on this phone. The tailnet is the API front door.
            {data.identity.login ? ` Signed in as ${data.identity.login}.` : ""}
          </p>

          <h2 className="mt-6 kicker">Display</h2>
          <div className="mt-2 divide-y divide-line card">
            <button
              type="button"
              role="switch"
              aria-checked={display.showPie}
              className="flex min-h-14 w-full items-center justify-between px-4 text-left"
              onClick={() => setDisplay({ showPie: !display.showPie })}
            >
              <span className="text-base text-ink">Portfolio pie chart</span>
              <span className="text-sm text-muted">{display.showPie ? "On" : "Off"}</span>
            </button>
            <label className="flex min-h-14 items-center justify-between gap-3 px-4">
              <span className="text-base text-ink">Pie groups</span>
              <select
                value={display.pieBy}
                onChange={(e) => setDisplay({ pieBy: e.target.value as PieBy })}
                className="max-w-[12rem] rounded-lg border border-line-strong bg-card px-2 py-1 text-sm text-ink"
              >
                {PIE_BY.map((id) => (
                  <option key={id} value={id}>
                    {PIE_BY_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">
            Only changes how Portfolio draws the split. Holdings and math stay the same.
          </p>

          <h2 className="mt-6 kicker">About</h2>
          <div className="mt-2 card px-4 py-3 text-sm text-muted">
            <p>Offline reads are not stored on the phone. If the laptop sleeps, the app is down.</p>
            {healthQ.data ? (
              <p className="mt-2 break-all">Schema {healthQ.data.schemaVersion}</p>
            ) : null}
          </div>
          <p className="mt-4 text-xs text-muted">Notifications wait for a later phase. Export / backup is Phase 23.</p>
        </div>
        </div>
      ) : null}

      <BottomSheet
        open={moneySheet != null}
        title={moneySheet === "salary" ? "Monthly salary" : "Default budget"}
        onClose={() => setMoneySheet(null)}
      >
        {moneySheet === "budget" && money ? (
          <AmountSheet
            label="Used for any month that has no cap of its own."
            initial={money.defaultBudget}
            saving={saving}
            onSave={(paise) => void save({ defaultBudget: paise })}
          />
        ) : null}
        {moneySheet === "salary" && money ? (
          <AmountSheet
            label="Used in next-month free cash, not last ledger income."
            initial={money.monthlySalary}
            saving={saving}
            onSave={(paise) => void save({ monthlySalary: paise })}
          />
        ) : null}
      </BottomSheet>
      <BottomSheet
        open={pinSheet != null}
        title={pinSheet === "clear" ? "Remove PIN" : lock?.pinSet ? "Change PIN" : "Set PIN"}
        onClose={() => setPinSheet(null)}
      >
        {pinSheet ? (
          <PinSheet
            mode={pinSheet}
            hasPin={Boolean(lock?.pinSet)}
            saving={saving}
            onSet={onSetPin}
            onClear={onClearPin}
          />
        ) : null}
      </BottomSheet>
    </section>
  );
}
