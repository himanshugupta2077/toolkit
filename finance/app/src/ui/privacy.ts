export const BLUR_SESSION_KEY = "finance.blur";

export function readBlurSession(storage: Pick<Storage, "getItem">): boolean | null {
  const raw = storage.getItem(BLUR_SESSION_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export function writeBlurSession(
  storage: Pick<Storage, "setItem">,
  blurred: boolean,
): void {
  storage.setItem(BLUR_SESSION_KEY, blurred ? "1" : "0");
}

export function initialBlur(
  blurDefault: boolean,
  sessionOverride: boolean | null,
): boolean {
  return sessionOverride ?? blurDefault;
}
