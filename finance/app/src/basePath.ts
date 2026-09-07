/** Vite BASE_URL with no trailing slash. Empty when the app is served at `/`. */
export function appBasename(): string {
  return (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
}

/** Prefix a root-absolute path (`/api/…`, `/home`) with the app base. */
export function withBase(path: string): string {
  const prefix = appBasename();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${p}`;
}
