import { useCallback, useSyncExternalStore } from "react";

export const PIE_BY = ["asset", "kind", "account"] as const;
export type PieBy = (typeof PIE_BY)[number];

export type DisplayPrefs = {
  showPie: boolean;
  pieBy: PieBy;
};

const KEY = "finance-os-display-v1";
const EVENT = "finance-os-display";
export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = { showPie: true, pieBy: "asset" };

const PIE_BY_SET = new Set<string>(PIE_BY);

function parse(raw: string | null): DisplayPrefs {
  if (!raw) return DEFAULT_DISPLAY_PREFS;
  try {
    const data = JSON.parse(raw) as Partial<DisplayPrefs>;
    return {
      showPie: data.showPie !== false,
      pieBy: PIE_BY_SET.has(data.pieBy ?? "") ? (data.pieBy as PieBy) : "asset",
    };
  } catch {
    return DEFAULT_DISPLAY_PREFS;
  }
}

let cacheRaw: string | null | undefined;
let cache: DisplayPrefs = DEFAULT_DISPLAY_PREFS;

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): DisplayPrefs {
  const raw = readRaw();
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  cache = parse(raw);
  return cache;
}

function subscribe(onStoreChange: () => void): () => void {
  const onChange = () => onStoreChange();
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function writeDisplayPrefs(patch: Partial<DisplayPrefs>): DisplayPrefs {
  const next = { ...getSnapshot(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  cacheRaw = undefined;
  window.dispatchEvent(new Event(EVENT));
  return next;
}

export function useDisplayPrefs(): [DisplayPrefs, (patch: Partial<DisplayPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_DISPLAY_PREFS);
  const setPrefs = useCallback((patch: Partial<DisplayPrefs>) => {
    writeDisplayPrefs(patch);
  }, []);
  return [prefs, setPrefs];
}
