// AT-189..192: 0038 (period cost states, drop v_daily_cogs) and 0039
// (inventory_lots.cost_source) ship with tested downs (PRD §14, "Rollback
// strategies").
//
// MIGRATION NUMBERS ARE PROVISIONAL — see the headers of
// drizzle/0038_at189_period_cogs_states.sql and drizzle/0039_at191_lot_cost_source.sql.
// Renumber this file with them.
//
// Runs against the CI test DB, already migrated through 0039. Every case runs
// in ONE transaction that is always rolled back.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

class Rollback extends Error {}

async function columns(tx: TransactionSql, table: string): Promise<Record<string, string>> {
  const rows = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return Object.fromEntries(rows.map((r) => [r.column_name as string, r.is_nullable as string]));
}

maybe("0038/0039: up → down → up, and the refusals (AT-189..192)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  beforeAll(() => {
    sql = connect();
  });
  afterAll(async () => {
    await sql.end();
  });

  it("migrated: cost_source is NOT NULL DEFAULT 'estimate'; report cogs nullable; v_daily_cogs gone", async () => {
    await inRolledBackTx(async (tx) => {
      expect((await columns(tx, "inventory_lots")).cost_source).toBe("NO");
      const weekly = await columns(tx, "weekly_reports");
      expect(weekly.cogs_zar).toBe("YES");
      expect(weekly.cost_state).toBe("NO");
      expect(weekly.cogs_absent_items).toBe("NO");
      expect(weekly.orders_without_cost).toBe("NO");
      expect((await columns(tx, "monthly_reports")).orders_without_cost).toBe("NO");
      const monthly = await columns(tx, "monthly_reports");
      expect(monthly.net_zar).toBe("YES");
      expect(monthly.cost_state).toBe("NO");
      const [v] = await tx`SELECT to_regclass('public.v_daily_cogs') AS t`;
      expect(v.t).toBeNull();
    });
  });

  it("a new lot defaults to cost_source 'estimate' (PRD §7.0.1b)", async () => {
    await inRolledBackTx(async (tx) => {
      const [item] = await tx`
        INSERT INTO inventory_items (name, kind, unit) VALUES ('AT-191 Beans', 'bean', 'cup') RETURNING id`;
      const [lot] = await tx`
        INSERT INTO inventory_lots (inventory_item_id, unit_cost_zar) VALUES (${item.id}, 321.4286)
        RETURNING cost_source`;
      expect(lot.cost_source).toBe("estimate");
    });
  });

  it("a weekly report with NULL cogs must be 'unavailable', and a number may not be", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`
        INSERT INTO weekly_reports (week_starting, revenue_zar, cogs_zar, expenses_zar, gross_margin_zar, net_zar, cost_state, cogs_absent_items)
        VALUES ('2099-01-05', 35000, NULL, 0, NULL, NULL, 'unavailable', ARRAY['Oat Milk'])`;
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO weekly_reports (week_starting, revenue_zar, cogs_zar, expenses_zar, gross_margin_zar, net_zar, cost_state)
          VALUES ('2099-01-12', 35000, NULL, 0, NULL, NULL, 'provisional')`)
      ).rejects.toThrow(/weekly_report_cogs_or_unavailable/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO weekly_reports (week_starting, revenue_zar, cogs_zar, expenses_zar, gross_margin_zar, net_zar, cost_state)
          VALUES ('2099-01-19', 35000, 19636, 0, 15364, 15364, 'unavailable')`)
      ).rejects.toThrow(/weekly_report_cogs_or_unavailable/);
    });
  });

  it("down 0039 → down 0038 → up 0038 → up 0039 round-trips", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql("down/0039_at191_lot_cost_source.down.sql"));
      expect((await columns(tx, "inventory_lots")).cost_source).toBeUndefined();
      await tx.unsafe(migrationSql("down/0038_at189_period_cogs_states.down.sql"));
      const weekly = await columns(tx, "weekly_reports");
      expect(weekly.cogs_zar).toBe("NO");
      expect(weekly.cost_state).toBeUndefined();
      await tx.unsafe(migrationSql("0038_at189_period_cogs_states.sql"));
      await tx.unsafe(migrationSql("0039_at191_lot_cost_source.sql"));
      expect((await columns(tx, "inventory_lots")).cost_source).toBe("NO");
      expect((await columns(tx, "weekly_reports")).cost_state).toBe("NO");
    });
  });
});
