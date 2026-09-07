import { ApiError } from "../api/http.ts";

export const LAPTOP_DOWN =
  "Can't reach the laptop. It may be asleep — nothing is stored on this phone.";

export function apiErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; issues?: { message: string }[] } | null;
    if (body?.error) return body.error;
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
