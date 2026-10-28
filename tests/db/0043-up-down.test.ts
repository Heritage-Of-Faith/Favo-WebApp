// AT-209: 0043 (waste_category 'abandoned', waste_log.order_id,
// audit_log.on_behalf_of_staff_id) ships with a tested `down` (PRD §14).
// Spec: PRD v7.0 §10.3 (waste_log, audit_log rows), §10.3.2, §6.0.7 T6.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0043.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - the columns match the 0043 snapshot; down removes them and the enum
//     value; up adds them back;
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

const UP = "0043_at209_comps_cancel_abandon.sql";
const DOWN = "down/0043_at209_comps_cancel_abandon.down.sql";

type Snap = {
  tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }> }>;
  enums: Record<string, { values: string[] }>;
};

function snapshot(): Snap {
  const path = resolve(process.cwd(), "drizzle", "meta", "0043_snapshot.json");
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

maybe("0043 comps/cancel/abandon: up → down → up, and the refusal (AT-209)", () => {
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

  it("matches the snapshot; down removes 0043's columns and value; up adds them back", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbColumns(tx, "waste_log")).toEqual(snapshotColumns("waste_log"));
      expect(await dbColumns(tx, "audit_log")).toEqual(snapshotColumns("audit_log"));
      expect(await wasteCategories(tx)).toEqual(snapshot().enums["public.waste_category"].values);
      expect(await wasteCategories(tx)).toContain("abandoned");

      await tx.unsafe(migrationSql(DOWN));
      expect(await dbColumns(tx, "waste_log")).not.toContain("order_id");
      expect(await dbColumns(tx, "audit_log")).not.toContain("on_behalf_of_staff_id");
      expect(await wasteCategories(tx)).toEqual(["expired", "damaged", "spilled", "overproduction", "other"]);

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

  it("down refuses, changing nothing, while an abandoned waste row exists", async () => {
    await inRolledBackTx(async (tx) => {
      const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('T', 'barista', 'x') RETURNING id`;
      await tx`INSERT INTO waste_log (category, quantity, reason, by_staff_id) VALUES ('abandoned', 1, 'left', ${s.id as string})`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-209\/0043 down/);
      expect(await dbColumns(tx, "waste_log")).toEqual(snapshotColumns("waste_log"));
    });
  });
});
