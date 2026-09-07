export const TABS = [
  { to: "/home", label: "Home" },
  { to: "/wealth", label: "Wealth" },
  { to: "/wealth/invest", label: "Invest" },
  { to: "/wealth/goals", label: "Goals" },
  { to: "/more", label: "More" },
] as const;

export type TabTo = (typeof TABS)[number]["to"];

export function isTabActive(pathname: string, to: string): boolean {
  if (to === "/home") return pathname === "/" || pathname === "/home";
  if (to === "/wealth/invest") {
    return pathname === "/wealth/invest" || pathname.startsWith("/wealth/invest/");
  }
  if (to === "/wealth/goals") {
    return pathname === "/wealth/goals" || pathname.startsWith("/wealth/goals/");
  }
  if (to === "/wealth") {
    if (pathname === "/wealth/invest" || pathname.startsWith("/wealth/invest/")) return false;
    if (pathname === "/wealth/goals" || pathname.startsWith("/wealth/goals/")) return false;
    return pathname === "/wealth" || pathname.startsWith("/wealth/");
  }
  if (to === "/more") {
    if (pathname === "/more" || pathname.startsWith("/more/")) return true;
    if (pathname === "/plan" || pathname.startsWith("/plan/")) return true;
    if (pathname === "/ledger" || pathname.startsWith("/ledger/")) return true;
    return false;
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function activeTabIndex(pathname: string): number {
  const index = TABS.findIndex((tab) => isTabActive(pathname, tab.to));
  return index < 0 ? 0 : index;
}

export function adjacentTabPath(pathname: string, dir: -1 | 1): string | null {
  return TABS[activeTabIndex(pathname) + dir]?.to ?? null;
}
