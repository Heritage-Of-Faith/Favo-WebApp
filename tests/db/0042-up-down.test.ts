// L28 / REQ-046: 0042 (orders.notification_target) ships with a tested `down`
// (PRD §14, "Rollback strategies").
//
// Renumbered 0034 -> 0040 (0034..0039 landed on main first), then 0040 -> 0042
// (0041 landed on main first); the migration's SQL is unchanged.
//
// Runs against the CI test DB, which `bun db:migrate` has already brought to
// 0042. Every case runs inside ONE transaction that is always rolled back, so
// the DB is left exactly as found for the other suites and the E2E step.
//
// What it proves:
//   - orders matches the 0042 snapshot; after `down` the 0041 snapshot (0041
//     does not touch orders; the enum is gone, and 0042 is forgotten in
//     drizzle's ledger); after `up` again the 0042 snapshot;
//   - `up` backfills existing rows to the only value the CHECK allows;
//   - the database refuses (PRD §10.3): a NULL target; a value outside
//     customer | none; 'customer' with no customer_id; 'none' with a customer_id.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql, stepDown0048 } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0042_l28_notification_target.sql";
const DOWN = "down/0042_l28_notification_target.down.sql";
const WHEN_0042 = 1793200000000; // drizzle/meta/_journal.json, idx 42
// AT-201 part 2a: 0044 adds orders.client_uuid on top of this; stepped down first.
const DOWN_0044 = "down/0044_at201_orders_client_uuid.down.sql";
// AT-209: 0045 re-creates v_daily_revenue over orders and payments.status, and
// adds FKs from waste_log to orders and audit_log to staff. It is the newest
// migration, so it steps down before all others (a view blocks ALTER COLUMN TYPE).
const DOWN_0045 = "down/0045_at209_comps_cancel_abandon.down.sql";
// AT-203: 0046 (the blessing fund; an FK and a UNIQUE on payments) is now the
// newest migration, so it steps down before 0045.
const DOWN_0046 = "down/0046_at203_blessing_fund.down.sql";
// AT-202: 0047 adds order_items.surcharge_zar (and seeds three shot settings)
// on top of 0046, so it steps down before 0046.
const DOWN_0047 = "down/0047_at202_order_item_surcharge.down.sql";

async function ledgerHas0042(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0042}`;
  return rows.length > 0;
}

type Shape = { columns: string[]; constraints: string[] };

function snapshotShape(file: string): Shape {
  const path = resolve(process.cwd(), "drizzle", "meta", file);
  const snap = JSON.parse(readFileSync(path, "utf8")) as {
    tables: Record<string, {
      columns: Record<string, { name: string; notNull: boolean }>;
      foreignKeys: Record<string, unknown>;
      uniqueConstraints: Record<string, unknown>;
      checkConstraints?: Record<string, unknown>;
    }>;
  };
  const t = snap.tables["public.orders"];
  return {
    columns: Object.values(t.columns).map((c) => c.name + (c.notNull ? "!" : "")).sort(),
    constraints: [
      ...Object.keys(t.foreignKeys),
      ...Object.keys(t.uniqueConstraints),
      ...Object.keys(t.checkConstraints ?? {}),
    ].sort(),
  };
}

async function dbShape(tx: TransactionSql): Promise<Shape> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'`;
  const cons = await tx`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass AND contype IN ('f', 'u', 'c')`;
  return {
    columns: cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort(),
    constraints: cons.map((r) => r.conname as string).sort(),
  };
}

