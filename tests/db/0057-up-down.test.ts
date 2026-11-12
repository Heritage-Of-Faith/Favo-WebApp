// AT-202 part 2: 0057 (order_items_discount_within_line widened to
// quantity × (unit_price_zar + mods_zar + surcharge_zar)) ships with a tested
// `down` (PRD §14). Spec: PRD v7.0 §6.9.2a ("A voucher zeroes one whole unit —
// its listed price, its modifications and its extra shots"), §7.0.2
// line_unit_price, L41 / REQ-143 (DEF-A's floor).
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0057.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - at 0057 the CHECK matches the 0057 snapshot;
//   - a triple Cappuccino (R20 + R10 surcharge, §6.2.3) may be discounted to
//     R0 (R30), a quantity-2 four-shot line to R0 (2 × R40); one cent past
//     the line's value is refused;
//   - down refuses, changing nothing, while a line's discount covers a
//     surcharge; otherwise it restores 0033's floor and forgets 0057 in
//     drizzle's ledger; up brings the wide floor back.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0057_at202_discount_covers_surcharge.sql";
const DOWN = "down/0057_at202_discount_covers_surcharge.down.sql";
const WHEN_0057 = 1793220600000; // drizzle/meta/_journal.json, idx 57
const NAME = "order_items_discount_within_line";

function snapshotCheck(file: string): string {
  const snap = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle", "meta", file), "utf8")) as {
    tables: Record<string, { checkConstraints: Record<string, { name: string; value: string }> }>;
  };
  return snap.tables["public.order_items"].checkConstraints[NAME].value;
}

/** The CHECK's definition as Postgres stores it, whitespace and parens stripped for comparison. */
async function dbCheck(tx: TransactionSql): Promise<string | null> {
  const rows = await tx`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${NAME}`;
  return rows.length ? (rows[0].def as string) : null;
}
const norm = (s: string) => s.replace(/CHECK|[\s()]/g, "");

async function ledgerHas0057(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0057}`;
  return rows.length > 0;
}

class Rollback extends Error {}

maybe("0057 order_items_discount_within_line covers the surcharge: up → down → up (AT-202 part 2)", () => {
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

  async function fixtures(tx: TransactionSql) {
    const [staff] = await tx`
      INSERT INTO staff (name, role, pin_hash) VALUES ('AT-202 Barista', 'barista', 'x') RETURNING id`;
    const [menu] = await tx`
      INSERT INTO menu_items (name, category, current_price_zar)
      VALUES ('AT-202 Cappuccino', 'coffee', 2000) RETURNING id`;
    const [order] = await tx`
      INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, payment_mode)
      VALUES (${staff.id}, 0, '2026-10-11', 'none', 'free') RETURNING id`;
    return { orderId: order.id as string, menuId: menu.id as string };
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("at 0057 the CHECK matches the 0057 snapshot and includes surcharge_zar", async () => {
    await inRolledBackTx(async (tx) => {
      const def = await dbCheck(tx);
      expect(def).not.toBeNull();
      expect(norm(def!)).toBe(norm(snapshotCheck("0057_snapshot.json")));
      expect(def).toContain("surcharge_zar");
    });
  });

  it("a triple (R30) and a quantity-2 four-shot line (R80) may be discounted to R0; one cent more is refused", async () => {
    await inRolledBackTx(async (tx) => {
      const { orderId, menuId } = await fixtures(tx);
      await tx`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, shots, surcharge_zar, discount_zar)
        VALUES (${orderId}, ${menuId}, 1, 2000, 3, 1000, 3000)`;
      await tx`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, shots, surcharge_zar, discount_zar)
        VALUES (${orderId}, ${menuId}, 2, 2000, 4, 2000, 8000)`;
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, shots, surcharge_zar, discount_zar)
          VALUES (${orderId}, ${menuId}, 1, 2000, 3, 1000, 3001)`)
      ).rejects.toThrow(/order_items_discount_within_line/);
    });
  });

  it("down refuses, changing nothing, while a line's discount covers a surcharge", async () => {
    await inRolledBackTx(async (tx) => {
      const { orderId, menuId } = await fixtures(tx);
      await tx`
        INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, shots, surcharge_zar, discount_zar)
        VALUES (${orderId}, ${menuId}, 1, 2000, 3, 1000, 3000)`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-202\/0057 down/);
      expect(norm((await dbCheck(tx))!)).toBe(norm(snapshotCheck("0057_snapshot.json")));
    });
  });

  it("down restores 0033's floor and forgets 0057; up brings the wide floor back", async () => {
    await inRolledBackTx(async (tx) => {
      const ledgerBefore = await ledgerHas0057(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(norm((await dbCheck(tx))!)).toBe(norm(snapshotCheck("0056_snapshot.json")));
      if (ledgerBefore !== null) expect(await ledgerHas0057(tx)).toBe(false);
      const { orderId, menuId } = await fixtures(tx);
      await expect(
        tx.savepoint((sp) => sp`
          INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_zar, shots, surcharge_zar, discount_zar)
          VALUES (${orderId}, ${menuId}, 1, 2000, 3, 1000, 3000)`)
      ).rejects.toThrow(/order_items_discount_within_line/);

      await tx.unsafe(migrationSql(UP));
      expect(norm((await dbCheck(tx))!)).toBe(norm(snapshotCheck("0057_snapshot.json")));
    });
  });
});
