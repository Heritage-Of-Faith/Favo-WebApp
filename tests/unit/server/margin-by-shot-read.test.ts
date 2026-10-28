// AT-208 · REQ-139 · REQ-106 · REQ-109. The margin-by-shot read uses the same
// orders, states and revenue-day bucket as readPeriodCogs, the frozen
// order_cogs integers, and no ROUND and no IS NOT NULL filter. db.execute is
// mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@db/index", () => ({ db: { execute: vi.fn() } }));

type Exec = Awaited<ReturnType<typeof import("@db/index").db.execute>>;
const res = (rows: unknown[]) => rows as unknown as Exec;
const dialect = new PgDialect();

const row = (over: Record<string, unknown> = {}) => ({
  total_zar: 2000,
  cogs_zar: 1352,
  absent_item_ids: [],
  estimated: true,
  missing: false,
  coffee_shots: [2],
  day_mode: "sunday",
  ...over,
});

describe("readMarginByShot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads order_cogs and order_items.shots by revenue day — no ROUND, no IS NOT NULL filter", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(res([]));
    const { readMarginByShot } = await import("@/server/cogs/period-cogs");
    expect(await readMarginByShot("2026-08-10", "2026-08-16")).toEqual([]);
    const { sql: text, params } = dialect.sqlToQuery(
      vi.mocked(db.execute).mock.calls[0][0] as Parameters<typeof dialect.sqlToQuery>[0]
    );
    expect(text).toContain("order_cogs");
    expect(text).toContain("oi.shots");
    expect(text).toContain("'bean'");
    expect(text).toContain("opening_sessions");
    expect(text).toContain("revenue_day");
    expect(text).toContain("'in_progress', 'ready', 'collected'");
    expect(text).not.toMatch(/ROUND/i);
    expect(text).not.toMatch(/IS NOT NULL/i);
    expect(params).toEqual(["2026-08-10", "2026-08-16"]);
  });

  it("FIXTURE-A double-shot orders: 5 × 1352 + 2 × 2704 = R121.68 on R180.00 (PRD L1883–1886)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(
      res([
        ...Array.from({ length: 5 }, () => row()),
        row({ total_zar: "4000", cogs_zar: 2704, coffee_shots: ["2"] }),
        row({ total_zar: 4000, cogs_zar: 2704 }),
      ])
    );
    const { readMarginByShot } = await import("@/server/cogs/period-cogs");
    const [two] = await readMarginByShot("2026-08-16", "2026-08-16");
    expect(two).toMatchObject({ bucket: 2, revenueZar: 18000, cogsZar: 12168, grossMarginZar: 5832, costState: "provisional", tone: "warn" });
  });

  it("a weekday free cup (total_zar 0) gets its own weekday bucket, not the Sunday one", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(
      res([row(), row({ total_zar: 0, revenue_day: "2026-08-17", day_mode: "weekday" })])
    );
    const { readMarginByShot } = await import("@/server/cogs/period-cogs");
    const rows = await readMarginByShot("2026-08-16", "2026-08-17");
    expect(rows.map((r) => [r.mode, r.bucket, r.revenueZar, r.cogsZar])).toEqual([
      ["sunday", 2, 2000, 1352],
      ["weekday", 2, 0, 1352],
    ]);
  });

  it("an absent input names the item by its inventory name on every bucket (REQ-109)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(
        res([row({ coffee_shots: [1] }), row({ cogs_zar: null, absent_item_ids: ["inv_oat"], coffee_shots: [2] })])
      )
      .mockResolvedValueOnce(res([{ id: "inv_oat", name: "Oat Milk" }]));
    const { readMarginByShot } = await import("@/server/cogs/period-cogs");
    const rows = await readMarginByShot("2026-08-16", "2026-08-16");
    expect(rows.map((r) => [r.bucket, r.costState, r.absentItemNames])).toEqual([
      [1, "unavailable", ["Oat Milk"]],
      [2, "unavailable", ["Oat Milk"]],
    ]);
  });
});
