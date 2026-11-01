// AT-209: 0045 (waste_category 'abandoned', waste_log.order_id,
// audit_log.on_behalf_of_staff_id) ships with a tested `down` (PRD §14).
// Spec: PRD v7.0 §10.3 (waste_log, audit_log rows), §10.3.2, §6.0.7 T6.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0045.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - the columns match the 0045 snapshot; down removes them and the enum
//     value and forgets 0045 in drizzle's ledger; up adds them back;
//   - v_daily_revenue counts a cancelled order only when it holds a
//     successful payment, and each order once;
//   - waste_log.order_id references orders; on_behalf_of_staff_id references staff;
//   - down refuses, changing nothing, while an abandoned row exists.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0045_at209_comps_cancel_abandon.sql";
const DOWN = "down/0045_at209_comps_cancel_abandon.down.sql";
// AT-203: 0046 (the blessing fund) sits on top of 0045; stepped down first.
const DOWN_0046 = "down/0046_at203_blessing_fund.down.sql";
// AT-202: 0047 (order_items.surcharge_zar) sits on top of 0046; stepped down first.
const DOWN_0047 = "down/0047_at202_order_item_surcharge.down.sql";
const WHEN_0045 = 1793215000000; // drizzle/meta/_journal.json, idx 45

async function ledgerHas0045(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0045}`;
  return rows.length > 0;
}

type Snap = {
  tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }> }>;
  enums: Record<string, { values: string[] }>;
};

function snapshot(): Snap {
  const path = resolve(process.cwd(), "drizzle", "meta", "0045_snapshot.json");
  return JSON.parse(readFileSync(path, "utf8")) as Snap;
}

function snapshotColumns(table: string): string[] {
  return Object.values(snapshot().tables[`public.${table}`].columns)
    .map((c) => c.name + (c.notNull ? "!" : ""))
    .sort();
}

async function dbColumns(tx: TransactionSql, table: string): Promise<string[]> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort();
}

async function wasteCategories(tx: TransactionSql): Promise<string[]> {
  const rows = await tx`SELECT unnest(enum_range(NULL::waste_category))::text AS v`;
  return rows.map((r) => r.v as string);
}

class Rollback extends Error {}

maybe("0045 comps/cancel/abandon: up → down → up, and the refusal (AT-209)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        // AT-203: CI migrates past 0045; 0046 is the newest, so it steps down
        // first (rolled back with everything else).
        await tx.unsafe(migrationSql(DOWN_0047)); // AT-202: 0047 is newer still
        await tx.unsafe(migrationSql(DOWN_0046));
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("matches the snapshot; down removes 0045's columns and value; up adds them back", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbColumns(tx, "waste_log")).toEqual(snapshotColumns("waste_log"));
      expect(await dbColumns(tx, "audit_log")).toEqual(snapshotColumns("audit_log"));
      expect(await wasteCategories(tx)).toEqual(snapshot().enums["public.waste_category"].values);
      expect(await wasteCategories(tx)).toContain("abandoned");
      const ledgerBefore = await ledgerHas0045(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(await dbColumns(tx, "waste_log")).not.toContain("order_id");
      expect(await dbColumns(tx, "audit_log")).not.toContain("on_behalf_of_staff_id");
      expect(await wasteCategories(tx)).toEqual(["expired", "damaged", "spilled", "overproduction", "other"]);
      if (ledgerBefore !== null) expect(await ledgerHas0045(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await dbColumns(tx, "waste_log")).toEqual(snapshotColumns("waste_log"));
      expect(await dbColumns(tx, "audit_log")).toEqual(snapshotColumns("audit_log"));
    });
  });

  it("waste_log.order_id must name a real order; on_behalf_of_staff_id a real staff row", async () => {
    await inRolledBackTx(async (tx) => {
      const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('T', 'barista', 'x') RETURNING id`;
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO waste_log (category, quantity, reason, by_staff_id, order_id)
          VALUES ('abandoned', 1, 'left', ${s.id as string}, 'no-such-order')`)
      ).rejects.toThrow(/waste_log_order_id_orders_id_fk/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO audit_log (entity_kind, entity_id, action, on_behalf_of_staff_id)
          VALUES ('order', 'o', 'override', 'no-such-staff')`)
      ).rejects.toThrow(/audit_log_on_behalf_of_staff_id_staff_id_fk/);
    });
  });

  it("v_daily_revenue counts a cancelled order holding a successful payment, never a cancelled unpaid one (L02)", async () => {
    await inRolledBackTx(async (tx) => {
      const day = "2001-01-07";
      const placed = "2001-01-07T08:00:00+02:00";
      const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('T', 'barista', 'x') RETURNING id`;
      const staffId = s.id as string;
      const mk = async (state: string, total: number) => {
        const [o] = await tx`
          INSERT INTO orders (staff_id, state, total_zar, revenue_day, notification_target, placed_at)
          VALUES (${staffId}, ${state}, ${total}, ${day}, 'none', ${placed}) RETURNING id, client_uuid`;
        return o as { id: string; client_uuid: string };
      };
      const served = await mk("collected", 2000);
      const cancelledPaid = await mk("cancelled", 3000);
      await mk("cancelled", 5000); // no payment: never revenue
      for (const [o, amount] of [[served, 2000], [cancelledPaid, 3000]] as const) {
        await tx`
          INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar, status)
          VALUES (${o.id}, 1, ${o.client_uuid + ":1"}, 'dev', ${amount}, 'successful')`;
      }
      const [r] = await tx`SELECT revenue_zar::int AS v FROM v_daily_revenue WHERE sast_date = ${day}::date`;
      expect(r.v).toBe(5000);
    });
  });

  it("v_daily_revenue counts an order once when a declined attempt is followed by a successful one", async () => {
    await inRolledBackTx(async (tx) => {
      const day = "2001-01-14";
      const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('T', 'barista', 'x') RETURNING id`;
      for (const state of ["collected", "cancelled"]) {
        const [o] = await tx`
          INSERT INTO orders (staff_id, state, total_zar, revenue_day, notification_target, placed_at)
          VALUES (${s.id as string}, ${state}, 2000, ${day}, 'none', ${"2001-01-14T08:00:00+02:00"}) RETURNING id, client_uuid`;
        await tx`
          INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar, status)
          VALUES (${o.id as string}, 1, ${(o.client_uuid as string) + ":1"}, 'dev', 2000, 'declined'),
                 (${o.id as string}, 2, ${(o.client_uuid as string) + ":2"}, 'dev', 2000, 'successful')`;
      }
      const [r] = await tx`SELECT revenue_zar::int AS v FROM v_daily_revenue WHERE sast_date = ${day}::date`;
      expect(r.v).toBe(4000); // R20 served + R20 cancelled-but-paid, each once
    });
  });

  it("down refuses, changing nothing, while an abandoned waste row exists", async () => {
    await inRolledBackTx(async (tx) => {
      const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('T', 'barista', 'x') RETURNING id`;
      await tx`INSERT INTO waste_log (category, quantity, reason, by_staff_id) VALUES ('abandoned', 1, 'left', ${s.id as string})`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-209\/0045 down/);
      expect(await dbColumns(tx, "waste_log")).toEqual(snapshotColumns("waste_log"));
    });
  });
});
