import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getLockStatus } from "../api/store.ts";
import {
  initialBlur,
  readBlurSession,
  writeBlurSession,
} from "./privacy.ts";

type PrivacyValue = {
  blurred: boolean;
  blurDefault: boolean;
  toggle: () => void;
  setBlurred: (value: boolean) => void;
};

const PrivacyContext = createContext<PrivacyValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const lockQ = useQuery({
    queryKey: ["lock"],
    queryFn: getLockStatus,
    staleTime: 30_000,
  });
  const blurDefault = lockQ.data?.blurDefault ?? false;
  const [session, setSession] = useState<boolean | null>(() => {
    if (typeof sessionStorage === "undefined") return null;
    return readBlurSession(sessionStorage);
  });

  const setBlurred = useCallback((value: boolean) => {
    setSession(value);
    if (typeof sessionStorage !== "undefined") writeBlurSession(sessionStorage, value);
  }, []);

  const toggle = useCallback(() => {
    setBlurred(!(session ?? blurDefault));
  }, [blurDefault, session, setBlurred]);

  const value = useMemo<PrivacyValue>(
    () => ({
      blurred: initialBlur(blurDefault, session),
      blurDefault,
      toggle,
      setBlurred,
    }),
    [blurDefault, session, toggle, setBlurred],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

// Context modules export the hook next to the provider.
// oxlint-disable-next-line react/only-export-components
export function usePrivacy(): PrivacyValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) {
    return {
      blurred: false,
      blurDefault: false,
      toggle: () => undefined,
      setBlurred: () => undefined,
    };
  }
  return ctx;
}

export function Amount({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { blurred } = usePrivacy();
  return (
    <span className={`${className} ${blurred ? "privacy-blur" : ""}`.trim()}>{children}</span>
  );
}
