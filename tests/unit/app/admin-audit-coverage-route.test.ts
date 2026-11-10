// REQ-064 / PRD §05 + the endpoint spec of record (docs/FAVO_PRD_v7.md, "Three
// endpoints had no baseline specification"): GET /api/admin/audit-coverage is
// admin-only and answers `200 {mutations, audited, coverage_pct, gaps:[...]}`.
// The access matrix row "GET /api/admin/unpaid-orders · /api/admin/audit-coverage"
// is ✔ for admin only. No secret query parameter (CLAUDE.md §4 defect 20).

// REQ-064: "Given any mutation or any rejected action … /api/admin/audit-coverage
// returns 0 orphans". The endpoint measures rows created in seven tables
// (src/server/audit-coverage.ts); updates and refusals stay unmeasured.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

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

let rows: { entity: string; id: string; audited: boolean }[] = [];
const execute = vi.fn(async (_q?: SQL) => rows);
vi.mock("@/lib/db", () => ({ db: { execute: (q: SQL) => execute(q) } }));

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
      { entity: "order", id: "ord_1", audited: true },
      { entity: "payment", id: "pay_1", audited: true },
      { entity: "waste_log", id: "w_1", audited: true },
      { entity: "opening_session", id: "os_1", audited: true },
    ];
    const res = await GET(req());
    expect(await res.json()).toEqual({
      mutations: 4,
      audited: 4,
      coverage_pct: 100,
      gaps: [],
    });
  });

  it("one unaudited row out of four → 75%, and the gap names its entity and id", async () => {
    rows = [
      { entity: "order", id: "ord_1", audited: true },
      { entity: "order", id: "ord_2", audited: false },
      { entity: "walk_in", id: "wi_1", audited: true },
      { entity: "stock_take", id: "st_1", audited: true },
    ];
    const res = await GET(req());
    expect(await res.json()).toEqual({
      mutations: 4,
      audited: 3,
      coverage_pct: 75,
      gaps: ["order:ord_2"],
    });
  });

  it("no mutations in the window → 0 orphans, and coverage_pct null (nothing measured, no 100 claimed)", async () => {
    rows = [];
    const res = await GET(req());
    expect(await res.json()).toEqual({
      mutations: 0,
      audited: 0,
      coverage_pct: null,
      gaps: [],
    });
  });

  it("the old {ok, gapCount} keys are not in the response", async () => {
    rows = [{ entity: "order", id: "ord_1", audited: true }];
    const body = await (await GET(req())).json();
    expect(Object.keys(body).sort()).toEqual(["audited", "coverage_pct", "gaps", "mutations"]);
  });
});

describe("GET /api/admin/audit-coverage — what counts as a mutation (REQ-064)", () => {
  beforeEach(() => {
    session = { id: "staff_manager_mia", name: "Mia", role: "admin" };
  });

  async function renderedQuery() {
    await GET(req());
    const q = execute.mock.calls[0]?.[0];
    expect(q).toBeDefined();
    return new PgDialect().sqlToQuery(q as SQL);
  }

  it("measures rows created in the last 30 minutes in all seven tables, each against its own entity_kind", async () => {
    const { sql, params } = await renderedQuery();
    for (const [table, createdAt] of [
      ["orders", "placed_at"],
      ["payments", "at"],
      ["waste_log", "at"],
      ["walk_ins", "at"],
      ["stock_takes", "started_at"],
      ["opening_sessions", "created_at"],
      ["event_windows", "created_at"],
    ]) {
      expect(sql).toContain(`FROM "${table}" t`);
      expect(sql).toContain(`t."${createdAt}" > NOW() - INTERVAL '30 minutes'`);
    }
    for (const kind of ["order", "payment", "waste_log", "walk_in", "stock_take", "opening_session", "event_window"]) {
      expect(params).toContain(kind);
    }
    expect(sql.match(/UNION ALL/g)).toHaveLength(6);
    expect(sql).toContain("a.entity_id = t.id");
  });
});
