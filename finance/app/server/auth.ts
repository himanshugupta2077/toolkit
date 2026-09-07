export type AuthConfig = {
  /** When true, /api (except health) needs a Tailscale identity header. */
  requireTailscale: boolean;
  /** If set, Tailscale-User-Login must equal this (email / login). */
  allowedLogin: string | null;
  /** Explicit override to bind a public interface without Tailscale checks. */
  allowUnauth: boolean;
};

const LOGIN_HEADER = "tailscale-user-login";

export function isPublicBind(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "*" || host === "::0";
}

export function authFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const allowUnauth = env.FINANCE_ALLOW_UNAUTH === "1";
  const allowedLogin = env.FINANCE_TAILNET_USER?.trim() || null;
  const force = env.FINANCE_REQUIRE_TAILSCALE === "1";
  const production = env.NODE_ENV === "production";
  const wildcard = isPublicBind(env.HOST ?? "127.0.0.1");
  if (allowUnauth) {
    return { requireTailscale: false, allowedLogin: null, allowUnauth: true };
  }
  return {
    requireTailscale: force || allowedLogin != null || production || wildcard,
    allowedLogin,
    allowUnauth: false,
  };
}

export function mayBindPublic(host: string, auth: AuthConfig): boolean {
  if (!isPublicBind(host)) return true;
  return auth.requireTailscale || auth.allowUnauth;
}

export function tailscaleLoginFromHeaders(
  header: (name: string) => string | undefined,
): string | null {
  const raw = header(LOGIN_HEADER) ?? header("Tailscale-User-Login");
  const login = raw?.trim() ?? "";
  return login === "" ? null : login;
}

/** Null = allowed. String = 401 error copy. */
export function denyReason(
  login: string | null,
  auth: AuthConfig,
): string | null {
  if (!auth.requireTailscale) return null;
  if (login == null) {
    return "Not on this tailnet.";
  }
  if (auth.allowedLogin != null && login !== auth.allowedLogin) {
    return "Not on this tailnet.";
  }
  return null;
}
