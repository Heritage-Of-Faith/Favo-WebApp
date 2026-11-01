// AT-209: 0034 (walk_ins) ships with a tested `down` (PRD §14, "Rollback
// strategies": every Drizzle migration ships with a tested `down`).
//
// Runs against the CI test DB, which `bun db:migrate` has already brought to
// 0034. Every case runs inside ONE transaction that is always rolled back, so
// the DB is left exactly as found for the other suites and the E2E step.
//
// What it proves:
//   - walk_ins matches the 0034 snapshot, and carries no identity column of
//     any kind (REQ-058, §6.5);
//   - after `down` walk_ins is gone and orders / menu_items / staff are
//     exactly as in the 0033 snapshot (0034 alters none of them);
//   - after `up` again walk_ins matches the 0034 snapshot;
//   - the database refuses quantity = 0 (CHECK quantity >= 1), and defaults
//     quantity to 1;
//   - REQ-116: an order with one walk-in line (qty 2) and one other line
//     (qty 1) gives walk_in_cups = 2 — the helper's exact SQL, on real Postgres.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { connect, hasRealDb, migrationSql } from "./helpers";
import { walkInCupsQuery } from "@/server/reports/walk-in-cups";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0034_at209_walk_ins.sql";
const DOWN = "down/0034_at209_walk_ins.down.sql";
// L28: 0042 adds orders.notification_target on top of this; stepped down first.
const DOWN_0042 = "down/0042_l28_notification_target.down.sql";
// AT-201 part 2a: 0044 adds orders.client_uuid and is newer still; stepped down before 0042.
const DOWN_0044 = "down/0044_at201_orders_client_uuid.down.sql";
// AT-209: 0045 re-creates v_daily_revenue over orders and payments.status, and
// adds FKs from waste_log to orders and audit_log to staff. It is the newest
// migration, so it steps down before all others (a view blocks ALTER COLUMN TYPE).
const DOWN_0045 = "down/0045_at209_comps_cancel_abandon.down.sql";
// AT-203: 0046 (the blessing fund; an FK and a UNIQUE on payments) is now the
// newest migration, so it steps down before 0045.
const DOWN_0046 = "down/0046_at203_blessing_fund.down.sql";

/** Tables walk_ins points at; 0034 must leave them exactly as 0033 did. */
const REFERENCED = ["orders", "menu_items", "staff"] as const;

type Shape = { columns: string[]; constraints: string[] };

type SnapshotTable = {
  columns: Record<string, { name: string; notNull: boolean }>;
  foreignKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, unknown>;
  checkConstraints?: Record<string, unknown>;
};

function snapshotShape(file: string, table: string): Shape {
  const path = resolve(process.cwd(), "drizzle", "meta", file);
  const snap = JSON.parse(readFileSync(path, "utf8")) as {
    tables: Record<string, SnapshotTable>;
  };
  const t = snap.tables[`public.${table}`];
  return {
    columns: Object.values(t.columns)
      .map((c) => c.name + (c.notNull ? "!" : ""))
      .sort(),
    constraints: [
      ...Object.keys(t.foreignKeys),
      ...Object.keys(t.uniqueConstraints),
      ...Object.keys(t.checkConstraints ?? {}),
    ].sort(),
  };
}

async function dbShape(tx: TransactionSql, table: string): Promise<Shape> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  const cons = await tx`
    SELECT conname FROM pg_constraint
    WHERE conrelid = ${"public." + table}::regclass AND contype IN ('f', 'u', 'c')`;
  return {
    columns: cols
      .map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : ""))
      .sort(),
    constraints: cons.map((r) => r.conname as string).sort(),
  };
}

async function tableExists(tx: TransactionSql, table: string): Promise<boolean> {
  const [row] = await tx`SELECT to_regclass(${"public." + table}) AS t`;
  return row.t !== null;
}

async function expectReferencedAt0033(tx: TransactionSql) {
  for (const table of REFERENCED) {
    expect({ table, ...(await dbShape(tx, table)) }).toEqual({
      table,
      ...snapshotShape("0033_snapshot.json", table),
    });
  }
}

async function expectWalkInsAt0034(tx: TransactionSql) {
  expect(await dbShape(tx, "walk_ins")).toEqual(snapshotShape("0034_snapshot.json", "walk_ins"));
}

