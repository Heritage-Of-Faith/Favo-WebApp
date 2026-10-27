// @vitest-environment node
// SEC-3 / CLAUDE.md §4 defect 10 — a staff session on a café counter tablet
// lasts one 8-hour shift: the JWT expiry AND the session cookie's own lifetime.
// Drives the real Auth.js core with our authConfig (no network, no DB).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { Auth } from "@auth/core";
import { encode, decode } from "@auth/core/jwt";
import { authConfig } from "../../../auth";

const EIGHT_HOURS_S = 8 * 60 * 60;
const SECRET = "test-secret-for-session-cookie-lifetime";
const COOKIE = "authjs.session-token";

async function sessionResponse() {
  const token = await encode({
    token: { id: "staff-1", role: "barista", name: "Louis" },
    secret: SECRET,
    salt: COOKIE,
    maxAge: EIGHT_HOURS_S,
  });
  const req = new Request("http://localhost:3000/api/auth/session", {
    headers: { cookie: `${COOKIE}=${token}` },
  });
  return Auth(req, { ...authConfig, secret: SECRET, basePath: "/api/auth", trustHost: true });
}

function sessionCookie(res: Response): string {
  const c = res.headers.getSetCookie().find((h) => h.startsWith(`${COOKIE}=`));
  if (!c) throw new Error("no session cookie set");
  return c;
}

describe("staff session lifetime = 8 hours", () => {
  it("configures session and JWT maxAge as 8 hours", () => {
    expect(authConfig.session?.maxAge).toBe(EIGHT_HOURS_S);
    expect(authConfig.jwt?.maxAge).toBe(EIGHT_HOURS_S);
  });

  it("sets the session cookie with Max-Age=28800 and an Expires about 8h out (not 30 days)", async () => {
    const before = Date.now();
    const cookie = sessionCookie(await sessionResponse());

    expect(cookie).toMatch(/Max-Age=28800(;|$)/i);
    const expires = /Expires=([^;]+)/i.exec(cookie)?.[1];
    expect(expires).toBeDefined();
    const ms = new Date(expires!).getTime() - before;
    expect(ms).toBeGreaterThan((EIGHT_HOURS_S - 120) * 1000);
    expect(ms).toBeLessThan((EIGHT_HOURS_S + 120) * 1000);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("keeps the default cookie name on http and the __Secure- prefix on https", async () => {
    const plain = sessionCookie(await sessionResponse());
    expect(plain.startsWith(`${COOKIE}=`)).toBe(true);

    const secureName = `__Secure-${COOKIE}`;
    const token = await encode({ token: { id: "staff-1" }, secret: SECRET, salt: secureName, maxAge: EIGHT_HOURS_S });
    const res = await Auth(
      new Request("https://favo.hofmi.net/api/auth/session", { headers: { cookie: `${secureName}=${token}` } }),
      { ...authConfig, secret: SECRET, basePath: "/api/auth", trustHost: true }
    );
    const c = res.headers.getSetCookie().find((h) => h.startsWith(`${secureName}=`));
    expect(c).toBeDefined();
    expect(c).toMatch(/Max-Age=28800(;|$)/i);
    expect(c).toMatch(/Secure/);
  });

  it("the refreshed JWT inside the cookie also expires 8h out", async () => {
    const cookie = sessionCookie(await sessionResponse());
    const value = cookie.split(";")[0]!.slice(COOKIE.length + 1);
    const payload = await decode({ token: value, secret: SECRET, salt: COOKIE });
    const secsLeft = (payload!.exp as number) - Math.floor(Date.now() / 1000);
    expect(secsLeft).toBeGreaterThan(EIGHT_HOURS_S - 120);
    expect(secsLeft).toBeLessThanOrEqual(EIGHT_HOURS_S);
  });
});
