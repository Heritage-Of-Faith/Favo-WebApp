// AT-201 part 2a: 0044 (orders.client_uuid) ships with a tested `down`
// (PRD §14). Spec: PRD v7.0 §10.3 — orders.client_uuid (text NOT NULL, UNIQUE),
// "the root of every tender reference" (P3, REQ-027).
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0044.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - orders matches the 0044 snapshot; down returns it to 0043; up again to 0044;
//   - up backfills existing rows, each with its own distinct uuid;
//   - the database refuses a NULL client_uuid and a duplicate one;
//   - down refuses, changing nothing, once a payment's client_reference was
//     derived from a client_uuid.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0044_at201_orders_client_uuid.sql";
const DOWN = "down/0044_at201_orders_client_uuid.down.sql";
const WHEN_0044 = 1793210000000; // drizzle/meta/_journal.json, idx 44
// AT-209: 0045 sits on top of this; stepped down first (newest first).
const DOWN_0045 = "down/0045_at209_comps_cancel_abandon.down.sql";

async function ledgerHas0044(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0044}`;
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

class Rollback extends Error {}

maybe("0044 orders.client_uuid: up → down → up, and the refusals (AT-201, REQ-027)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        // AT-209: CI migrates past 0044; 0045 (a view over orders and
        // payments, an FK from waste_log to orders) is the newest, so it steps
        // down first (rolled back with everything else).
        await tx.unsafe(migrationSql(DOWN_0045));
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function fixtures(tx: TransactionSql) {
    const [staff] = await tx`
      INSERT INTO staff (name, role, pin_hash) VALUES ('AT-201 Barista', 'barista', 'x') RETURNING id`;
    return staff.id as string;
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("down returns orders to 0043; up again returns it to 0044", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbShape(tx)).toEqual(snapshotShape("0044_snapshot.json"));
      const ledgerBefore = await ledgerHas0044(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);
      await tx.unsafe(migrationSql(DOWN));
      expect(await dbShape(tx)).toEqual(snapshotShape("0043_snapshot.json"));
      if (ledgerBefore !== null) expect(await ledgerHas0044(tx)).toBe(false);
      await tx.unsafe(migrationSql(UP));
      expect(await dbShape(tx)).toEqual(snapshotShape("0044_snapshot.json"));
    });
  });

  it("up backfills every existing order with its own uuid", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      const staffId = await fixtures(tx);
      const [a] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target)
        VALUES (${staffId}, 3000, '2026-10-25', 'none') RETURNING id`;
      const [b] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target)
        VALUES (${staffId}, 3000, '2026-10-25', 'none') RETURNING id`;
      await tx.unsafe(migrationSql(UP));
      const rows = await tx`SELECT id, client_uuid FROM orders WHERE id IN (${a.id}, ${b.id})`;
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.client_uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(rows[0].client_uuid).not.toBe(rows[1].client_uuid);
    });
  });

  it("the database refuses a NULL or duplicate client_uuid", async () => {
    await inRolledBackTx(async (tx) => {
      const staffId = await fixtures(tx);
      await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, client_uuid)
        VALUES (${staffId}, 3000, '2026-10-25', 'none', 'cu-dup')`;
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, client_uuid)
          VALUES (${staffId}, 3000, '2026-10-25', 'none', 'cu-dup')`)
      ).rejects.toThrow(/orders_client_uuid_unique/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, client_uuid)
          VALUES (${staffId}, 3000, '2026-10-25', 'none', NULL)`)
      ).rejects.toThrow(/client_uuid/);
    });
  });

  it("down refuses, changing nothing, once a client_reference derives from a client_uuid", async () => {
    await inRolledBackTx(async (tx) => {
      const staffId = await fixtures(tx);
      const [o] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, client_uuid)
        VALUES (${staffId}, 3000, '2026-10-25', 'none', 'cu-down') RETURNING id`;
      await tx`
        INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar)
        VALUES (${o.id}, 1, 'cu-down:1', 'dev-1', 3000)`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-201\/0044 down/);
      expect(await dbShape(tx)).toEqual(snapshotShape("0044_snapshot.json"));
    });
  });
});
