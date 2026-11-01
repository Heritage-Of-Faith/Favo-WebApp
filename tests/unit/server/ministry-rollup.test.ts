// AT-205 — REQ-112, REQ-113, REQ-114 · PRD §7.0.2 ROLLUP, §7.2, §11.2
// getMinistryRollup(from, to) — admin. db.execute is mocked and dispatched on
// the SQL text, so the reads may run in any order.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@db/index", () => ({ db: { execute: vi.fn() } }));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff-admin", name: "Admin", role: "admin" } }),
}));

const dialect = new PgDialect();

type Fixture = {
  cogs: Record<string, unknown>[];
  revenue: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  settled: Record<string, unknown>[];
  writer: boolean;
};

async function stub(f: Fixture) {
  const { db } = await import("@db/index");
  vi.mocked(db.execute).mockImplementation(((q: Parameters<typeof dialect.sqlToQuery>[0]) => {
    const text = dialect.sqlToQuery(q).sql;
    if (text.includes("FROM audit_log")) return Promise.resolve([{ exists: f.writer }]);
    if (text.includes("FROM opening_sessions")) return Promise.resolve(f.sessions);
    if (text.includes("JOIN payments")) return Promise.resolve(f.settled);
    if (text.includes("FROM expenses")) return Promise.resolve(f.expenses);
    if (text.includes("LEFT JOIN order_cogs")) return Promise.resolve(f.cogs);
    if (text.includes("SUM(total_zar)")) return Promise.resolve(f.revenue);
    if (text.includes("FROM inventory_items")) return Promise.resolve([]);
    throw new Error(`unexpected query: ${text}`);
  }) as never);
}

const cogsRow = (day: string, cogs: number | null, estimated = true) => ({
  revenue_day: day,
  cogs_zar: cogs,
  absent_item_ids: cogs === null ? ["inv_oat"] : [],
  estimated,
  missing: false,
});

// FIXTURE-A, PRD §7.0.3: thirteen order integers summing to 19636 on R350.00.
const THIRTEEN = [1352, 1352, 1352, 1352, 1352, 2382, 441, 2704, 2704, 743, 743, 2128, 1031];

describe("getMinistryRollup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is admin only", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-01", "2026-08-31");
    expect(vi.mocked(authorize)).toHaveBeenCalledWith("admin");
    expect(res.ok).toBe(false);
  });

  it.each([
    ["a malformed date", "2026-8-1", "2026-08-31"],
    ["an impossible date", "2026-02-30", "2026-03-01"],
    ["from after to", "2026-08-31", "2026-08-01"],
  ])("rejects %s", async (_l, from, to) => {
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup(from, to);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("weekday cost + expenses = ministry_cost; FIXTURE-A Sunday's unrecorded fees make income UNAVAILABLE", async () => {
    await stub({
      cogs: [...THIRTEEN.map((c) => cogsRow("2026-08-16", c)), cogsRow("2026-08-17", 529), cogsRow("2026-08-17", 1059)],
      revenue: [{ revenue_day: "2026-08-16", revenue_zar: 35000 }, { revenue_day: "2026-08-17", revenue_zar: 0 }],
      expenses: [{ sast_date: "2026-08-03", expenses_zar: 250000 }],
      sessions: [{ session_date: "2026-08-16", mode: "sunday" }, { session_date: "2026-08-17", mode: "weekday" }],
      settled: [{ revenue_day: "2026-08-16", n: 13 }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-01", "2026-08-31");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.weekdayCogsZar).toBe(1588);
    expect(res.data.expensesZar).toBe(250000);
    expect(res.data.ministryCostZar).toBe(251588);
    expect(res.data.ministryIncomeZar).toBeNull();
    expect(res.data.ministryNetZar).toBeNull();
    expect(res.data.paidDays).toEqual([
      { date: "2026-08-16", grossZar: 35000, cogsZar: 19636, processingFeeZar: null, contributionZar: null },
    ]);
    expect(res.data.unavailable).toContainEqual({ kind: "fee_unrecorded", date: "2026-08-16" });
    expect(res.data.state).toBe("unavailable");
  });

  it("REQ-114: no expense ever logged → ministry_cost UNAVAILABLE", async () => {
    await stub({
      cogs: [cogsRow("2026-08-17", 529)],
      revenue: [{ revenue_day: "2026-08-17", revenue_zar: 0 }],
      expenses: [],
      sessions: [{ session_date: "2026-08-17", mode: "weekday" }],
      settled: [],
      writer: false,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-17", "2026-08-17");
    expect(res.ok && res.data.ministryCostZar).toBeNull();
    expect(res.ok && res.data.unavailable).toContainEqual({ kind: "no_expense_writer" });
  });

  it("an R0 Sunday (no settled order) has a recorded fee of zero, so contribution computes", async () => {
    await stub({
      cogs: [cogsRow("2026-08-16", 1352, false)],
      revenue: [{ revenue_day: "2026-08-16", revenue_zar: 0 }],
      expenses: [{ sast_date: "2026-08-16", expenses_zar: 1000 }],
      sessions: [{ session_date: "2026-08-16", mode: "sunday" }],
      settled: [],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.ministryIncomeZar).toBe(-1352);
    expect(res.data.ministryCostZar).toBe(1000);
    expect(res.data.ministryNetZar).toBe(-2352);
    expect(res.data.state).toBe("final");
    expect(res.data.tone).toBe("negative");
  });
});
