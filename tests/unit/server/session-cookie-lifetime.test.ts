// @vitest-environment node
// CHANGED (was: an 8-hour rolling cookie). REQ-061 / PRD §9.5.1: the staff
// session has a 12-hour ABSOLUTE ceiling and can never span two trading days
// (revenue day = midnight-to-midnight SAST, L07). Rolling refresh stays inside
// that ceiling. Drives the real Auth.js core with our authConfig (no network, no DB).
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { Auth } from "@auth/core";
import { encode, decode } from "@auth/core/jwt";
import { authConfig } from "../../../auth";

const TWELVE_HOURS_S = 12 * 60 * 60;
const SECRET = "test-secret-for-session-cookie-lifetime";
const COOKIE = "authjs.session-token";

afterEach(() => vi.useRealTimers());

async function sessionResponse(claims: Record<string, unknown>, origin = "http://localhost:3000", name = COOKIE) {
  const token = await encode({
    token: { id: "staff-1", role: "barista", name: "Louis", ...claims },
    secret: SECRET,
    salt: name,
    maxAge: TWELVE_HOURS_S,
  });
  const req = new Request(`${origin}/api/auth/session`, { headers: { cookie: `${name}=${token}` } });
  return Auth(req, { ...authConfig, secret: SECRET, basePath: "/api/auth", trustHost: true });
}

function sessionCookie(res: Response, name = COOKIE): string | undefined {
  return res.headers.getSetCookie().find((h) => h.startsWith(`${name}=`));
}

const isCleared = (c: string | undefined) => !!c && (/Max-Age=0(;|$)/i.test(c) || c.startsWith(`${COOKIE}=;`));

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("staff session: 12-hour absolute ceiling, one trading day", () => {
  it("configures session, JWT and cookie maxAge as 12 hours", () => {
    expect(authConfig.session?.maxAge).toBe(TWELVE_HOURS_S);
    expect(authConfig.jwt?.maxAge).toBe(TWELVE_HOURS_S);
  });

  it("the sign-in jwt callback stamps loginAt", async () => {
    at("2026-10-25T08:00:00+02:00");
    const token = await authConfig.callbacks!.jwt!({
      token: {},
      user: { id: "staff-1", role: "barista" } as never,
      account: null,
    } as never);
    expect(token).toMatchObject({ id: "staff-1", loginAt: Date.parse("2026-10-25T08:00:00+02:00") });
  });

  it("inside the ceiling: session kept, cookie refreshed with Max-Age=43200", async () => {
    at("2026-10-25T09:00:00+02:00");
    const res = await sessionResponse({ loginAt: Date.parse("2026-10-25T08:00:00+02:00") });
    const body = await res.json();
    expect(body?.user?.id).toBe("staff-1");
    const c = sessionCookie(res);
    expect(c).toMatch(/Max-Age=43200(;|$)/i);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    const payload = await decode({ token: c!.split(";")[0]!.slice(COOKIE.length + 1), secret: SECRET, salt: COOKIE });
    expect(payload?.loginAt).toBe(Date.parse("2026-10-25T08:00:00+02:00"));
  });

  it("12 hours after loginAt the session ends, even though it was used a minute ago", async () => {
    at("2026-10-25T18:00:01+02:00");
    // Same trading day, but 12h00m01s after a 06:00 sign-in.
    const res = await sessionResponse({ loginAt: Date.parse("2026-10-25T06:00:00+02:00") });
    expect(await res.json()).toBeNull();
    expect(isCleared(sessionCookie(res))).toBe(true);
  });

  it("a session never spans two trading days: 23:30 SAST sign-in ends at SAST midnight", async () => {
    at("2026-10-26T00:00:30+02:00");
    const res = await sessionResponse({ loginAt: Date.parse("2026-10-25T23:30:00+02:00") });
    expect(await res.json()).toBeNull();
    expect(isCleared(sessionCookie(res))).toBe(true);
  });

  it("the day boundary is SAST, not UTC: 01:30 SAST sign-in (23:30 UTC the day before) survives to 03:00 SAST", async () => {
    at("2026-10-26T03:00:00+02:00");
    const res = await sessionResponse({ loginAt: Date.parse("2026-10-26T01:30:00+02:00") });
    expect((await res.json())?.user?.id).toBe("staff-1");
  });

  it("a token without loginAt (issued before this rule) is ended", async () => {
    const res = await sessionResponse({});
    expect(await res.json()).toBeNull();
  });

  it("keeps the __Secure- cookie name on https", async () => {
    at("2026-10-25T09:00:00+02:00");
    const secureName = `__Secure-${COOKIE}`;
    const res = await sessionResponse({ loginAt: Date.parse("2026-10-25T08:00:00+02:00") }, "https://favo.hofmi.net", secureName);
    const c = sessionCookie(res, secureName);
    expect(c).toMatch(/Max-Age=43200(;|$)/i);
    expect(c).toMatch(/Secure/);
  });
});
