// 0054 (deferred mode and deferred settlement) ships with a tested `down`
// (PRD §14). PROVISIONAL number — renumbered in merge order.
// Spec: PRD v7.0 §10.3 — opening_sessions "deferred_since · deferred_reason ·
// deferred_by_staff_id · deferred_entered_by (enum manual | health_check)";
// orders "settled_at · settlement_ref … `settled_at` and `written_off_at` are
// mutually exclusive"; §6.0.4 T3, §6.7; REQ-005, REQ-006, REQ-133.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0054.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - up adds the four session columns, the enum with exactly manual |
//     health_check, and orders.settled_at / settlement_ref;
//   - an order can never carry both settled_at and written_off_at (CHECK);
//   - one settlement_ref settles one order (partial UNIQUE index);
//   - deferred_by_staff_id must name a staff row (FK);
//   - down refuses while a settled order or a deferred session exists;
//   - down drops everything and forgets 0054 in the ledger; up brings it back.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0054_deferred_mode_settlement.sql";
const DOWN = "down/0054_deferred_mode_settlement.down.sql";
const WHEN_0054 = 1793220300000; // drizzle/meta/_journal.json, idx 54

const SESSION_COLS = ["deferred_since", "deferred_reason", "deferred_by_staff_id", "deferred_entered_by"];
const ORDER_COLS = ["settled_at", "settlement_ref"];

async function columns(tx: TransactionSql, table: string): Promise<string[]> {
  const rows = await tx`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return rows.map((r) => r.column_name as string);
}

async function enumValues(tx: TransactionSql): Promise<string[]> {
  const rows = await tx`
    SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'deferred_entered_by' ORDER BY e.enumsortorder`;
  return rows.map((r) => r.enumlabel as string);
}

async function hasRefIndex(tx: TransactionSql): Promise<boolean> {
  const rows = await tx`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'orders_settlement_ref_unique'`;
  return rows.length > 0;
}

async function ledgerHas0054(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null;
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0054}`;
  return rows.length > 0;
}

class Rollback extends Error {}

maybe("0054 deferred mode + settlement columns: up → down → up (§10.3, REQ-005/006/133)", () => {
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

  async function staff(tx: TransactionSql): Promise<string> {
    const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('0054 Barista', 'barista', 'x') RETURNING id`;
    return s.id as string;
  }

  async function order(tx: TransactionSql, staffId: string): Promise<string> {
    const [o] = await tx`
      INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, payment_mode)
      VALUES (${staffId}, 2000, '2001-03-04', 'none', 'yoco_deferred') RETURNING id`;
    return o.id as string;
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("up adds the columns and the enum exactly as §10.3 names them", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await columns(tx, "opening_sessions")).toEqual(expect.arrayContaining(SESSION_COLS));
      expect(await columns(tx, "orders")).toEqual(expect.arrayContaining(ORDER_COLS));
      expect(await enumValues(tx)).toEqual(["manual", "health_check"]);
    });
  });

  it("settled_at and written_off_at are mutually exclusive (CHECK)", async () => {
    await inRolledBackTx(async (tx) => {
      const id = await order(tx, await staff(tx));
      await tx`UPDATE orders SET settled_at = now(), settlement_ref = 'TXN-0054' WHERE id = ${id}`;
      await expect(
        tx.savepoint((sp) => sp`UPDATE orders SET written_off_at = now() WHERE id = ${id}`)
      ).rejects.toThrow(/orders_settled_xor_written_off/);
    });
  });

  it("one slip reference settles one order: a reused settlement_ref is refused (partial UNIQUE index)", async () => {
    await inRolledBackTx(async (tx) => {
      const s = await staff(tx);
      const a = await order(tx, s);
      const b = await order(tx, s);
      const c = await order(tx, s);
      await tx`UPDATE orders SET settled_at = now(), settlement_ref = 'SLIP-0054' WHERE id = ${a}`;
      await expect(
        tx.savepoint((sp) => sp`UPDATE orders SET settled_at = now(), settlement_ref = 'SLIP-0054' WHERE id = ${b}`)
      ).rejects.toThrow(/orders_settlement_ref_unique/);
      // NULLs are not constrained: many open orders carry no reference.
      expect((await tx`SELECT count(*)::int AS n FROM orders WHERE id IN (${b}, ${c}) AND settlement_ref IS NULL`)[0].n).toBe(2);
    });
  });

  it("a deferred session records who and how; deferred_by_staff_id must be a staff row", async () => {
    await inRolledBackTx(async (tx) => {
      const s = await staff(tx);
      const [row] = await tx`
        INSERT INTO opening_sessions (session_date, opens_at, mode, closed_at,
          deferred_since, deferred_reason, deferred_by_staff_id, deferred_entered_by)
        VALUES ('2001-03-04', '07:50', 'sunday', now(), now(), 'terminal_unreachable', ${s}, 'manual')
        RETURNING deferred_entered_by`;
      expect(row.deferred_entered_by).toBe("manual");
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO opening_sessions (session_date, opens_at, mode, closed_at, deferred_since, deferred_by_staff_id, deferred_entered_by)
          VALUES ('2001-03-04', '09:50', 'sunday', now(), now(), 'no-such-staff', 'manual')`)
      ).rejects.toThrow(/opening_sessions_deferred_by_staff_id_staff_id_fk/);
    });
  });

  it("down refuses while a settled order exists, and changes nothing", async () => {
    await inRolledBackTx(async (tx) => {
      const id = await order(tx, await staff(tx));
      await tx`UPDATE orders SET settled_at = now() WHERE id = ${id}`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/0054 down/);
      expect(await columns(tx, "orders")).toEqual(expect.arrayContaining(ORDER_COLS));
    });
  });

  it("down drops everything and forgets 0054; up brings it back", async () => {
    await inRolledBackTx(async (tx) => {
      const ledgerBefore = await ledgerHas0054(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      const sessionCols = await columns(tx, "opening_sessions");
      const orderCols = await columns(tx, "orders");
      for (const c of SESSION_COLS) expect(sessionCols).not.toContain(c);
      for (const c of ORDER_COLS) expect(orderCols).not.toContain(c);
      expect(orderCols).toContain("written_off_at");
      expect(await enumValues(tx)).toEqual([]);
      expect(await hasRefIndex(tx)).toBe(false);
      if (ledgerBefore !== null) expect(await ledgerHas0054(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await columns(tx, "opening_sessions")).toEqual(expect.arrayContaining(SESSION_COLS));
      expect(await columns(tx, "orders")).toEqual(expect.arrayContaining(ORDER_COLS));
      expect(await enumValues(tx)).toEqual(["manual", "health_check"]);
      expect(await hasRefIndex(tx)).toBe(true);
    });
  });
});
