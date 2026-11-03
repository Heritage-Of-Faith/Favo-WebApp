// AT-203 / REQ-160 (L44, §10.7): a deep link to /admin/funds — the only place a
// cash or EFT top-up is recorded — is never served to a customer session, an
// anonymous visitor or a barista PIN session. proxy.ts is the route gate.
//
// What is asserted is that the page is NOT served. The PRD's literal "returns
// the admin 403 page" is not what happens today: no admin 403 page exists, and
// proxy.ts redirects every non-admin to /staff/login (reported, not changed).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let session: { user: { role?: "barista" | "admin" } } | null = null;
vi.mock("../../../auth", () => ({ auth: vi.fn(async () => session) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

import { proxy } from "../../../proxy";

const deepLink = () => new NextRequest("https://favo.hofmi.net/admin/funds");
const served = (res: Response) => res.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  session = null;
});

describe("REQ-160: /admin/funds is unreachable without an admin session", () => {
  it("a customer (Supabase session only — no staff session) is not served the page", async () => {
    session = null;
    const res = await proxy(deepLink());
    expect(served(res)).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).not.toContain("/admin/funds");
  });

  it("a barista PIN session is not served the page", async () => {
    session = { user: { role: "barista" } };
    const res = await proxy(deepLink());
    expect(served(res)).toBe(false);
    expect(res.headers.get("location")).not.toContain("/admin/funds");
  });

  it("an admin is served it", async () => {
    session = { user: { role: "admin" } };
    const res = await proxy(deepLink());
    expect(served(res)).toBe(true);
  });
});
