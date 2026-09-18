import { useEffect, useState } from "react";
import { isTabActive } from "./tabs.ts";

/** Phone chrome below this; sidebar + wide pages at and above. */
export const DESKTOP_MQ = "(min-width: 60rem)";

export const DESKTOP_NAV = [
  { to: "/home", label: "Dashboard" },
  { to: "/plan", label: "Budget" },
  { to: "/ledger", label: "Ledger" },
  { to: "/emergency", label: "Emergency" },
  { to: "/debt", label: "Debt" },
  { to: "/wealth", label: "Wealth" },
  { to: "/wealth/invest", label: "Invest" },
  { to: "/wealth/goals", label: "Goals" },
] as const;

export const DESKTOP_SETUP = [
  { to: "/more/accounts", label: "Accounts" },
  { to: "/more/categories", label: "Categories" },
  { to: "/more/settings", label: "Settings" },
] as const;

export const DESKTOP_NAV_GROUPS = [
  { label: null, items: DESKTOP_NAV.slice(0, 1) },
  { label: "Money", items: DESKTOP_NAV.slice(1, 5) },
  { label: "Wealth", items: DESKTOP_NAV.slice(5) },
] as const;

export type DesktopNavTo =
  | (typeof DESKTOP_NAV)[number]["to"]
  | (typeof DESKTOP_SETUP)[number]["to"];

export function isDesktopNavActive(pathname: string, to: string): boolean {
  if (to === "/ledger") {
    return pathname === "/ledger" || pathname.startsWith("/ledger/");
  }
  if (to === "/plan") {
    return pathname === "/plan" || pathname.startsWith("/plan/");
  }
  if (to === "/emergency") {
    return (
      pathname === "/emergency" ||
      pathname.startsWith("/emergency/") ||
      pathname === "/wealth/emergency" ||
      pathname.startsWith("/wealth/emergency/")
    );
  }
  if (to === "/debt") {
    return pathname === "/debt" || pathname.startsWith("/debt/");
  }
  if (to === "/more/accounts") {
    return pathname.startsWith("/more/accounts");
  }
  if (to === "/more/categories") {
    return pathname.startsWith("/more/categories");
  }
  if (to === "/more/settings") {
    return pathname.startsWith("/more/settings");
  }
  return isTabActive(pathname, to);
}

export function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DESKTOP_MQ).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DESKTOP_MQ);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return desktop;
}
