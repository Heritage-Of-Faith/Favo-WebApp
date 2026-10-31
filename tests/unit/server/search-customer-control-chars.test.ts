// SEC-5 — a NUL (or other control character) in the POS customer search must
// not reach Postgres (which rejects \u0000 in text and surfaces a bare 500).
import { describe, it, expect, vi, beforeEach } from "vitest";

const where = vi.fn().mockReturnThis();
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where,
      limit: vi.fn().mockResolvedValue([]),
    })),
  },
}));
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff-1", role: "barista" } }),
}));

import { db } from "@/lib/db";
import { searchCustomer } from "@/server/actions/customers";

beforeEach(() => vi.clearAllMocks());

function boundParams(): unknown[] {
  // Collect every value bound into the WHERE clause.
  const out: unknown[] = [];
  const walk = (n: unknown, seen = new Set<unknown>()) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if ("value" in (n as object) && typeof (n as { value: unknown }).value === "string") out.push((n as { value: string }).value);
    for (const v of Object.values(n as object)) walk(v, seen);
  };
  walk(where.mock.calls[0]?.[0]);
  return out;
}

describe("searchCustomer — control characters", () => {
  it("strips a NUL before querying, so no NUL is ever bound", async () => {
    const r = await searchCustomer("\u0000ab");
    expect(r.ok).toBe(true);
    expect(db.select).toHaveBeenCalledTimes(1);
    const params = boundParams();
    expect(params.length).toBeGreaterThan(0);
    for (const p of params) {
      expect(String(p)).not.toContain("\u0000");
      expect(String(p)).toContain("ab");
    }
  });

  it("a query that is only control characters gets the normal too-short message", async () => {
    const r = await searchCustomer("\u0000\u0000\u0007");
    expect(r).toEqual({ ok: false, code: "QUERY_TOO_SHORT", message: "Enter at least 2 characters." });
    expect(db.select).not.toHaveBeenCalled();
  });
});
