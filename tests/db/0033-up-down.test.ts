// AT-181: 0033 (Day 5 substrate) ships with a tested `down` (PRD §14,
// "Rollback strategies": every Drizzle migration ships with a tested `down`).
//
// Runs against the CI test DB, which `bun db:migrate` has already brought to
// 0033. Every case runs inside ONE transaction that is always rolled back, so
// the DB is left exactly as found for the other suites and the E2E step.
//
// What it proves:
//   - the starting schema of the six touched tables matches the 0033 snapshot;
//   - after `down` they match the 0032 snapshot (and the three new enums are gone);
//   - after `up` again they match the 0033 snapshot;
//   - 0033 refuses (and deletes nothing) over legacy staff-id entitlement rows;
//   - the database refuses: shots = 0 and shots = 5 (CHECK BETWEEN 1 AND 4);
//     discount_zar > quantity × (unit_price_zar + mods_zar); quantity = 0; an unknown
//     comp_reason;
//     a second 'successful' payment for one order (REQ-011); a second
//     entitlement row for the same (customer_id, day); an entitlement row whose
//     beneficiary is a staff id, not a customer id (FK to customers).
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0033_at181_day5_substrate.sql";
const DOWN = "down/0033_at181_day5_substrate.down.sql";
// AT-201: 0036 (orders.client_uuid) sits on top of 0035 (payments), which sits
// on top of 0034 (notification_target, PR #284), which sits on top of 0033.
// AT-209: 0043 re-creates v_daily_revenue over orders.state and payments.status;
// a view blocks ALTER COLUMN TYPE, so 0043 is stepped down first (newest first).
const DOWN_0043 = "down/0043_at209_comps_cancel_abandon.down.sql";
const DOWN_0036 = "down/0036_at201_orders_client_uuid.down.sql";
const DOWN_0035 = "down/0035_at201_tender_payments.down.sql";
const DOWN_0034 = "down/0034_l28_notification_target.down.sql";

const TOUCHED = [
  "customers",
  "opening_sessions",
  "order_items",
  "orders",
  "payments",
  "staff_entitlement_log",
] as const;

type Shape = {
  columns: string[]; // "name" + "!" when NOT NULL, sorted
  constraints: string[]; // FK, UNIQUE and CHECK constraint names, sorted
  indexes: string[]; // indexes not backing a PK/UNIQUE constraint, sorted
};

type SnapshotTable = {
  columns: Record<string, { name: string; notNull: boolean }>;
  foreignKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, unknown>;
  checkConstraints?: Record<string, unknown>;
  indexes: Record<string, unknown>;
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
    columns: cols
      .map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : ""))
      .sort(),
    constraints: cons.map((r) => r.conname as string).sort(),
    indexes: idx.map((r) => r.relname as string).sort(),
  };
}

/**
 * Constraints that exist in the database but in NO drizzle snapshot, because a
 * migration hand-added them outside db/schema.ts. Each touched table was
 * grepped across drizzle/*.sql for ADD CONSTRAINT / CREATE INDEX; this is the
 * only such object on the six tables. 0033 does not touch it, so it is simply
 * removed from the DB side before comparing.
 *   customers_auth_id_fk — drizzle/0013_loving_gamma_corps.sql:6, FK to
 *   auth.users (Supabase; CI stubs that table).
 */
const NOT_IN_SNAPSHOTS: Record<string, string[]> = {
  customers: ["customers_auth_id_fk"],
};

async function expectSchemaAt(tx: TransactionSql, snapshotFile: string) {
  for (const table of TOUCHED) {
    const live = await dbShape(tx, table);
    const known = NOT_IN_SNAPSHOTS[table] ?? [];
    expect({
      table,
      ...live,
      constraints: live.constraints.filter((c) => !known.includes(c)),
    }).toEqual({
      table,
      ...snapshotShape(snapshotFile, table),
    });
  }
}

