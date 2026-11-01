// AT-209 / L02, §11.3 cancelOrder: a started order can now be cancelled, and
// "cancelling a paid order corrects stock and the record, it does not return
// money". So revenue counts a cancelled order that holds a successful payment,
// and never a cancelled order without one. Every revenue read uses one
// predicate; the abandoned waste row is not counted as stock waste.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const executed: SQL[] = [];
vi.mock("@db/index", () => ({
  db: { execute: vi.fn(async (q: SQL) => { executed.push(q); return []; }) },
}));
vi.mock("@/lib/db", () => ({
  db: { execute: vi.fn(async (q: SQL) => { executed.push(q); return []; }) },
}));
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "s", name: "S", role: "admin" } })),
}));
vi.mock("@/server/cogs/compute", () => ({ todaySast: vi.fn(() => "2026-10-25") }));

import {
  REVENUE_ORDER_SCOPE_SQL, revenueOrderScope,
  CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL, cancelledWithSuccessfulPayment,
} from "@/server/reports/revenue-scope";
import { getPosToday } from "@/server/actions/pos-summary";
import { buildReportRows } from "@/server/reports/export-csv";

const dialect = new PgDialect();
const text = (q: SQL) => dialect.sqlToQuery(q).sql.replace(/\s+/g, " ");
const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("revenue scope (AT-209)", () => {
  it("started states, plus a cancelled order only when it holds a successful payment", () => {
    expect(REVENUE_ORDER_SCOPE_SQL).toBe(
      "(orders.state IN ('in_progress', 'ready', 'collected')" +
      " OR (orders.state = 'cancelled' AND EXISTS (" +
      "SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful')))"
    );
  });

  it("the drizzle fragment carries exactly the same text as the string constant", () => {
    const chunks = revenueOrderScope.queryChunks as unknown as { value: string[] }[];
    const joined = chunks.map((c) => c.value.join("")).join("");
    expect(joined.replace(/\s+/g, " ").trim()).toBe(REVENUE_ORDER_SCOPE_SQL);
  });

  it("the cancelled-with-payment case alone carries exactly its constant's text, and is the scope's second half", () => {
    const chunks = cancelledWithSuccessfulPayment.queryChunks as unknown as { value: string[] }[];
    const joined = chunks.map((c) => c.value.join("")).join("");
    expect(joined.replace(/\s+/g, " ").trim()).toBe(CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL);
    expect(REVENUE_ORDER_SCOPE_SQL).toBe(
      `(orders.state IN ('in_progress', 'ready', 'collected') OR ${CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL})`
    );
  });

  it("migration 0045 rewrites v_daily_revenue with the same predicate; its down restores 0004's", () => {
    const up = src("drizzle/0045_at209_comps_cancel_abandon.sql");
    expect(up).toContain("CREATE OR REPLACE VIEW v_daily_revenue AS");
    expect(up).toContain(`WHERE ${REVENUE_ORDER_SCOPE_SQL}`);
    const down = src("drizzle/down/0045_at209_comps_cancel_abandon.down.sql");
    expect(down).toContain("WHERE state IN ('in_progress', 'ready', 'collected')");
  });

  it("monthly and weekly P&L read revenue through readPeriodFigures, whose one revenue read uses the predicate", () => {
    for (const f of ["src/server/actions/monthly-pnl.ts", "src/server/crons/generate-weekly-pnl.ts"]) {
      const s = src(f);
      expect(s).toContain("readPeriodFigures");
      expect(s).not.toMatch(/state\} IN \('in_progress', 'ready', 'collected'\)/);
    }
  });

  it("readDailyRevenue (the one revenue read) uses the predicate", async () => {
    executed.length = 0;
    const { readDailyRevenue } = await import("@/server/cogs/period-cogs");
    await readDailyRevenue("2026-10-01", "2026-10-31");
    expect(text(executed[0])).toContain(`WHERE ${REVENUE_ORDER_SCOPE_SQL}`);
  });

  it("the ministry rollup's settled-orders read uses the predicate, so a day of only cancelled paid orders is not a silent R0 fee", async () => {
    const s = src("src/server/cogs/ministry-rollup.ts");
    expect(s).toContain("WHERE ${revenueOrderScope}");
    expect(s).not.toMatch(/o\.state IN \('in_progress', 'ready', 'collected'\)/);
  });

  it("the report export's revenue query uses the predicate", async () => {
    executed.length = 0;
    await buildReportRows("2026-10-25", "2026-10-25");
    expect(text(executed[0])).toContain(REVENUE_ORDER_SCOPE_SQL);
  });

  it("the POS Day summary's order count uses the same scope as v_daily_revenue", async () => {
    executed.length = 0;
    await getPosToday();
    const count = executed.map(text).find((q) => q.includes("COUNT(*)::text AS n FROM orders"));
    expect(count).toContain(REVENUE_ORDER_SCOPE_SQL);
  });

  it("the POS Day summary's waste count leaves out abandoned orders", async () => {
    executed.length = 0;
    await getPosToday();
    const waste = executed.map(text).find((q) => q.includes("FROM waste_log"));
    expect(waste).toContain("category <> 'abandoned'");
  });
});
