// DEC-28 (d): 0055 (orders.event_window_id, FK → event_windows) ships with a
// tested `down` (PRD §14). Number 0055: renumbered from a provisional 0054
// after #327's 0054_deferred_mode_settlement merged first.
// Spec: PRD v7.0 §10.3 ("orders | event_window_id … Event attribution
// (§6.6)"), §11 createOrder ("Tags event_window_id when an event is in
// force"), R6, §16.1 DEC-28.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0055.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - at 0055 orders matches the 0055 snapshot (event_window_id nullable);
//   - an order stamped with a real window is stored; an unknown window id is
//     refused by the FK; NULL (no event) is accepted;
//   - down drops the column and the FK and forgets 0055 in drizzle's ledger
//     (orders back to the 0054 snapshot); up brings both back.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0055_at204_orders_event_window.sql";
const DOWN = "down/0055_at204_orders_event_window.down.sql";
const WHEN_0055 = 1793220400000; // drizzle/meta/_journal.json, idx 55

function snapshotColumns(file: string): string[] {
  const snap = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle", "meta", file), "utf8")) as {
    tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }> }>;
  };
  return Object.values(snap.tables["public.orders"].columns).map((c) => c.name + (c.notNull ? "!" : "")).sort();
}

async function dbColumns(tx: TransactionSql): Promise<string[]> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'`;
  return cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort();
}

async function hasFk(tx: TransactionSql): Promise<boolean> {
  const rows = await tx`SELECT 1 FROM pg_constraint WHERE conname = 'orders_event_window_id_event_windows_id_fk'`;
  return rows.length > 0;
}

async function ledgerHas0055(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0055}`;
  return rows.length > 0;
}

class Rollback extends Error {}

maybe("0055 orders.event_window_id: up → down → up, and the FK (DEC-28 d)", () => {
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

  async function staffId(tx: TransactionSql): Promise<string> {
    const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('DEC-28 Barista', 'barista', 'x') RETURNING id`;
    return s.id as string;
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("at 0055 orders matches the snapshot, and event_window_id is nullable", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbColumns(tx)).toEqual(snapshotColumns("0055_snapshot.json"));
      expect(await dbColumns(tx)).toContain("event_window_id");
      expect(await hasFk(tx)).toBe(true);
    });
  });

  it("an order stamped with a real window is stored; an unknown window is refused; NULL is no event", async () => {
    await inRolledBackTx(async (tx) => {
      const s = await staffId(tx);
      const [w] = await tx`
        INSERT INTO event_windows (name, starts_at, ends_at, menu_scope, payment_posture, consumes_cup_lid, audience, extra_shot_surcharge)
        VALUES ('Thursday Social', '2001-03-08T18:00:00+02:00', '2001-03-08T21:00:00+02:00', 'full', 'standard', true, 'both', true)
        RETURNING id`;
      const [o] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, payment_mode, event_window_id)
        VALUES (${s}, 3800, '2001-03-08', 'none', 'yoco', ${w.id}) RETURNING event_window_id`;
      expect(o.event_window_id).toBe(w.id);
      const [none] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, payment_mode)
        VALUES (${s}, 0, '2001-03-08', 'none', 'free') RETURNING event_window_id`;
      expect(none.event_window_id).toBeNull();
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, payment_mode, event_window_id)
          VALUES (${s}, 3800, '2001-03-08', 'none', 'yoco', 'evw_does_not_exist')`)
      ).rejects.toThrow(/event_window_id/);
    });
  });

  it("down drops the column and FK and forgets 0055; up brings both back", async () => {
    await inRolledBackTx(async (tx) => {
      const ledgerBefore = await ledgerHas0055(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(await dbColumns(tx)).toEqual(snapshotColumns("0054_snapshot.json"));
      expect(await hasFk(tx)).toBe(false);
      if (ledgerBefore !== null) expect(await ledgerHas0055(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await dbColumns(tx)).toEqual(snapshotColumns("0055_snapshot.json"));
      expect(await hasFk(tx)).toBe(true);
    });
  });
});