class Rollback extends Error {}

maybe("0034 walk_ins: up → down → up, the CHECK, and REQ-116 (AT-209)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        // CI now migrates past 0042, which adds a column to orders (one of
        // REFERENCED). Step it back (rolled back with everything else) so
        // orders reads as 0033 left it. 0044 (orders.client_uuid) goes first,
        // newest first; 0043 touches payments only, so it stays. AT-209: 0045
        // (the newest; a view and an FK over orders) steps down before 0044.
        await tx.unsafe(migrationSql(DOWN_0046)); // AT-203: newest of all, first
        await tx.unsafe(migrationSql(DOWN_0045));
        await tx.unsafe(migrationSql(DOWN_0044));
        await tx.unsafe(migrationSql(DOWN_0042));
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
    await sql?.end({ timeout: 5 });
  });

  it("the migrated DB starts at 0034, and walk_ins has no identity column of any kind", async () => {
    await inRolledBackTx(async (tx) => {
      await expectWalkInsAt0034(tx);
      await expectReferencedAt0033(tx);
      const { columns } = await dbShape(tx, "walk_ins");
      expect(columns).toEqual([
        "at!", "category!", "id!", "logged_by_staff_id!", "menu_item_id!",
        "order_id!", "quantity!", "tenant_id!",
      ]);
      for (const c of columns) expect(c).not.toMatch(/customer|name|email|phone|surname/i);
    });
  });

  it("down drops walk_ins and leaves orders / menu_items / staff at 0033; up again restores it", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      expect(await tableExists(tx, "walk_ins")).toBe(false);
      await expectReferencedAt0033(tx);

      await tx.unsafe(migrationSql(UP));
      expect(await tableExists(tx, "walk_ins")).toBe(true);
      await expectWalkInsAt0034(tx);
      await expectReferencedAt0033(tx);
    });
  });

  it("after up → down → up: quantity defaults to 1, 0 is refused; REQ-116 counts only the walk-in line", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      await tx.unsafe(migrationSql(UP));

      const [staff] = await tx`
        INSERT INTO staff (name, role, pin_hash) VALUES ('AT-209 Barista', 'barista', 'x')
        RETURNING id`;
      const [americano] = await tx`
        INSERT INTO menu_items (name, category, current_price_zar)
        VALUES ('AT-209 Americano', 'coffee', 3000) RETURNING id`;
      const [cappuccino] = await tx`
        INSERT INTO menu_items (name, category, current_price_zar)
        VALUES ('AT-209 Cappuccino', 'coffee', 3800) RETURNING id`;
      // A revenue day no other suite uses, so the sum is this test's alone.
      const day = "2031-03-04";
      const [order] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day, payment_mode)
        VALUES (${staff.id}, 0, ${day}, 'free') RETURNING id`;
      await tx`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar)
        VALUES (${order.id}, ${americano.id}, 2, 3000), (${order.id}, ${cappuccino.id}, 1, 3800)`;

      const [dflt] = await tx`
        INSERT INTO walk_ins (order_id, menu_item_id, category, logged_by_staff_id)
        VALUES (${order.id}, ${americano.id}, 'coffee', ${staff.id}) RETURNING quantity`;
      expect(dflt.quantity).toBe(1);
      await tx`DELETE FROM walk_ins WHERE order_id = ${order.id}`;

      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO walk_ins (order_id, menu_item_id, quantity, category, logged_by_staff_id)
          VALUES (${order.id}, ${americano.id}, 0, 'coffee', ${staff.id})`)
      ).rejects.toThrow(/walk_ins_quantity_positive/);

      // REQ-116: one walk-in line (Americano ×2) beside one other line (Cappuccino ×1).
      await tx`
        INSERT INTO walk_ins (order_id, menu_item_id, quantity, category, logged_by_staff_id)
        VALUES (${order.id}, ${americano.id}, 2, 'coffee', ${staff.id})`;
      const q = walkInCupsQuery(drizzle.mock(), { fromDay: day, toDay: day }).toSQL();
      const [row] = await tx.unsafe(q.sql, q.params as string[]);
      expect(Number(row.cups)).toBe(2); // not 3, the order's total quantity
    });
  });
});
