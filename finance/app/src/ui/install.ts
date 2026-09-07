export const VISIT_KEY = "finance.os.visits";
export const INSTALL_DISMISS_KEY = "finance.os.installDismissed";

export function bumpVisitCount(storage: Pick<Storage, "getItem" | "setItem">): number {
  const n = Number(storage.getItem(VISIT_KEY) ?? "0") + 1;
  storage.setItem(VISIT_KEY, String(Number.isFinite(n) ? n : 1));
  return Number(storage.getItem(VISIT_KEY) ?? "1");
}

export function isStandaloneDisplay(input: {
  matchMedia?: (query: string) => { matches: boolean };
  navigatorStandalone?: boolean;
}): boolean {
  if (input.navigatorStandalone) return true;
  if (input.matchMedia?.("(display-mode: standalone)").matches) return true;
  return false;
}

export function isIosSafari(ua: string): boolean {
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
  return iOS && /Safari/.test(ua);
}

export function shouldOfferInstall(input: {
  standalone: boolean;
  visitCount: number;
  dismissed: boolean;
}): boolean {
  return !input.standalone && !input.dismissed && input.visitCount >= 2;
}
