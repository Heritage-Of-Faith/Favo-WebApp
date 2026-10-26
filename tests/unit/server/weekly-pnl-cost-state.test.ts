// AT-189 · AT-190 · AT-192 — REQ-106, REQ-109, REQ-129, REQ-131.
// The weekly summary stores Σ order_cogs over its seven revenue days, and its
// cost state: UNAVAILABLE (cogs NULL, items named) or provisional — never a
// silently smaller number, never green on estimates. db is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const inserted: Record<string, unknown>[] = [];
let selectCall = 0;
const selectResults: unknown[][] = [];

vi.mock("@db/index", () => ({
  db: {
    execute: vi.fn(),
    select: vi.fn().mockImplementation(() => {
      const rows = selectResults[selectCall++] ?? [];
      const c: Record<string, unknown> = {};
      c.from = () => c;
      c.where = () => Promise.resolve(rows);
      return c;
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return { returning: () => Promise.resolve([{ id: "wr_1" }]) };
      },
    })),
  },
}));

type Exec = Awaited<ReturnType<typeof import("@db/index").db.execute>>;
const res = (rows: unknown[]) => rows as unknown as Exec;

describe("generateWeeklyPnL — cost state (AT-192)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserted.length = 0;
    selectCall = 0;
    selectResults.length = 0;
  });

  // Sunday 2026-08-16 belongs to the week starting Monday 2026-08-10.
  const SUNDAY = new Date("2026-08-16T10:00:00+02:00");

  it("an absent input stores the week UNAVAILABLE: cogs, margin and net NULL, the item named", async () => {
    selectResults.push([], [{ total: 35000 }], [{ total: 0 }]); // existing?, revenue, expenses
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(
        res([
          { revenue_day: "2026-08-16", cogs_zar: 1352, absent_item_ids: [], estimated: true, missing: false },
          { revenue_day: "2026-08-16", cogs_zar: null, absent_item_ids: ["inv_item_oat_milk"], estimated: true, missing: false },
        ])
      )
      .mockResolvedValueOnce(res([{ id: "inv_item_oat_milk", name: "Oat Milk" }]));
    const { generateWeeklyPnL } = await import("@/server/crons/generate-weekly-pnl");
    await generateWeeklyPnL(SUNDAY);
    expect(inserted[0]).toMatchObject({
      weekStarting: "2026-08-10",
      revenueZar: 35000,
      cogsZar: null,
      grossMarginZar: null,
      netZar: null,
      costState: "unavailable",
      cogsAbsentItems: ["Oat Milk"],
    });
  });

  it("estimated lots store the week provisional; Σ order_cogs over Mon..Sun revenue days", async () => {
    selectResults.push([], [{ total: 35000 }], [{ total: 0 }]);
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(
      res([
        { revenue_day: "2026-08-16", cogs_zar: 529, absent_item_ids: [], estimated: true, missing: false },
        { revenue_day: "2026-08-16", cogs_zar: 1059, absent_item_ids: [], estimated: false, missing: false },
      ])
    );
    const { generateWeeklyPnL } = await import("@/server/crons/generate-weekly-pnl");
    await generateWeeklyPnL(SUNDAY);
    expect(inserted[0]).toMatchObject({ cogsZar: 1588, grossMarginZar: 33412, netZar: 33412, costState: "provisional" });
    const { params } = new PgDialect().sqlToQuery(
      vi.mocked(db.execute).mock.calls[0][0] as Parameters<PgDialect["sqlToQuery"]>[0]
    );
    expect(params).toEqual(["2026-08-10", "2026-08-16"]);
  });
});
