// AT-202 part 1: 0046 (order_items.surcharge_zar + the three shot settings)
// ships with a tested `down` (PRD §14).
// Spec: PRD v7.0 §7.0.2 surcharge_zar (integer cents, PER UNIT), §12 config
// defaults extra_shot_zar 1000 · max_shots_per_line 4 · max_shots_weekday 2.
//
// Every case runs inside ONE transaction that is always rolled back. A
// database still at 0037 is brought to 0046 inside that transaction first.
//
// What it proves:
//   - order_items matches the 0046 snapshot; after `down` the 0037 snapshot;
//     after `up` again the 0046 snapshot;
//   - the three settings are present after up, gone after down, back after up;
//   - surcharge_zar defaults to 0 and the CHECK refuses a negative;
//   - down refuses, changing nothing, while a line carries a surcharge.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0046_at202_order_item_surcharge.sql";
const DOWN = "down/0046_at202_order_item_surcharge.down.sql";

function snapshotColumns(file: string): string[] {
  const path = resolve(process.cwd(), "drizzle", "meta", file);
  const snap = JSON.parse(readFileSync(path, "utf8")) as {
    tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }> }>;
  };
  return Object.values(snap.tables["public.order_items"].columns)
    .map((c) => c.name + (c.notNull ? "!" : ""))
    .sort();
}

async function dbColumns(tx: TransactionSql): Promise<string[]> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items'`;
  return cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort();
}

async function shotSettings(tx: TransactionSql): Promise<Record<string, unknown>> {
  const rows = await tx`
    SELECT key, value FROM app_config
    WHERE key IN ('extra_shot_zar', 'max_shots_per_line', 'max_shots_weekday')`;
  return Object.fromEntries(rows.map((r) => [r.key as string, r.value]));
}

class Rollback extends Error {}

maybe("0046 order_items.surcharge_zar: up → down → up, and the refusals (AT-202, §7.0.2)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        const has = await tx`
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'surcharge_zar'`;
        if (has.length === 0) await tx.unsafe(migrationSql(UP));
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  const DEFAULTS = { extra_shot_zar: 1000, max_shots_per_line: 4, max_shots_weekday: 2 };

  it("up → down → up: columns follow the snapshots; the three settings come and go", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbColumns(tx)).toEqual(snapshotColumns("0046_snapshot.json"));
      expect(await shotSettings(tx)).toEqual(DEFAULTS);

      await tx.unsafe(migrationSql(DOWN));
      expect(await dbColumns(tx)).toEqual(snapshotColumns("0037_snapshot.json"));
      expect(await shotSettings(tx)).toEqual({});

      await tx.unsafe(migrationSql(UP));
      expect(await dbColumns(tx)).toEqual(snapshotColumns("0046_snapshot.json"));
      expect(await shotSettings(tx)).toEqual(DEFAULTS);
    });
  });

  it("up is idempotent for settings: a changed value survives a re-run of the INSERT", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`UPDATE app_config SET value = '1200'::jsonb WHERE key = 'extra_shot_zar'`;
      await tx.unsafe(`
        INSERT INTO "app_config" ("key", "value") VALUES ('extra_shot_zar', '1000'::jsonb)
        ON CONFLICT ("tenant_id", "key") DO NOTHING`);
      expect((await shotSettings(tx)).extra_shot_zar).toBe(1200);
    });
  });

  async function fixtures(tx: TransactionSql) {
    const [staff] = await tx`
      INSERT INTO staff (name, role, pin_hash) VALUES ('AT-202 Barista', 'barista', 'x') RETURNING id`;
    const [menu] = await tx`
      INSERT INTO menu_items (name, category, current_price_zar)
      VALUES ('AT-202 Cappuccino', 'coffee', 2000) RETURNING id`;
    // orders.notification_target arrives in 0034; a local database built
    // from another branch may lack it. 0046 does not depend on it.
    const target = await tx`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'notification_target'`;
    const [order] = target.length > 0
      ? await tx`
          INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target)
          VALUES (${staff.id}, 3000, '2026-10-11', 'none') RETURNING id`
      : await tx`
          INSERT INTO orders (staff_id, total_zar, revenue_day)
          VALUES (${staff.id}, 3000, '2026-10-11') RETURNING id`;
    return { orderId: order.id as string, menuId: menu.id as string };
  }

  it("surcharge_zar defaults to 0; the CHECK refuses a negative", async () => {
    await inRolledBackTx(async (tx) => {
      const { orderId, menuId } = await fixtures(tx);
      const [plain] = await tx`
        INSERT INTO order_items (order_id, menu_item_id, unit_price_zar)
        VALUES (${orderId}, ${menuId}, 2000) RETURNING surcharge_zar`;
      expect(plain.surcharge_zar).toBe(0);
      await tx`
        INSERT INTO order_items (order_id, menu_item_id, unit_price_zar, shots, surcharge_zar)
        VALUES (${orderId}, ${menuId}, 2000, 3, 1000)`;
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO order_items (order_id, menu_item_id, unit_price_zar, surcharge_zar)
          VALUES (${orderId}, ${menuId}, 2000, -1)`)
      ).rejects.toThrow(/order_items_surcharge_nonnegative/);
    });
  });

  it("down refuses, changing nothing, while a line carries a surcharge", async () => {
    await inRolledBackTx(async (tx) => {
      const { orderId, menuId } = await fixtures(tx);
      await tx`
        INSERT INTO order_items (order_id, menu_item_id, unit_price_zar, shots, surcharge_zar)
        VALUES (${orderId}, ${menuId}, 2000, 3, 1000)`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-202\/0046 down/);
      expect(await dbColumns(tx)).toEqual(snapshotColumns("0046_snapshot.json"));
      expect(await shotSettings(tx)).toEqual(DEFAULTS);
    });
  });
});
