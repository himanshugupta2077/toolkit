import { withBase } from "../basePath.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function apiUrl(path: string): string {
  return withBase(path);
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body != null && !isForm && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return readJson<T>(apiUrl(path), init);
}

/** Toolkit FastAPI (`/api/notes`, `/api/finance-os/…`), not the finance Node API. */
export async function toolkitJson<T>(path: string, init?: RequestInit): Promise<T> {
  const p = path.startsWith("/") ? path : `/${path}`;
  return readJson<T>(p, init);
}
