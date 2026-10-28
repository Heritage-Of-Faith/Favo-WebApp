// L28 / REQ-046: 0034 (orders.notification_target) ships with a tested `down`
// (PRD §14, "Rollback strategies").
//
// Runs against the CI test DB, which `bun db:migrate` has already brought to
// 0034. Every case runs inside ONE transaction that is always rolled back, so
// the DB is left exactly as found for the other suites and the E2E step.
//
// What it proves:
//   - orders matches the 0034 snapshot; after `down` the 0033 snapshot (and the
//     enum is gone); after `up` again the 0034 snapshot;
//   - `up` backfills existing rows to the only value the CHECK allows;
//   - the database refuses (PRD §10.3): a NULL target; a value outside
//     customer | none; 'customer' with no customer_id; 'none' with a customer_id.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0034_l28_notification_target.sql";
const DOWN = "down/0034_l28_notification_target.down.sql";

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

maybe("0034 orders.notification_target: up → down → up, and the refusals (L28, REQ-046)", () => {
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

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("down returns orders to 0033; up again returns it to 0034", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbShape(tx)).toEqual(snapshotShape("0034_snapshot.json"));
      expect(await enumExists(tx)).toBe(true);
      await tx.unsafe(migrationSql(DOWN));
      expect(await dbShape(tx)).toEqual(snapshotShape("0033_snapshot.json"));
      expect(await enumExists(tx)).toBe(false);
      await tx.unsafe(migrationSql(UP));
      expect(await dbShape(tx)).toEqual(snapshotShape("0034_snapshot.json"));
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
