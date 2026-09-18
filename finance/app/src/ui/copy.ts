import { ApiError } from "../api/http.ts";

export const LAPTOP_DOWN =
  "Can't reach the laptop. It may be asleep: nothing is stored on this phone.";

function fastapiDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (!Array.isArray(detail) || detail.length === 0) return null;
  const parts = detail.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "msg" in item) {
      return String((item as { msg: unknown }).msg ?? "");
    }
    return "";
  });
  const text = parts.filter(Boolean).join(" ");
  return text || null;
}

export function apiErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as {
      error?: string;
      detail?: unknown;
      issues?: { message: string }[];
    } | null;
    if (body?.error) return body.error;
    const detail = fastapiDetail(body?.detail);
    if (detail) return detail;
    if (body?.issues?.length) return body.issues.map((issue) => issue.message).join(" ");
    return `HTTP ${err.status}`;
  }
  if (err instanceof Error) return err.message;
  return "Request failed";
}

export function laptopErrorText(err: unknown): string {
  const detail = apiErrorText(err);
  if (detail === "Request failed" || detail.startsWith("HTTP ") || detail === "Failed to fetch") {
    return LAPTOP_DOWN;
  }
  return `${LAPTOP_DOWN} ${detail}`;
}
