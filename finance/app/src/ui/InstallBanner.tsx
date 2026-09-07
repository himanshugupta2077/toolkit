import { useEffect, useState } from "react";
import {
  bumpVisitCount,
  INSTALL_DISMISS_KEY,
  isIosSafari,
  isStandaloneDisplay,
  shouldOfferInstall,
} from "./install.ts";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function currentStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return isStandaloneDisplay({
    matchMedia:
      typeof window.matchMedia === "function" ? (q) => window.matchMedia(q) : undefined,
    navigatorStandalone:
      "standalone" in navigator &&
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
  });
}

export function InstallBanner() {
  const [native, setNative] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(INSTALL_DISMISS_KEY) === "1",
  );
  const [visits] = useState(() =>
    typeof localStorage === "undefined" ? 1 : bumpVisitCount(localStorage),
  );
  const ios = typeof navigator === "undefined" ? false : isIosSafari(navigator.userAgent);
  const open = shouldOfferInstall({
    standalone: currentStandalone(),
    visitCount: visits,
    dismissed,
  });

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setNative(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!open) return null;

  function dismiss() {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (native) {
      await native.prompt();
      setDismissed(true);
      return;
    }
    dismiss();
  }

  return (
    <div className="card mx-5 mb-3 p-4">
      <p className="text-sm font-medium text-ink">Add to Home Screen</p>
      <p className="mt-1 text-sm text-muted">
        {ios && !native
          ? "On iPhone: Share, then Add to Home Screen. Opens without the browser bar."
          : "Install so it opens like an app. Entries still hit the laptop, not this phone."}
      </p>
      <div className="mt-3 flex gap-2">
        {native ? (
          <button
            type="button"
            className="btn-primary rounded-full text-sm"
            onClick={() => void install()}
          >
            Install
          </button>
        ) : null}
        <button
          type="button"
          className="btn-quiet"
          onClick={dismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
