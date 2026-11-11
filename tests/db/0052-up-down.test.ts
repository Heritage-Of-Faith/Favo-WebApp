// REQ-130: 0052 (price_history.set_by_staff_id, text NOT NULL → staff) ships
// with a tested `down` (PRD §14). PROVISIONAL number — renumbered in merge order.
// Spec: PRD v7.0 §10.3 ("price_history | set_by_staff_id (text NOT NULL →
// staff)"), §11 setMenuItemPrice, REQ-130 ("the write fails rather than
// proceeding anonymously").
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0052.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - the database refuses an anonymous price row and an unknown staff id, and
//     accepts a row naming a real staff member;
//   - price_history matches the 0052 snapshot; after `down` the 0051 snapshot
//     (0052 gone from drizzle's ledger); after `up` the 0052 snapshot again;
//   - down refuses, changing nothing, while a price row exists;
//   - up refuses on a database already holding a price row with no actor.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql, stepDown0053, stepDown0054 } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0052_at130_price_history_set_by.sql";
const DOWN = "down/0052_at130_price_history_set_by.down.sql";
const WHEN_0052 = 1793220100000; // drizzle/meta/_journal.json, idx 52

async function ledgerHas0052(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0052}`;
  return rows.length > 0;
}

type Shape = { columns: string[]; foreignKeys: string[] };

function snapshotShape(file: string): Shape {
  const path = resolve(process.cwd(), "drizzle", "meta", file);
  const snap = JSON.parse(readFileSync(path, "utf8")) as {
    tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }>; foreignKeys: Record<string, unknown> }>;
  };
  const t = snap.tables["public.price_history"];
  return {
    columns: Object.values(t.columns).map((c) => c.name + (c.notNull ? "!" : "")).sort(),
    foreignKeys: Object.keys(t.foreignKeys).sort(),
  };
}

async function dbShape(tx: TransactionSql): Promise<Shape> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'price_history'`;
  const fks = await tx`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.price_history'::regclass AND contype = 'f'`;
  return {
    columns: cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort(),
    foreignKeys: fks.map((r) => r.conname as string).sort(),
  };
}

class Rollback extends Error {}

maybe("0052 price_history.set_by_staff_id: up → down → up, and the refusals (REQ-130)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await stepDown0054(tx); // DEC-28 d: 0054 (orders.event_window_id, FK → event_windows) is newest of all, before 0053
        await stepDown0053(tx); // 0053 is newer; newest first (rolled back with everything else)
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function fixture(tx: TransactionSql) {
    const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('REQ-130 Admin', 'admin', 'x') RETURNING id`;
    const [m] = await tx`
      INSERT INTO menu_items (name, category, current_price_zar)
      VALUES ('REQ-130 Cappuccino', 'coffee', 3000) RETURNING id`;
    return { staffId: s.id as string, menuId: m.id as string };
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("refuses an anonymous price row and an unknown staff id; accepts a named one", async () => {
    await inRolledBackTx(async (tx) => {
      const { staffId, menuId } = await fixture(tx);
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO price_history (menu_item_id, price_zar) VALUES (${menuId}, 3500)`)
      ).rejects.toThrow(/set_by_staff_id/);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO price_history (menu_item_id, price_zar, set_by_staff_id) VALUES (${menuId}, 3500, 'no-such-staff')`)
      ).rejects.toThrow(/price_history_set_by_staff_id_staff_id_fk/);
      const [row] = await tx`
        INSERT INTO price_history (menu_item_id, price_zar, set_by_staff_id)
        VALUES (${menuId}, 3500, ${staffId}) RETURNING set_by_staff_id`;
      expect(row.set_by_staff_id).toBe(staffId);
    });
  });

  it("up → down → up: price_history follows the snapshots and the ledger", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbShape(tx)).toEqual(snapshotShape("0052_snapshot.json"));
      const ledgerBefore = await ledgerHas0052(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(await dbShape(tx)).toEqual(snapshotShape("0051_snapshot.json"));
      if (ledgerBefore !== null) expect(await ledgerHas0052(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await dbShape(tx)).toEqual(snapshotShape("0052_snapshot.json"));
    });
  });

  it("down refuses, changing nothing, while a price row exists", async () => {
    await inRolledBackTx(async (tx) => {
      const { staffId, menuId } = await fixture(tx);
      await tx`INSERT INTO price_history (menu_item_id, price_zar, set_by_staff_id) VALUES (${menuId}, 3500, ${staffId})`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/REQ-130\/0052 down/);
      expect(await dbShape(tx)).toEqual(snapshotShape("0052_snapshot.json"));
    });
  });

  it("up refuses on a database already holding a price row with no actor", async () => {
    await inRolledBackTx(async (tx) => {
      const { menuId } = await fixture(tx);
      await tx.unsafe(migrationSql(DOWN));
      await tx`INSERT INTO price_history (menu_item_id, price_zar) VALUES (${menuId}, 3500)`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(UP)))).rejects.toThrow(/set_by_staff_id/);
      expect(await dbShape(tx)).toEqual(snapshotShape("0051_snapshot.json"));
    });
  });
});
