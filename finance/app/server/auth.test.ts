/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  authFromEnv,
  denyReason,
  isPublicBind,
  mayBindPublic,
  tailscaleLoginFromHeaders,
} from "./auth.ts";

describe("tailnet front door", () => {
  it("does not require Tailscale on loopback in test/dev", () => {
    const auth = authFromEnv({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
    } as NodeJS.ProcessEnv);
    expect(auth.requireTailscale).toBe(false);
    expect(denyReason(null, auth)).toBeNull();
  });

  it("requires a matching login when FINANCE_TAILNET_USER is set", () => {
    const auth = authFromEnv({
      NODE_ENV: "test",
      FINANCE_TAILNET_USER: "himanshu@github",
    } as NodeJS.ProcessEnv);
    expect(auth.requireTailscale).toBe(true);
    expect(denyReason(null, auth)).toBe("Not on this tailnet.");
    expect(denyReason("other@github", auth)).toBe("Not on this tailnet.");
    expect(denyReason("himanshu@github", auth)).toBeNull();
  });

  it("refuses a public bind without auth, unless allow-unauth", () => {
    expect(isPublicBind("0.0.0.0")).toBe(true);
    expect(
      mayBindPublic("0.0.0.0", {
        requireTailscale: false,
        allowedLogin: null,
        allowUnauth: false,
      }),
    ).toBe(false);
    expect(
      mayBindPublic("0.0.0.0", {
        requireTailscale: true,
        allowedLogin: null,
        allowUnauth: false,
      }),
    ).toBe(true);
    expect(
      mayBindPublic("127.0.0.1", {
        requireTailscale: false,
        allowedLogin: null,
        allowUnauth: false,
      }),
    ).toBe(true);
  });

  it("reads Tailscale-User-Login case-insensitively via the header helper", () => {
    const headers: Record<string, string> = { "tailscale-user-login": "himanshu@github" };
    expect(tailscaleLoginFromHeaders((name) => headers[name.toLowerCase()])).toBe(
      "himanshu@github",
    );
  });
});