async function enumExists(tx: TransactionSql, name: string): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = ${name}`;
  return rows.length > 0;
}

class Rollback extends Error {}

maybe("0033 Day 5 substrate: up → down → up, and the refusals (AT-181)", () => {
  let sql: Sql;

  /**
   * Run `fn` in a transaction that is always rolled back. `bun db:migrate`
   * brings the CI DB to 0043, so each case first steps 0043, 0036, 0035 and
   * 0034 down (inside the same rolled-back transaction) to start from 0033.
   */
  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(migrationSql(DOWN_0043));
        await tx.unsafe(migrationSql(DOWN_0036));
        await tx.unsafe(migrationSql(DOWN_0035));
        await tx.unsafe(migrationSql(DOWN_0034));
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

  it("the migrated DB starts at 0033", async () => {
    await inRolledBackTx(async (tx) => {
      await expectSchemaAt(tx, "0033_snapshot.json");
      expect(await enumExists(tx, "customer_status")).toBe(true);
      expect(await enumExists(tx, "session_mode")).toBe(true);
      expect(await enumExists(tx, "comp_reason")).toBe(true);
    });
  });

  it("down returns the touched tables to 0032; up again returns them to 0033", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      await expectSchemaAt(tx, "0032_snapshot.json");
      expect(await enumExists(tx, "customer_status")).toBe(false);
      expect(await enumExists(tx, "session_mode")).toBe(false);
      expect(await enumExists(tx, "comp_reason")).toBe(false);

      await tx.unsafe(migrationSql(UP));
      await expectSchemaAt(tx, "0033_snapshot.json");
      expect(await enumExists(tx, "customer_status")).toBe(true);
      expect(await enumExists(tx, "session_mode")).toBe(true);
      expect(await enumExists(tx, "comp_reason")).toBe(true);
    });
  });

  it("0033 refuses to run over legacy staff-id entitlement rows, and deletes nothing", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN)); // back to 0032: staff_entitlement_log.staff_id → staff
      const [staff] = await tx`
        INSERT INTO staff (name, role, pin_hash) VALUES ('AT-181 Legacy', 'barista', 'x') RETURNING id`;
      const [order] = await tx`
        INSERT INTO orders (staff_id, total_zar) VALUES (${staff.id}, 0) RETURNING id`;
      await tx`
        INSERT INTO staff_entitlement_log (staff_id, applied_by_staff_id, order_id, day)
        VALUES (${staff.id}, ${staff.id}, ${order.id}, '2026-10-08')`;

      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(UP)))).rejects.toThrow(
        /AT-181\/0033 is for the new clean database.*legacy staff-id rows — not migrating, nothing deleted/
      );
      const left = await tx`SELECT staff_id FROM staff_entitlement_log WHERE order_id = ${order.id}`;
      expect(left).toEqual([{ staff_id: staff.id }]);
    });
  });

  it("after up → down → up, the database refuses what 0033 forbids", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      await tx.unsafe(migrationSql(UP));

      // Fixtures (rolled back with everything else).
      const [staff] = await tx`
        INSERT INTO staff (name, role, pin_hash) VALUES ('AT-181 Barista', 'barista', 'x')
        RETURNING id`;
      const [cust] = await tx`
        INSERT INTO customers (name) VALUES ('AT-181 Office') RETURNING id, status`;
      expect(cust.status).toBe("church_member"); // the column default
      const [menu] = await tx`
        INSERT INTO menu_items (name, category, current_price_zar)
        VALUES ('AT-181 Americano', 'coffee', 3000) RETURNING id`;
      const [order] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day)
        VALUES (${staff.id}, 3000, '2026-10-08') RETURNING id`;

      // order_items.shots: default 1; 1..4 accepted; 0 and 5 refused.
      const [line] = await tx`
        INSERT INTO order_items (order_id, menu_item_id, unit_price_zar)
        VALUES (${order.id}, ${menu.id}, 3000) RETURNING shots`;
      expect(line.shots).toBe(1);
      await tx`
        INSERT INTO order_items (order_id, menu_item_id, unit_price_zar, shots)
        VALUES (${order.id}, ${menu.id}, 3000, 4)`;
      for (const shots of [0, 5]) {
        await expect(
          tx.savepoint((sp) => sp`
            INSERT INTO order_items (order_id, menu_item_id, unit_price_zar, shots)
            VALUES (${order.id}, ${menu.id}, 3000, ${shots})`)
        ).rejects.toThrow(/order_items_shots_range/);
      }

      // Item 5 (PRD §10.3, REQ-143): discount_zar defaults to 0 and never
      // exceeds quantity × unit_price_zar; quantity is at least 1; comp_reason
      // is NULL by default and only takes the six enum values.
      const [plain] = await tx`
        INSERT INTO order_items (order_id, menu_item_id, unit_price_zar)
        VALUES (${order.id}, ${menu.id}, 3000) RETURNING discount_zar, comp_reason`;
      expect(plain.discount_zar).toBe(0);
      expect(plain.comp_reason).toBeNull();
      await tx`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, discount_zar)
        VALUES (${order.id}, ${menu.id}, 2, 3000, 6000)`; // exactly the line's value is allowed
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, discount_zar)
          VALUES (${order.id}, ${menu.id}, 2, 3000, 6001)`)
      ).rejects.toThrow(/order_items_discount_within_line/);
      // B1 (Nikao, PR #257, option A): mods_zar defaults to 0 and the CHECK is
      // discount_zar <= quantity × (unit_price_zar + mods_zar). Oat Cappuccino:
      // 3800 + 800 = 4600 is allowed for one unit; 4601 is refused.
      const [withMods] = await tx`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, mods_zar, discount_zar)
        VALUES (${order.id}, ${menu.id}, 1, 3800, 800, 4600) RETURNING mods_zar`;
      expect(withMods.mods_zar).toBe(800);
      const [noMods] = await tx`
        INSERT INTO order_items (order_id, menu_item_id, unit_price_zar)
        VALUES (${order.id}, ${menu.id}, 3000) RETURNING mods_zar`;
      expect(noMods.mods_zar).toBe(0);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, mods_zar, discount_zar)
          VALUES (${order.id}, ${menu.id}, 1, 3800, 800, 4601)`)
      ).rejects.toThrow(/order_items_discount_within_line/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar)
          VALUES (${order.id}, ${menu.id}, 0, 3000)`)
      ).rejects.toThrow(/order_items_quantity_positive/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO order_items (order_id, menu_item_id, unit_price_zar, comp_reason)
          VALUES (${order.id}, ${menu.id}, 3000, 'birthday')`)
      ).rejects.toThrow(/comp_reason/);

      // REQ-011: at most one successful payment per order.
      await tx`
        INSERT INTO payments (order_id, amount_zar, status)
        VALUES (${order.id}, 3000, 'successful')`;
      await tx`
        INSERT INTO payments (order_id, amount_zar, status)
        VALUES (${order.id}, 3000, 'failed')`; // a non-successful row is not blocked
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO payments (order_id, amount_zar, status)
          VALUES (${order.id}, 3000, 'successful')`)
      ).rejects.toThrow(/payments_one_successful_per_order/);

      // Entitlement: one row per (customer_id, day); the beneficiary is a customer.
      await tx`
        INSERT INTO staff_entitlement_log (customer_id, applied_by_staff_id, order_id, day)
        VALUES (${cust.id}, ${staff.id}, ${order.id}, '2026-10-08')`;
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO staff_entitlement_log (customer_id, applied_by_staff_id, order_id, day)
          VALUES (${cust.id}, ${staff.id}, ${order.id}, '2026-10-08')`)
      ).rejects.toThrow(/staff_entitlement_log_customer_id_day_unique/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO staff_entitlement_log (customer_id, applied_by_staff_id, order_id, day)
          VALUES (${staff.id}, ${staff.id}, ${order.id}, '2026-10-09')`)
      ).rejects.toThrow(/staff_entitlement_log_customer_id_customers_id_fk/);
    });
  });
});
