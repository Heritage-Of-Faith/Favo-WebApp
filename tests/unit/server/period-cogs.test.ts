// AT-189 · AT-190 · AT-192 — REQ-106, REQ-109, REQ-129. PRD §7.0.2 L1790
// "cogs_zar = Σ order_cogs" and the refusal rule L1791–1795.
//
// The period read sums frozen per-order integers — never ROUND(SUM(...)) over
// stock movements, never `unit_cost_zar IS NOT NULL`. db.execute is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@db/index", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => Promise.resolve([]);
    return c;
  };
  return {
    db: {
      execute: vi.fn(),
      select: vi.fn().mockImplementation(chain),
      insert: vi.fn(),
    },
  };
});

type Exec = Awaited<ReturnType<typeof import("@db/index").db.execute>>;
const res = (rows: unknown[]) => rows as unknown as Exec;
const dialect = new PgDialect();

const cogsRow = (over: Record<string, unknown> = {}) => ({
  revenue_day: "2026-08-16",
  cogs_zar: 1352,
  absent_item_ids: [],
  estimated: true,
  missing: false,
  ...over,
});

describe("readPeriodCogs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FIXTURE-A: the thirteen order integers sum to 19636, provisional (REQ-106, REQ-110)", async () => {
    const { db } = await import("@db/index");
    // PRD §7.0.3 table L1883–1889, typed in.
    const thirteen = [1352, 1352, 1352, 1352, 1352, 2382, 441, 2704, 2704, 743, 743, 2128, 1031];
    vi.mocked(db.execute).mockResolvedValueOnce(res(thirteen.map((c) => cogsRow({ cogs_zar: c }))));
    const { readPeriodCogs } = await import("@/server/cogs/period-cogs");
    const r = await readPeriodCogs("2026-08-16", "2026-08-16");
    expect(r.cogsZar).toBe(19636);
    expect(r.state).toBe("provisional");
    expect(r.orderCount).toBe(13);
  });

  it("reads order_cogs by revenue day, binding ::date strings — no period ROUND, no IS NOT NULL filter", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(res([]));
    const { readPeriodCogs } = await import("@/server/cogs/period-cogs");
    await readPeriodCogs("2026-08-01", "2026-08-31");
    const { sql: text, params } = dialect.sqlToQuery(
      vi.mocked(db.execute).mock.calls[0][0] as Parameters<typeof dialect.sqlToQuery>[0]
    );
    expect(text).toContain("order_cogs");
    expect(text).toContain("::date");
    expect(text).not.toMatch(/ROUND/i);
    expect(text).not.toMatch(/IS NOT NULL/i);
    expect(params).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("an absent cost input → UNAVAILABLE with the item named by its inventory name (REQ-109)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(
        res([cogsRow(), cogsRow({ cogs_zar: null, absent_item_ids: ["inv_item_oat_milk"] })])
      )
      .mockResolvedValueOnce(res([{ id: "inv_item_oat_milk", name: "Oat Milk" }]));
    const { readPeriodCogs } = await import("@/server/cogs/period-cogs");
    const r = await readPeriodCogs("2026-08-16", "2026-08-16");
    expect(r.state).toBe("unavailable");
    expect(r.cogsZar).toBeNull();
    expect(r.absentItemNames).toEqual(["Oat Milk"]);
  });

  it("an order with no order_cogs row → UNAVAILABLE, never silently dropped", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(
      res([cogsRow(), cogsRow({ cogs_zar: null, estimated: null, missing: true })])
    );
    const { readPeriodCogs } = await import("@/server/cogs/period-cogs");
    const r = await readPeriodCogs("2026-08-16", "2026-08-16");
    expect(r).toMatchObject({ state: "unavailable", cogsZar: null, ordersWithoutCost: 1 });
  });

  it("no orders → empty, a genuine zero (REQ-129)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(res([]));
    const { readPeriodCogs } = await import("@/server/cogs/period-cogs");
    expect(await readPeriodCogs("2026-08-17", "2026-08-17")).toMatchObject({ state: "empty", cogsZar: 0 });
  });
});

describe("readDailyCogs", () => {
  it("one rollup per revenue day; each day refuses on its own", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(
        res([
          cogsRow({ revenue_day: "2026-08-16", cogs_zar: 529 }),
          cogsRow({ revenue_day: "2026-08-16", cogs_zar: 1059 }),
          cogsRow({ revenue_day: "2026-08-17", cogs_zar: null, absent_item_ids: ["inv_item_oat_milk"] }),
        ])
      )
      .mockResolvedValueOnce(res([{ id: "inv_item_oat_milk", name: "Oat Milk" }]));
    const { readDailyCogs } = await import("@/server/cogs/period-cogs");
    const days = await readDailyCogs("2026-08-16", "2026-08-17");
    expect(days.get("2026-08-16")).toMatchObject({ state: "provisional", cogsZar: 1588 }); // 529 + 1059, not re-rounded
    expect(days.get("2026-08-17")).toMatchObject({ state: "unavailable", cogsZar: null, absentItemNames: ["Oat Milk"] });
  });
});

describe("getCogsLive — the dashboard's day (AT-189/AT-192)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("COGS is Σ order_cogs; net is UNAVAILABLE (NULL) when an input is absent", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(res([{ revenue_zar: "35000" }])) // revenue
      .mockResolvedValueOnce(res([cogsRow({ cogs_zar: null, absent_item_ids: ["inv_item_oat_milk"] })]))
      .mockResolvedValueOnce(res([{ id: "inv_item_oat_milk", name: "Oat Milk" }]))
      .mockResolvedValueOnce(res([{ expenses_zar: "0" }]));
    const { getCogsLive } = await import("@/server/cogs/compute");
    const day = await getCogsLive("2026-08-16");
    expect(day).toMatchObject({
      revenueZar: 35000,
      cogsZar: null,
      grossMarginZar: null,
      netZar: null,
      costState: "unavailable",
      absentItems: ["Oat Milk"],
    });
  });

  it("a fully-costed day: revenue 35000 − Σ order_cogs 19636 = 15364 gross margin (FIXTURE-A, R153.64)", async () => {
    const { db } = await import("@db/index");
    const thirteen = [1352, 1352, 1352, 1352, 1352, 2382, 441, 2704, 2704, 743, 743, 2128, 1031];
    vi.mocked(db.execute)
      .mockResolvedValueOnce(res([{ revenue_zar: "35000" }]))
      .mockResolvedValueOnce(res(thirteen.map((c) => cogsRow({ cogs_zar: c }))))
      .mockResolvedValueOnce(res([{ expenses_zar: "0" }]));
    const { getCogsLive } = await import("@/server/cogs/compute");
    const day = await getCogsLive("2026-08-16");
    expect(day.cogsZar).toBe(19636);
    expect(day.grossMarginZar).toBe(15364);
    expect(day.costState).toBe("provisional");
  });
});
