import { LEDGER_TYPES, nowTimeIst, type Books, type LedgerType } from "../engine/index.ts";
import type {
  LedgerPostBody,
  OsParseCatalog,
  OsParsedEntry,
} from "../api/store.ts";

export const ADD_MODES = ["form", "type", "speak"] as const;
export type AddMode = (typeof ADD_MODES)[number];

export const ADD_MODE_LABELS: Record<AddMode, string> = {
  form: "Form",
  type: "Type",
  speak: "Speak",
};

const ADD_MODE_KEY = "finance.addMode";

export function isAddMode(value: string): value is AddMode {
  return (ADD_MODES as readonly string[]).includes(value);
}

export function readAddMode(): AddMode {
  if (typeof sessionStorage === "undefined") return "form";
  const raw = sessionStorage.getItem(ADD_MODE_KEY) ?? "";
  return isAddMode(raw) ? raw : "form";
}

export function writeAddMode(mode: AddMode): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(ADD_MODE_KEY, mode);
}

export function catalogFromBooks(books: Books): OsParseCatalog {
  return {
    today: books.today,
    timezone: "Asia/Kolkata",
    types: [...LEDGER_TYPES],
    accounts: books.accounts.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      group: row.group,
      virtualKind: row.virtualKind,
      isArchived: row.isArchived,
    })),
    categories: books.categories.map((row) => ({
      id: row.id,
      name: row.name,
      group: row.group,
      defaultInBudget: row.defaultInBudget,
      isArchived: row.isArchived,
    })),
  };
}

export function voiceSttPrefs(): { model: string; translate: boolean; stt: string } {
  if (typeof localStorage === "undefined") {
    return { model: "medium", translate: false, stt: "" };
  }
  return {
    model: localStorage.getItem("an_model") || "medium",
    translate: localStorage.getItem("an_translate") === "1",
    stt: localStorage.getItem("an_stt") || "",
  };
}

export function extForMime(mime: string): string {
  const t = mime.toLowerCase();
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mp4") || t.includes("m4a")) return "m4a";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("wav")) return "wav";
  return "webm";
}

export function toLedgerPostBody(
  entry: OsParsedEntry,
  today: string,
): LedgerPostBody {
  const time =
    entry.time && entry.time !== ""
      ? entry.time
      : entry.date === today
        ? nowTimeIst()
        : null;
  return {
    date: entry.date,
    time,
    type: entry.type,
    amount: entry.amount,
    fromAccountId: entry.fromAccountId,
    toAccountId: entry.toAccountId,
    categoryId: entry.categoryId,
    inBudget: entry.inBudget,
    notes: entry.notes,
    source: "ai",
  };
}

export function isLedgerTypeValue(value: string): value is LedgerType {
  return (LEDGER_TYPES as readonly string[]).includes(value);
}
