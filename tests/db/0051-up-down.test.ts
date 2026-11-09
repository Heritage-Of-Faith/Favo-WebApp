// 0051 (orders.payment_mode NOT NULL, NULLs backfilled to 'yoco') ships with a
// tested `down` (PRD §14). Spec: PRD v7.0 §10.3 L2499 ("payment_mode → NOT
// NULL, backfilling NULLs to 'yoco'"), §10.6 ("orders.payment_mode is never
// null"), REQ-134. Owner-approved (Mia).
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0051.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - at 0051 the column is NOT NULL and a NULL insert is refused;
//   - down drops the NOT NULL (a NULL insert is accepted again) and forgets
//     0051 in drizzle's ledger;
//   - up backfills every NULL to 'yoco', leaves every other mode alone, and
//     sets NOT NULL again; a second up is a no-op.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0051_payment_mode_not_null.sql";
const DOWN = "down/0051_payment_mode_not_null.down.sql";
const WHEN_0051 = 1793220000000; // drizzle/meta/_journal.json, idx 51

async function ledgerHas0051(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0051}`;
  return rows.length > 0;
}

async function isNullable(tx: TransactionSql): Promise<boolean> {
  const [r] = await tx`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_mode'`;
  return r.is_nullable === "YES";
}

class Rollback extends Error {}

maybe("0051 orders.payment_mode NOT NULL: up → down → up (§10.3, §10.6)", () => {
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
    const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('0051 Barista', 'barista', 'x') RETURNING id`;
    return s.id as string;
  }

  const insert = (tx: TransactionSql, staff: string, mode: string | null) => tx`
    INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, payment_mode)
    VALUES (${staff}, 2000, '2001-03-04', 'none', ${mode}) RETURNING id`;

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("at 0051 payment_mode is NOT NULL and a NULL is refused", async () => {
    await inRolledBackTx(async (tx) => {
      const staff = await staffId(tx);
      expect(await isNullable(tx)).toBe(false);
      await expect(tx.savepoint((sp) => insert(sp as unknown as TransactionSql, staff, null))).rejects.toThrow(/payment_mode/);
    });
  });

  it("down drops the NOT NULL and forgets 0051; up backfills NULL → 'yoco', keeps every other mode, and is re-runnable", async () => {
    await inRolledBackTx(async (tx) => {
      const staff = await staffId(tx);
      const ledgerBefore = await ledgerHas0051(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(await isNullable(tx)).toBe(true);
      if (ledgerBefore !== null) expect(await ledgerHas0051(tx)).toBe(false);

      const [legacy] = await insert(tx, staff, null);
      const kept: Record<string, string> = {};
      for (const mode of ["yoco_deferred", "free", "donor_fund", "yoco"]) {
        const [o] = await insert(tx, staff, mode);
        kept[o.id as string] = mode;
      }

      await tx.unsafe(migrationSql(UP));
      expect(await isNullable(tx)).toBe(false);
      const [l] = await tx`SELECT payment_mode FROM orders WHERE id = ${legacy.id}`;
      expect(l.payment_mode).toBe("yoco");
      for (const [id, mode] of Object.entries(kept)) {
        const [o] = await tx`SELECT payment_mode FROM orders WHERE id = ${id}`;
        expect(o.payment_mode).toBe(mode);
      }

      await tx.unsafe(migrationSql(UP));
      expect(await isNullable(tx)).toBe(false);
      const [{ n }] = await tx`SELECT COUNT(*)::int AS n FROM orders WHERE payment_mode IS NULL`;
      expect(n).toBe(0);
    });
  });
});
