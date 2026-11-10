// REQ-064 / PRD §05 + the endpoint spec of record (docs/FAVO_PRD_v7.md, "Three
// endpoints had no baseline specification"): GET /api/admin/audit-coverage is
// admin-only and answers `200 {mutations, audited, coverage_pct, gaps:[...]}`.
// The access matrix row "GET /api/admin/unpaid-orders · /api/admin/audit-coverage"
// is ✔ for admin only. No secret query parameter (CLAUDE.md §4 defect 20).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let session: { id: string; name: string; role: "barista" | "admin" } | null = null;
vi.mock("@/lib/auth/session", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    getSession: vi.fn(async () => session),
    requireRole: vi.fn(async (...roles: string[]) => {
      if (!session) throw new Error("UNAUTHORIZED");
      if (!roles.includes(session.role)) throw new Error("FORBIDDEN");
      return session;
    }),
  };
});

let rows: { id: string; audited: boolean }[] = [];
const execute = vi.fn(async () => rows);
vi.mock("@/lib/db", () => ({ db: { execute: (...a: unknown[]) => execute(...(a as [])) } }));

import { GET } from "@/app/api/admin/audit-coverage/route";

const req = (qs = "") => new NextRequest(`https://favo.hofmi.net/api/admin/audit-coverage${qs}`);

beforeEach(() => {
  session = null;
  rows = [];
  execute.mockClear();
});

describe("GET /api/admin/audit-coverage — admin session gate", () => {
  it("no session → 401, and the database is never queried", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("no session but a ?secret= parameter → still 401 (the secret gate is gone)", async () => {
    const res = await GET(req("?secret=preflight-audit-secret"));
    expect(res.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("barista session → 403, and the database is never queried", async () => {
    session = { id: "staff_barista_sam", name: "Sam", role: "barista" };
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("admin session → 200", async () => {
    session = { id: "staff_manager_mia", name: "Mia", role: "admin" };
    const res = await GET(req());
    expect(res.status).toBe(200);
  });
});

describe("GET /api/admin/audit-coverage — response shape {mutations, audited, coverage_pct, gaps}", () => {
  beforeEach(() => {
    session = { id: "staff_manager_mia", name: "Mia", role: "admin" };
  });

  it("every mutation audited → 0 orphans, 100% coverage", async () => {
    rows = [
      { id: "ord_1", audited: true },
      { id: "ord_2", audited: true },
      { id: "ord_3", audited: true },
      { id: "ord_4", audited: true },
    ];
    const res = await GET(req());
    expect(await res.json()).toEqual({
      mutations: 4,
      audited: 4,
      coverage_pct: 100,
      gaps: [],
    });
  });

  it("one unaudited order out of four → 75%, and the gap names the order", async () => {
    rows = [
      { id: "ord_1", audited: true },
      { id: "ord_2", audited: false },
      { id: "ord_3", audited: true },
      { id: "ord_4", audited: true },
    ];
    const res = await GET(req());
    expect(await res.json()).toEqual({
      mutations: 4,
      audited: 3,
      coverage_pct: 75,
      gaps: ["ord_2"],
    });
  });

  it("no mutations in the window → 0 orphans, reported as 100%", async () => {
    rows = [];
    const res = await GET(req());
    expect(await res.json()).toEqual({
      mutations: 0,
      audited: 0,
      coverage_pct: 100,
      gaps: [],
    });
  });

  it("the old {ok, gapCount} keys are not in the response", async () => {
    rows = [{ id: "ord_1", audited: true }];
    const body = await (await GET(req())).json();
    expect(Object.keys(body).sort()).toEqual(["audited", "coverage_pct", "gaps", "mutations"]);
  });
});
