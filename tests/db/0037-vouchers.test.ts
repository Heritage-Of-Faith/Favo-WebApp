// AT-204 Wave 2: 0037 ships with a tested `down` (PRD §14, "Rollback
// strategies"), and the database holds what the PRD fixes:
//   - §10.4: app_config keyed (tenant_id, key) with jsonb values, seeded with
//     T11 voucher_expected_max_per_session = 25 and T12 voucher_kinds =
//     [{ kind: "untracked_hot_drink", categories: ALL }];
//   - §10.2 / COL-29: voucher_redemptions — one row per cup, reversed (both
//     reversed_at and reversed_by_staff_id), never deleted; FKs to
//     order_items, opening_sessions and staff.
//
// Provisional number 0037 (see the migration header).
// Runs against the CI test DB, which has already been migrated to 0037.
// Every case runs inside ONE transaction that is always rolled back.
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0037_at204_vouchers.sql";
const DOWN = "down/0037_at204_vouchers.down.sql";
const NEW_TABLES = ["app_config", "voucher_redemptions"] as const;

type Shape = { columns: string[]; constraints: string[]; indexes: string[] };
type SnapshotTable = {
  columns: Record<string, { name: string; notNull: boolean }>;
  foreignKeys: Record<string, unknown>;
  uniqueConstraints: Record<string, unknown>;
  checkConstraints?: Record<string, unknown>;
  indexes: Record<string, unknown>;
};

function snapshotShape(file: string, table: string): Shape | undefined {
  const path = resolve(process.cwd(), "drizzle", "meta", file);
  const snap = JSON.parse(readFileSync(path, "utf8")) as { tables: Record<string, SnapshotTable> };
  const t = snap.tables[`public.${table}`];
  if (!t) return undefined;
  return {
    columns: Object.values(t.columns).map((c) => c.name + (c.notNull ? "!" : "")).sort(),
    constraints: [
      ...Object.keys(t.foreignKeys),
      ...Object.keys(t.uniqueConstraints),
      ...Object.keys(t.checkConstraints ?? {}),
    ].sort(),
    indexes: Object.keys(t.indexes).sort(),
  };
}

async function dbShape(tx: TransactionSql, table: string): Promise<Shape | undefined> {
  const [exists] = await tx`SELECT to_regclass(${"public." + table}) AS r`;
  if (!exists.r) return undefined;
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  const cons = await tx`
    SELECT conname FROM pg_constraint
    WHERE conrelid = ${"public." + table}::regclass AND contype IN ('f', 'u', 'c')`;
  const idx = await tx`
    SELECT c.relname FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = ${"public." + table}::regclass
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x')
      )`;
  return {
    columns: cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort(),
    constraints: cons.map((r) => r.conname as string).sort(),
    indexes: idx.map((r) => r.relname as string).sort(),
  };
}

async function expectSchemaAt(tx: TransactionSql, snapshotFile: string) {
  for (const table of NEW_TABLES) {
    expect({ table, shape: await dbShape(tx, table) }).toEqual({
      table,
      shape: snapshotShape(snapshotFile, table),
    });
  }
}

class Rollback extends Error {}

maybe("0037 vouchers: up → down → up, defaults and refusals (AT-204)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await tx`UPDATE opening_sessions SET closed_at = now() WHERE closed_at IS NULL`;
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  beforeAll(() => {
    sql = connect();
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("the migrated DB starts at 0037", async () => {
    await inRolledBackTx(async (tx) => {
      await expectSchemaAt(tx, "0037_snapshot.json");
    });
  });

  it("down drops both tables (back to 0036); up again returns to 0037", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      await expectSchemaAt(tx, "0036_snapshot.json"); // both absent in 0036
      for (const t of NEW_TABLES) expect(await dbShape(tx, t)).toBeUndefined();
      // 0036's column is not touched by the down.
      const kept = await tx`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'opening_sessions' AND column_name = 'voucher_redemptions_recorded'`;
      expect(kept.length).toBe(1);

      await tx.unsafe(migrationSql(UP));
      await expectSchemaAt(tx, "0037_snapshot.json");
    });
  });

  it("app_config carries T11 = 25 and T12 = untracked_hot_drink over ALL categories", async () => {
    await inRolledBackTx(async (tx) => {
      const rows = await tx`
        SELECT key, value FROM app_config
        WHERE tenant_id = 'hofmi' AND key IN ('voucher_expected_max_per_session', 'voucher_kinds')
        ORDER BY key`;
      expect(rows.map((r) => [r.key, r.value])).toEqual([
        ["voucher_expected_max_per_session", 25],
        ["voucher_kinds", [{ kind: "untracked_hot_drink", categories: "ALL" }]],
      ]);
      // Keyed (tenant_id, key): a second row for the same key is refused.
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO app_config (key, value) VALUES ('voucher_kinds', '[]'::jsonb)`)
      ).rejects.toThrow(/app_config_tenant_id_key_pk/);
    });
  });

  it("voucher_redemptions: FKs, positive discount, a reversal names both when and who", async () => {
    await inRolledBackTx(async (tx) => {
      const [st] = await tx`
        INSERT INTO staff (name, role, pin_hash) VALUES ('AT-204 barista', 'barista', 'x') RETURNING id`;
      const [mi] = await tx`
        INSERT INTO menu_items (name, category, current_price_zar)
        VALUES ('AT-204 Cappuccino', 'coffee', 3800) RETURNING id`;
      const [session] = await tx`
        INSERT INTO opening_sessions (session_date, opens_at, mode, voucher_kinds_active)
        VALUES ('2099-01-04', '17:45', 'event', ARRAY['untracked_hot_drink']) RETURNING id`;
      const [order] = await tx`
        INSERT INTO orders (staff_id, total_zar, revenue_day) VALUES (${st.id}, 7600, '2099-01-04')
        RETURNING id`;
      const [line] = await tx`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar)
        VALUES (${order.id}, ${mi.id}, 2, 3800) RETURNING id`;

      const insert = (over: Record<string, unknown> = {}) => {
        const v = {
          order_item_id: line.id, session_id: session.id, voucher_kind: "untracked_hot_drink",
          discount_zar: 3800, redeemed_by_staff_id: st.id, ...over,
        };
        return tx.savepoint((sp) => sp`
          INSERT INTO voucher_redemptions ${sp(v)} RETURNING id, reversed_at, reversed_by_staff_id`);
      };

      const [row] = await insert();
      expect(row.reversed_at).toBeNull();
      expect(row.reversed_by_staff_id).toBeNull();

      await expect(insert({ discount_zar: 0 })).rejects.toThrow(/voucher_redemptions_discount_positive/);
      await expect(insert({ order_item_id: "no-such-line" })).rejects.toThrow(
        /voucher_redemptions_order_item_id_order_items_id_fk/
      );
      await expect(insert({ session_id: "no-such-session" })).rejects.toThrow(
        /voucher_redemptions_session_id_opening_sessions_id_fk/
      );
      await expect(
        tx.savepoint((sp) => sp`
          UPDATE voucher_redemptions SET reversed_at = now() WHERE id = ${row.id}`)
      ).rejects.toThrow(/voucher_redemptions_reversal_complete/);

      await tx`
        UPDATE voucher_redemptions SET reversed_at = now(), reversed_by_staff_id = ${st.id}
        WHERE id = ${row.id}`;
      const [live] = await tx`
        SELECT count(*)::int AS n FROM voucher_redemptions
        WHERE order_item_id = ${line.id} AND reversed_at IS NULL`;
      expect(live.n).toBe(0);
    });
  });
});
