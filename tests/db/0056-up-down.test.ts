// The barista rota: 0056 (barista_shifts) ships with a tested `down` (PRD §14).
// Spec: PRD v7.0 §6.3, §10.2 barista_shifts, §10.3 ("keys to the session …
// `session_id`, or `shift_date + slot`"), §6.11.1 COL-23.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0056.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - at 0056 barista_shifts matches the 0056 snapshot;
//   - a shift can be planned with no session (date + slot), then attached;
//     the same barista twice on one date + slot is refused; slot 0 is refused;
//     deleting the attached session detaches the shift (ON DELETE SET NULL);
//   - down drops the table and forgets 0056 in drizzle's ledger; up brings it back.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0056_barista_rota.sql";
const DOWN = "down/0056_barista_rota.down.sql";
const WHEN_0056 = 1793220500000; // drizzle/meta/_journal.json, idx 56

function snapshotColumns(): string[] {
  const snap = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle", "meta", "0056_snapshot.json"), "utf8")) as {
    tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }> }>;
  };
  return Object.values(snap.tables["public.barista_shifts"].columns).map((c) => c.name + (c.notNull ? "!" : "")).sort();
}

async function dbColumns(tx: TransactionSql): Promise<string[]> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'barista_shifts'`;
  return cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort();
}

async function tableExists(tx: TransactionSql): Promise<boolean> {
  const [r] = await tx`SELECT to_regclass('public.barista_shifts') AS t`;
  return r.t !== null;
}

async function ledgerHas0056(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0056}`;
  return rows.length > 0;
}

class Rollback extends Error {}

maybe("0056 barista_shifts: up → down → up, and its constraints (§6.3, COL-23)", () => {
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

  async function staffId(tx: TransactionSql, name: string, role = "barista"): Promise<string> {
    const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES (${name}, ${role}, 'x') RETURNING id`;
    return s.id as string;
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("at 0056 barista_shifts matches the snapshot", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbColumns(tx)).toEqual(snapshotColumns());
      expect(await dbColumns(tx)).toEqual(expect.arrayContaining(["session_id", "shift_date!", "slot!", "notified_at", "staff_id!"]));
    });
  });

  it("plans by date + slot, attaches to a session, refuses duplicates and slot 0, detaches on session delete", async () => {
    await inRolledBackTx(async (tx) => {
      const nkuli = await staffId(tx, "0056 Nkuli");
      const admin = await staffId(tx, "0056 Admin", "admin");
      const [shift] = await tx`
        INSERT INTO barista_shifts (staff_id, shift_date, slot, created_by_staff_id)
        VALUES (${nkuli}, '2001-03-11', 2, ${admin}) RETURNING id, session_id, notified_at`;
      expect(shift.session_id).toBeNull();
      expect(shift.notified_at).toBeNull();

      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO barista_shifts (staff_id, shift_date, slot, created_by_staff_id)
          VALUES (${nkuli}, '2001-03-11', 2, ${admin})`)
      ).rejects.toThrow(/barista_shifts_date_slot_staff_unique/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO barista_shifts (staff_id, shift_date, slot, created_by_staff_id)
          VALUES (${nkuli}, '2001-03-12', 0, ${admin})`)
      ).rejects.toThrow(/barista_shifts_slot_positive/);

      await tx`UPDATE opening_sessions SET closed_at = now() WHERE closed_at IS NULL`;
      const [os] = await tx`
        INSERT INTO opening_sessions (session_date, mode, opens_at, closed_at)
        VALUES ('2001-03-11', 'event', '18:30', now()) RETURNING id`;
      await tx`UPDATE barista_shifts SET session_id = ${os.id}, notified_at = now() WHERE id = ${shift.id}`;
      await tx`DELETE FROM opening_sessions WHERE id = ${os.id}`;
      const [after] = await tx`SELECT session_id, notified_at FROM barista_shifts WHERE id = ${shift.id}`;
      expect(after.session_id).toBeNull();
      expect(after.notified_at).not.toBeNull();
    });
  });

  it("down drops the table and forgets 0056; up brings it back", async () => {
    await inRolledBackTx(async (tx) => {
      const ledgerBefore = await ledgerHas0056(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(await tableExists(tx)).toBe(false);
      if (ledgerBefore !== null) expect(await ledgerHas0056(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await tableExists(tx)).toBe(true);
      expect(await dbColumns(tx)).toEqual(snapshotColumns());
    });
  });
});
