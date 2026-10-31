// AT-188: 0035 (order_cogs) ships with a tested `down` (PRD §14, "Rollback
// strategies": every Drizzle migration ships with a tested `down`).
//
// Renumbered 0034 -> 0035 (0034 is walk_ins, PR #265) — see the header of
// drizzle/0035_at188_order_cogs.sql.
//
// Runs against the CI test DB, which has already been migrated to 0035. Every
// case runs inside ONE transaction that is always rolled back, so the DB is
// left exactly as found for the other suites and the E2E step.
//
// What it proves:
//   - the migrated order_cogs table matches the 0035 snapshot, and `orders`
//     is untouched by 0035 (same shape in the 0034 and 0035 snapshots);
//   - `down` removes order_cogs and forgets 0035 in drizzle's ledger; `up`
//     brings it back to the snapshot;
//   - the database refuses: an order_cogs row for no order (FK); a second row
//     for one order (PK); a NULL cogs_zar with no absent item named; a number
//     beside a named absent item; a negative cogs_zar;
//   - ON CONFLICT (order_id) DO NOTHING keeps the first row (a retry never
//     rewrites it), and recosting the lot afterwards leaves the row as it was
//     (frozen at the sale).
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0035_at188_order_cogs.sql";
const DOWN = "down/0035_at188_order_cogs.down.sql";
const WHEN_0035 = 1792752696811; // drizzle/meta/_journal.json, idx 35
// L28: 0040 adds orders.notification_target on top of this; stepped down first.
const DOWN_0040 = "down/0040_l28_notification_target.down.sql";

type Shape = { columns: string[]; constraints: string[]; indexes: string[] };

type SnapshotTable = {
  columns: Record<string, { name: string; notNull: boolean }>;
  foreignKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, unknown>;
  checkConstraints?: Record<string, unknown>;
  indexes: Record<string, unknown>;
};

function snapshotShape(file: string, table: string): Shape {
  const path = resolve(process.cwd(), "drizzle", "meta", file);
  const snap = JSON.parse(readFileSync(path, "utf8")) as { tables: Record<string, SnapshotTable> };
  const t = snap.tables[`public.${table}`];
  return {
    columns: Object.values(t.columns).map((c) => c.name + (c.notNull ? "!" : "")).sort(),
    constraints: [
      ...Object.keys(t.foreignKeys),
      ...Object.keys(t.uniqueConstraints),
      ...Object.keys(t.checkConstraints ?? {}),
    ].sort(),
    indexes: Object.keys(t.indexes).sort(),
  };
}

async function dbShape(tx: TransactionSql, table: string): Promise<Shape> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  const cons = await tx`
    SELECT conname FROM pg_constraint
    WHERE conrelid = ${"public." + table}::regclass AND contype IN ('f', 'u', 'c')`;
  const idx = await tx`
    SELECT c.relname FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = ${"public." + table}::regclass
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x')
      )`;
  return {
    columns: cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort(),
    constraints: cons.map((r) => r.conname as string).sort(),
    indexes: idx.map((r) => r.relname as string).sort(),
  };
}

async function tableExists(tx: TransactionSql, table: string): Promise<boolean> {
  const [row] = await tx`SELECT to_regclass(${"public." + table}) AS t`;
  return row.t !== null;
}

