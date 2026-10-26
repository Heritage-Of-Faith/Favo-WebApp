// AT-189 · AT-190 · AT-192 — REQ-106, REQ-109, REQ-129. generateMonthlyPnL
// stores Σ order_cogs over the month's revenue days with its cost state and
// the count of orders without a cost row (S3), and buckets revenue by
// orders.revenue_day exactly like COGS (N2). db is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const inserted: Record<string, unknown>[] = [];
const whereArgs: unknown[] = [];
let selectCall = 0;
const selectResults: unknown[][] = [];

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "s1", role: "admin", name: "Admin" } }),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@db/index", () => {
  const insert = vi.fn().mockImplementation(() => ({
    values: (v: Record<string, unknown>) => {
      inserted.push(v);
      return { returning: () => Promise.resolve([{ id: "mr_1" }]) };
    },
  }));
  return {
    db: {
      execute: vi.fn(),
      select: vi.fn().mockImplementation(() => {
        const rows = selectResults[selectCall++] ?? [];
        const c: Record<string, unknown> = {};
        c.from = () => c;
        c.where = (w: unknown) => {
          whereArgs.push(w);
          return Promise.resolve(rows);
        };
        return c;
      }),
      insert,
      transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({ insert })),
    },
  };
});

type Exec = Awaited<ReturnType<typeof import("@db/index").db.execute>>;
const res = (rows: unknown[]) => rows as unknown as Exec;

describe("generateMonthlyPnL — cost state and revenue bucket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserted.length = 0;
    whereArgs.length = 0;
    selectCall = 0;
    selectResults.length = 0;
  });

  it("stores UNAVAILABLE with the item named and the orders-without-cost count (S3)", async () => {
    selectResults.push([], [{ total: 35000 }]); // existing?, revenue
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(
        res([
          { revenue_day: "2026-08-16", cogs_zar: 1352, absent_item_ids: [], estimated: true, missing: false },
          { revenue_day: "2026-08-16", cogs_zar: null, absent_item_ids: ["inv_item_oat_milk"], estimated: true, missing: false },
          { revenue_day: "2026-08-02", cogs_zar: null, absent_item_ids: [], estimated: null, missing: true },
        ])
      )
      .mockResolvedValueOnce(res([{ id: "inv_item_oat_milk", name: "Oat Milk" }]));
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const r = await generateMonthlyPnL("2026-08-01");
    expect(r.ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      month: "2026-08-01",
      revenueZar: 35000,
      cogsZar: null,
      grossMarginZar: null,
      netZar: null,
      costState: "unavailable",
      cogsAbsentItems: ["Oat Milk"],
      ordersWithoutCost: 1,
    });
  });

  it("N2: revenue is bucketed by orders.revenue_day 2026-08-01..2026-08-31 (not placed_at), as COGS is", async () => {
    selectResults.push([], [{ total: 0 }]);
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(res([]));
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    await generateMonthlyPnL("2026-08-01");
    const dialect = new PgDialect();
    const rev = dialect.sqlToQuery(whereArgs[1] as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(rev.sql).toContain('"revenue_day"');
    expect(rev.sql).not.toContain("placed_at");
    expect(rev.params).toEqual(["2026-08-01", "2026-08-31"]);
    const cogs = dialect.sqlToQuery(vi.mocked(db.execute).mock.calls[0][0] as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(cogs.params).toEqual(["2026-08-01", "2026-08-31"]);
    expect(inserted[0]).toMatchObject({ costState: "empty", cogsZar: 0, ordersWithoutCost: 0 });
  });
});
