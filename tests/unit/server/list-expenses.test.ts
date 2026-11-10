// REQ-114 · PRD §11.2, §10.7 — listExpenses, the /admin/expenses read: admin
// only, integer cents, the same SAST-day rule as readDailyExpenses (so the
// list sums to the figure the ministry rollup subtracts), and whether
// logExpense has ever written (REQ-114's "writer").

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute: h.execute, transaction: vi.fn() } }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff-admin", name: "Admin", role: "admin" } }),
}));

const dialect = new PgDialect();
const text = (q: unknown) => dialect.sqlToQuery(q as Parameters<typeof dialect.sqlToQuery>[0]).sql;

describe("listExpenses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks for the admin role; a barista is refused and nothing is read", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." });
    const { listExpenses } = await import("@/server/actions/expenses");
    const res = await listExpenses("2026-10-01", "2026-10-31");
    expect(vi.mocked(authorize)).toHaveBeenCalledWith("admin");
    expect(res.ok).toBe(false);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed date", "2026-10-1", "2026-10-31"],
    ["an impossible date", "2026-02-30", "2026-03-01"],
    ["from after to", "2026-10-31", "2026-10-01"],
  ])("rejects %s with VALIDATION", async (_l, from, to) => {
    const { listExpenses } = await import("@/server/actions/expenses");
    const res = await listExpenses(from, to);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("lists the period's expenses in integer cents, totals them, and reads the writer", async () => {
    h.execute.mockImplementation(async (q: unknown) => {
      const t = text(q);
      if (t.includes("FROM audit_log")) return [{ exists: true }];
      expect(t).toContain("AT TIME ZONE 'Africa/Johannesburg'");
      return [
        { id: "e2", category: "utilities", amount_zar: "85050", incurred_at: "2026-10-05T22:00:00.000Z", incurred_day: "2026-10-06", note: null, logged_by_name: "Admin" },
        { id: "e1", category: "rent", amount_zar: 250000, incurred_at: "2026-09-30T22:00:00.000Z", incurred_day: "2026-10-01", note: "October rent", logged_by_name: null },
      ];
    });
    const { listExpenses } = await import("@/server/actions/expenses");
    const res = await listExpenses("2026-10-01", "2026-10-31");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.expenses.map((e) => [e.id, e.amountZar, e.incurredDay])).toEqual([
      ["e2", 85050, "2026-10-06"],
      ["e1", 250000, "2026-10-01"],
    ]);
    expect(res.data.totalZar).toBe(335050);
    expect(res.data.anyEverLogged).toBe(true);
  });
});
