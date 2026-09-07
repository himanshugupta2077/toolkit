import { useState } from "react";
import { postUnlock } from "../api/store.ts";
import { apiErrorText } from "./copy.ts";
import { assertBiometric, isPinDigits } from "./lock.ts";

type LockScreenProps = {
  onUnlocked: () => void;
  webauthnId: string | null;
};

export function LockScreen({ onUnlocked, webauthnId }: LockScreenProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(nextPin: string) {
    if (!isPinDigits(nextPin) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postUnlock(nextPin);
      onUnlocked();
    } catch (err) {
      setError(apiErrorText(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  async function onBio() {
    if (!webauthnId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await assertBiometric(window.location.hostname, webauthnId);
      if (!ok) {
        setError("Biometrics were cancelled.");
        return;
      }
      onUnlocked();
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-app px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <p className="kicker">Locked</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Finance OS</h1>
      <p className="mt-2 text-sm text-muted">Enter your PIN. Numbers stay on the laptop.</p>

      <p className="mt-10 text-center text-3xl leading-none tracking-[0.4em] text-ink" aria-hidden="true">
        {"•".repeat(pin.length) || " "}
      </p>

      {error ? <p className="mt-3 text-center text-sm text-danger">{error}</p> : null}

      {webauthnId ? (
        <button
          type="button"
          className="btn-secondary mt-4 text-sm"
          onClick={() => void onBio()}
          disabled={busy}
        >
          Unlock with this phone
        </button>
      ) : null}

      <div className="mt-auto grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0"].map((key) => (
          <button
            key={key}
            type="button"
            className="min-h-14 rounded-2xl border border-line bg-card text-2xl font-medium tabular-nums text-ink transition-colors active:bg-card-2 disabled:opacity-40"
            aria-label={key === "back" ? "Backspace" : key}
            disabled={busy}
            onClick={() => {
              if (key === "back") {
                setPin((p) => p.slice(0, -1));
                return;
              }
              setPin((p) => (p.length >= 6 ? p : p + key));
            }}
          >
            {key === "back" ? "⌫" : key}
          </button>
        ))}
        <button
          type="button"
          className="btn-primary min-h-14 rounded-2xl"
          disabled={busy || !isPinDigits(pin)}
          onClick={() => void submit(pin)}
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