async function enumExists(tx: TransactionSql): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'notification_target'`;
  return rows.length > 0;
}

class Rollback extends Error {}

maybe("0042 orders.notification_target: up → down → up, and the refusals (L28, REQ-046)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        // CI migrates past 0042: 0044 adds a column to orders. Step it back
        // (rolled back with everything else) so orders reads as 0042 left it.
        // 0043 touches payments only, so it stays. AT-209: 0045 (the newest;
        // a view and an FK over orders) steps down before 0044.
        await stepDown0048(tx); // AT-207: 0048 (daily_closes, orders.written_off_at) is newest of all, first
        await tx.unsafe(migrationSql(DOWN_0047)); // AT-202: newer still, before 0046
        await tx.unsafe(migrationSql(DOWN_0046)); // AT-203: newest of all, first
        await tx.unsafe(migrationSql(DOWN_0045));
        await tx.unsafe(migrationSql(DOWN_0044));
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("down returns orders to 0041; up again returns it to 0042", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbShape(tx)).toEqual(snapshotShape("0042_snapshot.json"));
      expect(await enumExists(tx)).toBe(true);
      const ledgerBefore = await ledgerHas0042(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);
      await tx.unsafe(migrationSql(DOWN));
      expect(await dbShape(tx)).toEqual(snapshotShape("0041_snapshot.json"));
      expect(await enumExists(tx)).toBe(false);
      if (ledgerBefore !== null) expect(await ledgerHas0042(tx)).toBe(false);
      await tx.unsafe(migrationSql(UP));
      expect(await dbShape(tx)).toEqual(snapshotShape("0042_snapshot.json"));
      expect(await enumExists(tx)).toBe(true);
    });
  });

  it("up backfills existing orders: a customer -> 'customer', none -> 'none'", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      const [staff] = await tx`
        INSERT INTO staff (name, role, pin_hash) VALUES ('L28 Barista', 'barista', 'x') RETURNING id`;
      const [cust] = await tx`INSERT INTO customers (name) VALUES ('L28 Naledi') RETURNING id`;
      const [withCust] = await tx`
        INSERT INTO orders (customer_id, staff_id, total_zar, revenue_day)
        VALUES (${cust.id}, ${staff.id}, 3000, '2026-10-11') RETURNING id`;
      const [walkIn] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day)
        VALUES (${staff.id}, 3000, '2026-10-11') RETURNING id`;
      await tx.unsafe(migrationSql(UP));
      const [a] = await tx`SELECT notification_target FROM orders WHERE id = ${withCust.id}`;
      const [b] = await tx`SELECT notification_target FROM orders WHERE id = ${walkIn.id}`;
      expect(a.notification_target).toBe("customer");
      expect(b.notification_target).toBe("none");
    });
  });

  it("the database refuses what §10.3 forbids", async () => {
    await inRolledBackTx(async (tx) => {
      const [staff] = await tx`
        INSERT INTO staff (name, role, pin_hash) VALUES ('L28 Barista', 'barista', 'x') RETURNING id`;
      const [cust] = await tx`INSERT INTO customers (name) VALUES ('L28 Naledi') RETURNING id`;

      // Allowed: customer + customer_id; none + no customer_id.
      await tx`
        INSERT INTO orders (customer_id, staff_id, total_zar, revenue_day, notification_target)
        VALUES (${cust.id}, ${staff.id}, 3000, '2026-10-11', 'customer')`;
      await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target)
        VALUES (${staff.id}, 3000, '2026-10-11', 'none')`;

      // Never null, and no default: omitting it is refused.
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO orders (staff_id, total_zar, revenue_day)
          VALUES (${staff.id}, 3000, '2026-10-11')`)
      ).rejects.toThrow(/notification_target/);
      // Only customer | none.
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target)
          VALUES (${staff.id}, 3000, '2026-10-11', 'walk_in')`)
      ).rejects.toThrow(/notification_target/);
      // 'customer' with no customer: R16's "everything looks like it worked".
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target)
          VALUES (${staff.id}, 3000, '2026-10-11', 'customer')`)
      ).rejects.toThrow(/orders_notification_target_customer/);
      // 'none' with a customer bound.
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO orders (customer_id, staff_id, total_zar, revenue_day, notification_target)
          VALUES (${cust.id}, ${staff.id}, 3000, '2026-10-11', 'none')`)
      ).rejects.toThrow(/orders_notification_target_customer/);
    });
  });
});
