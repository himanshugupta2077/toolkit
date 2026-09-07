import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getLockStatus } from "../api/store.ts";
import { LockScreen } from "./LockScreen.tsx";
import {
  isUnlockValid,
  readUnlockAt,
  readWebauthnId,
  writeUnlockAt,
} from "./lock.ts";

export function LockGate({ children }: { children: ReactNode }) {
  const lockQ = useQuery({
    queryKey: ["lock"],
    queryFn: getLockStatus,
    staleTime: 15_000,
  });
  const pinSet = lockQ.data?.pinSet ?? false;
  const autoLockSeconds = lockQ.data?.autoLockSeconds ?? 120;
  const [unlockedAt, setUnlockedAt] = useState<number | null>(() => {
    if (typeof sessionStorage === "undefined") return null;
    return readUnlockAt(sessionStorage);
  });
  const [now, setNow] = useState(() => Date.now());
  const [webauthnId, setWebauthnId] = useState<string | null>(() => {
    if (typeof localStorage === "undefined") return null;
    return readWebauthnId(localStorage);
  });

  const unlocked = !pinSet || isUnlockValid(unlockedAt, autoLockSeconds, now);

  const markUnlocked = useCallback(() => {
    const at = Date.now();
    setUnlockedAt(at);
    setNow(at);
    if (typeof sessionStorage !== "undefined") writeUnlockAt(sessionStorage, at);
  }, []);

  useEffect(() => {
    if (!pinSet || autoLockSeconds <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [pinSet, autoLockSeconds]);

  useEffect(() => {
    if (!pinSet) return;
    const bump = () => {
      if (unlockedAt == null) return;
      markUnlocked();
    };
    const onVis = () => {
      if (document.visibilityState === "hidden" && autoLockSeconds > 0) {
        setNow(Date.now());
      }
      if (document.visibilityState === "visible") setWebauthnId(readWebauthnId(localStorage));
    };
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pinSet, autoLockSeconds, unlockedAt, markUnlocked]);

  const locked = pinSet && !unlocked;

  return (
    <div className="relative h-full overflow-hidden">
      <div className="h-full" aria-hidden={locked} inert={locked}>
        {children}
      </div>
      {locked ? (
        <LockScreen
          webauthnId={webauthnId}
          onUnlocked={markUnlocked}
        />
      ) : null}
    </div>
  );
}
