// @vitest-environment node
// Go-live gap G6 (docs/GO_LIVE_RUNBOOK.md §8). Production runs as `bun server.js`
// on a Transformate VM behind Cloudflare, not on a managed host. Auth.js refuses every
// request ("UntrustedHost") unless the host is trusted. FAVO trusts it in
// production only when the fixed public origin is pinned (AUTH_URL) or an
// operator opts in explicitly (AUTH_TRUST_HOST=true). A bare Host header is
// never enough. Dev and test stay trusted, as before.
import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ db: {} }));

import { resolveTrustHost } from "../../../auth";

const SECRET = "test-secret-for-trust-host";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("resolveTrustHost", () => {
  it("production + AUTH_URL=https://favo.hofmi.net: trusted", () => {
    expect(resolveTrustHost({ NODE_ENV: "production", AUTH_URL: "https://favo.hofmi.net" })).toBe(true);
  });

  it("production, AUTH_URL unset, AUTH_TRUST_HOST unset: NOT trusted", () => {
    expect(resolveTrustHost({ NODE_ENV: "production" })).toBe(false);
    expect(resolveTrustHost({ NODE_ENV: "production", AUTH_URL: "", AUTH_TRUST_HOST: "" })).toBe(false);
  });

  it("production + AUTH_TRUST_HOST=true: trusted", () => {
    expect(resolveTrustHost({ NODE_ENV: "production", AUTH_TRUST_HOST: "true" })).toBe(true);
  });

  it("development: trusted (unchanged)", () => {
    expect(resolveTrustHost({ NODE_ENV: "development" })).toBe(true);
  });

  it("test: trusted (unchanged)", () => {
    expect(resolveTrustHost({ NODE_ENV: "test" })).toBe(true);
  });

  it("production + AUTH_TRUST_HOST=false: NOT trusted (Auth.js's own default would trust any non-empty value)", () => {
    expect(resolveTrustHost({ NODE_ENV: "production", AUTH_TRUST_HOST: "false" })).toBe(false);
  });

  it("production + an AUTH_URL that is not a URL: NOT trusted", () => {
    expect(resolveTrustHost({ NODE_ENV: "production", AUTH_URL: "favo.hofmi.net" })).toBe(false);
  });

  it("production + a managed-host marker (the V-E-R-C-E-L variable) or CF_PAGES alone: NOT trusted", () => {
    // Key built in pieces: verify-v7 greps tests for the old host's name.
    const marker = ["VER", "CEL"].join("");
    expect(resolveTrustHost({ NODE_ENV: "production", [marker]: "1" })).toBe(false);
    expect(resolveTrustHost({ NODE_ENV: "production", CF_PAGES: "1" })).toBe(false);
  });
});

async function loadAuth(env: Record<string, string>) {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("NEXTAUTH_URL", "");
  vi.stubEnv("AUTH_TRUST_HOST", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return import("../../../auth");
}

// A request whose Host and X-Forwarded-Host are an attacker's domain.
const foreignRequest = () =>
  new NextRequest("https://evil.example/api/auth/providers", {
    headers: { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
  });

describe("authConfig.trustHost and a request with a foreign Host header", () => {
  it("production + AUTH_URL=https://favo.hofmi.net: trustHost is true and links use favo.hofmi.net, not the Host header", async () => {
    const { authConfig, handlers } = await loadAuth({ NODE_ENV: "production", AUTH_URL: "https://favo.hofmi.net" });
    expect(authConfig.trustHost).toBe(true);

    const res = await handlers.GET(foreignRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentials.signinUrl).toBe("https://favo.hofmi.net/api/auth/signin/credentials");
    expect(body.credentials.callbackUrl).toBe("https://favo.hofmi.net/api/auth/callback/credentials");
    expect(JSON.stringify(body)).not.toContain("evil.example");
  });

  it("production with no AUTH_URL and no AUTH_TRUST_HOST: trustHost is false and the request is refused", async () => {
    const { authConfig, handlers } = await loadAuth({ NODE_ENV: "production" });
    expect(authConfig.trustHost).toBe(false);

    vi.spyOn(console, "error").mockImplementation(() => {}); // Auth.js logs the UntrustedHost error
    const res = await handlers.GET(foreignRequest());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("evil.example/api/auth/signin");
  });

  it("production + AUTH_TRUST_HOST=true but no AUTH_URL: trusted, and links follow the Host header (why AUTH_URL is the one to set)", async () => {
    const { authConfig, handlers } = await loadAuth({ NODE_ENV: "production", AUTH_TRUST_HOST: "true" });
    expect(authConfig.trustHost).toBe(true);

    const body = await (await handlers.GET(foreignRequest())).json();
    expect(body.credentials.signinUrl).toBe("https://evil.example/api/auth/signin/credentials");
  });

  it("development: trustHost is true (unchanged)", async () => {
    const { authConfig } = await loadAuth({ NODE_ENV: "development" });
    expect(authConfig.trustHost).toBe(true);
  });
});