async function ledgerHas0035(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0035}`;
  return rows.length > 0;
}

class Rollback extends Error {}

maybe("0035 order_cogs: up → down → up, and the refusals (AT-188)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        // CI now migrates past 0040, which adds a column to orders. Step it
        // back (rolled back with everything else) so orders reads as 0035 left it.
        await tx.unsafe(migrationSql(DOWN_0040));
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** A staff row, an order and a priced lot — rolled back with everything else. */
  async function fixtures(tx: TransactionSql) {
    const [staff] = await tx`
      INSERT INTO staff (name, role, pin_hash) VALUES ('AT-188 Barista', 'barista', 'x') RETURNING id`;
    const [order] = await tx`
      INSERT INTO orders (staff_id, total_zar, revenue_day)
      VALUES (${staff.id}, 2000, '2026-08-16') RETURNING id`;
    const [item] = await tx`
      INSERT INTO inventory_items (name, kind, unit) VALUES ('AT-188 Beans', 'bean', 'cup') RETURNING id`;
    const [lot] = await tx`
      INSERT INTO inventory_lots (inventory_item_id, unit_cost_zar)
      VALUES (${item.id}, 529.4118) RETURNING id`;
    return { staff, order, item, lot };
  }

  beforeAll(() => {
    sql = connect();
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("the migrated DB has order_cogs at 0035, and orders is untouched", async () => {
    await inRolledBackTx(async (tx) => {
      expect({ table: "order_cogs", ...(await dbShape(tx, "order_cogs")) }).toEqual({
        table: "order_cogs",
        ...snapshotShape("0035_snapshot.json", "order_cogs"),
      });
      expect(snapshotShape("0035_snapshot.json", "orders")).toEqual(snapshotShape("0034_snapshot.json", "orders"));
      expect(await dbShape(tx, "orders")).toEqual(snapshotShape("0035_snapshot.json", "orders"));
    });
  });

  it("down removes order_cogs and its ledger row; up again restores the 0035 shape", async () => {
    await inRolledBackTx(async (tx) => {
      const ledgerBefore = await ledgerHas0035(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(await tableExists(tx, "order_cogs")).toBe(false);
      expect(await dbShape(tx, "orders")).toEqual(snapshotShape("0034_snapshot.json", "orders"));
      if (ledgerBefore !== null) expect(await ledgerHas0035(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await dbShape(tx, "order_cogs")).toEqual(snapshotShape("0035_snapshot.json", "order_cogs"));
    });
  });

  it("after up → down → up, the database refuses what 0035 forbids", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      await tx.unsafe(migrationSql(UP));
      const { order, item } = await fixtures(tx);

      // Defaults: no absent item, estimated unknown (NULL — AT-191 sets it).
      const [row] = await tx`
        INSERT INTO order_cogs (order_id, cogs_zar) VALUES (${order.id}, 529)
        RETURNING cogs_zar, absent_item_ids, estimated, tenant_id`;
      expect(row).toEqual({ cogs_zar: 529, absent_item_ids: [], estimated: null, tenant_id: "hofmi" });

      // PK: one row per order.
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO order_cogs (order_id, cogs_zar) VALUES (${order.id}, 1059)`)
      ).rejects.toThrow(/order_cogs_pkey/);

      // FK: no row for an order that does not exist.
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO order_cogs (order_id, cogs_zar) VALUES ('no-such-order', 1)`)
      ).rejects.toThrow(/order_cogs_order_id_orders_id_fk/);

      // UNAVAILABLE is NULL + the named item; never a fake zero, never a number beside it.
      const [o2] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day)
        SELECT staff_id, 2000, '2026-08-16' FROM orders WHERE id = ${order.id} RETURNING id`;
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO order_cogs (order_id, cogs_zar) VALUES (${o2.id}, NULL)`)
      ).rejects.toThrow(/order_cogs_amount_or_absent/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO order_cogs (order_id, cogs_zar, absent_item_ids) VALUES (${o2.id}, 0, ${sql.array([item.id])})`)
      ).rejects.toThrow(/order_cogs_amount_or_absent/);
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO order_cogs (order_id, cogs_zar) VALUES (${o2.id}, -1)`)
      ).rejects.toThrow(/order_cogs_nonnegative/);
      const [absent] = await tx`
        INSERT INTO order_cogs (order_id, cogs_zar, absent_item_ids)
        VALUES (${o2.id}, NULL, ${sql.array([item.id])}) RETURNING cogs_zar, absent_item_ids`;
      expect(absent).toEqual({ cogs_zar: null, absent_item_ids: [item.id] });
    });
  });

  it("a retry never rewrites the row, and a later recost does not restate it", async () => {
    await inRolledBackTx(async (tx) => {
      const { order, lot } = await fixtures(tx);
      await tx`INSERT INTO order_cogs (order_id, cogs_zar) VALUES (${order.id}, 1059)`;

      // The same statement writeOrderCogs issues, retried with another figure.
      await tx`
        INSERT INTO order_cogs (order_id, cogs_zar) VALUES (${order.id}, 9999)
        ON CONFLICT (order_id) DO NOTHING`;

      // Admin recost / closeContainer rewrites the lot's unit cost.
      await tx`UPDATE inventory_lots SET unit_cost_zar = 876.0000 WHERE id = ${lot.id}`;

      const rows = await tx`SELECT cogs_zar FROM order_cogs WHERE order_id = ${order.id}`;
      expect(rows).toEqual([{ cogs_zar: 1059 }]);
    });
  });
});
