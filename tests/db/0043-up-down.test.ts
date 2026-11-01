// AT-201 part 1: 0043 (payments as the Web POS tender record) ships with a
// tested `down` (PRD §14). Spec: PRD v7.0 §10.3, §10.3.3, §10.6.
// (Renumbered 0035 -> 0043 to follow merge order.)
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0043.
// 0034..0042 do not touch payments, so "down" lands payments on the 0042
// snapshot. Order fixtures pass notification_target = 'none' (0042's NOT
// NULL, no default).
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - payments matches the 0043 snapshot; down returns it to 0042; up again to 0043;
//   - payment_status is exactly pending | successful | declined | unresolved
//     (no failed, no refunded, no deferred, no voided);
//   - a legacy pre-0043 row survives up: failed -> declined, attempt 1,
//     client_reference 'legacy:<order>:1', at = the order's placed_at,
//     charged_amount_zar / fee_zar / sent_at NULL, and no tip column (DEC-17);
//   - legacy attempts are numbered oldest first (webhook_received_at, then id);
//   - up refuses, changing nothing, over a `refunded` or `deferred` row;
//   - down refuses over an `unresolved` row or a fund top-up;
//   - the database refuses: a payment with no subject or with both; a duplicate
//     client_reference; a duplicate (order_id, attempt); a second successful
//     payment for one order or one fund top-up (REQ-011, COL-5); a missing
//     client_reference or webpos_device_id.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0043_at201_tender_payments.sql";
const DOWN = "down/0043_at201_tender_payments.down.sql";
const AT = "0043_snapshot.json";
const BEFORE = "0042_snapshot.json";
// AT-201 part 2a: 0044 (orders.client_uuid) sits on top of this; stepped down first.
const DOWN_0044 = "down/0044_at201_orders_client_uuid.down.sql";
// AT-209: 0045 re-creates v_daily_revenue over orders and payments.status, and
// adds FKs from waste_log to orders and audit_log to staff. It is the newest
// migration, so it steps down before all others (a view blocks ALTER COLUMN TYPE).
const DOWN_0045 = "down/0045_at209_comps_cancel_abandon.down.sql";
// AT-203: 0046 (the blessing fund; an FK and a UNIQUE on payments) is now the
// newest migration, so it steps down before 0045.
const DOWN_0046 = "down/0046_at203_blessing_fund.down.sql";

type Shape = { columns: string[]; constraints: string[]; indexes: string[] };

function snapshotShape(file: string): Shape {
  const snap = JSON.parse(
    readFileSync(resolve(process.cwd(), "drizzle", "meta", file), "utf8")
  ) as {
    tables: Record<string, {
      columns: Record<string, { name: string; notNull: boolean }>;
      foreignKeys: Record<string, unknown>;
      uniqueConstraints: Record<string, unknown>;
      checkConstraints?: Record<string, unknown>;
      indexes: Record<string, unknown>;
    }>;
  };
  const t = snap.tables["public.payments"];
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

async function dbShape(tx: TransactionSql): Promise<Shape> {
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments'`;
  const cons = await tx`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass AND contype IN ('f', 'u', 'c')`;
  const idx = await tx`
    SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.payments'::regclass
      AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                      WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u', 'x'))`;
  return {
    columns: cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort(),
    constraints: cons.map((r) => r.conname as string).sort(),
    indexes: idx.map((r) => r.relname as string).sort(),
  };
}

async function statusValues(tx: TransactionSql): Promise<string[]> {
  const rows = await tx`
    SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'payment_status' ORDER BY e.enumsortorder`;
  return rows.map((r) => r.enumlabel as string);
}

class Rollback extends Error {}

maybe("0043 payments as the tender record: up → down → up, and the refusals (AT-201)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        // CI migrates past 0043: 0044 adds orders.client_uuid. It does not touch
        // payments, but migrations step down newest first, so it goes before
        // any 0043 down (rolled back with everything else). AT-209: 0045's
        // v_daily_revenue reads payments.status, which 0043 down retypes, and
        // 0045 is the newest, so it steps down before 0044.
        await tx.unsafe(migrationSql(DOWN_0046)); // AT-203: newest of all, first
        await tx.unsafe(migrationSql(DOWN_0045));
        await tx.unsafe(migrationSql(DOWN_0044));
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function fixtures(tx: TransactionSql) {
    const [staff] = await tx`
      INSERT INTO staff (name, role, pin_hash) VALUES ('AT-201 Barista', 'barista', 'x') RETURNING id`;
    const [order] = await tx`
      INSERT INTO orders (staff_id, total_zar, revenue_day, placed_at, notification_target)
      VALUES (${staff.id}, 3000, '2026-10-25', '2026-10-25T08:00:00+02:00', 'none') RETURNING id, placed_at`;
    return { staff, order };
  }

  beforeAll(() => {
    sql = connect();
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("the migrated DB starts at 0043, and the status set is exactly the PRD's four", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbShape(tx)).toEqual(snapshotShape(AT));
      expect(await statusValues(tx)).toEqual(["pending", "successful", "declined", "unresolved"]);
    });
  });

  it("down returns payments to 0042; up again returns it to 0043", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      expect(await dbShape(tx)).toEqual(snapshotShape(BEFORE));
      expect(await statusValues(tx)).toEqual(["pending", "successful", "failed", "refunded", "deferred"]);
      await tx.unsafe(migrationSql(UP));
      expect(await dbShape(tx)).toEqual(snapshotShape(AT));
      expect(await statusValues(tx)).toEqual(["pending", "successful", "declined", "unresolved"]);
    });
  });

  it("legacy attempts are numbered oldest first: webhook_received_at, unanswered last, then id", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      const { order } = await fixtures(tx);
      await tx`INSERT INTO payments (id, order_id, amount_zar, status, webhook_received_at) VALUES
        ('a_late', ${order.id}, 3000, 'successful', '2026-10-25T08:05:00+02:00'),
        ('z_early', ${order.id}, 3000, 'failed', '2026-10-25T08:01:00+02:00'),
        ('m_none', ${order.id}, 3000, 'pending', NULL)`;
      await tx.unsafe(migrationSql(UP));
      const rows = await tx`SELECT id, attempt FROM payments WHERE order_id = ${order.id} ORDER BY attempt`;
      expect(rows.map((r) => [r.id, r.attempt])).toEqual([["z_early", 1], ["a_late", 2], ["m_none", 3]]);
    });
  });

  it("a legacy pre-0043 row survives up: failed → declined, and nothing unknown is invented", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      const { order } = await fixtures(tx);
      await tx`INSERT INTO payments (id, order_id, amount_zar, status)
               VALUES ('pay_legacy_1', ${order.id}, 3000, 'failed')`;
      await tx.unsafe(migrationSql(UP));
      const [row] = await tx`SELECT * FROM payments WHERE id = 'pay_legacy_1'`;
      expect(row.status).toBe("declined");
      expect(row.attempt).toBe(1);
      expect(row.client_reference).toBe(`legacy:${order.id}:1`);
      expect(row.webpos_device_id).toBe("legacy:yoco-online-checkout");
      expect(row.amount_zar).toBe(3000);
      expect(row.charged_amount_zar).toBeNull();
      expect(row.fee_zar).toBeNull();
      expect(row.sent_at).toBeNull();
      expect(row).not.toHaveProperty("tip_zar"); // DEC-17: there is no tip column
      expect(new Date(row.at).toISOString()).toBe(new Date(order.placed_at).toISOString());
    });
  });

  for (const status of ["refunded", "deferred"]) {
    it(`up refuses, changing nothing, over a '${status}' row`, async () => {
      await inRolledBackTx(async (tx) => {
        await tx.unsafe(migrationSql(DOWN));
        const { order } = await fixtures(tx);
        await tx`INSERT INTO payments (order_id, amount_zar, status) VALUES (${order.id}, 3000, ${status})`;
        await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(UP)))).rejects.toThrow(
          /AT-201\/0043: payments holds refunded or deferred rows/
        );
        expect(await dbShape(tx)).toEqual(snapshotShape(BEFORE));
      });
    });
  }

  it("down refuses over an unresolved row and over a fund top-up", async () => {
    await inRolledBackTx(async (tx) => {
      const { order } = await fixtures(tx);
      await tx`INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar, status)
               VALUES (${order.id}, 1, 'cu_u:1', 'dev_1', 3000, 'unresolved')`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(
        /AT-201\/0043 down: payments holds fund top-ups or unresolved rows/
      );
    });
    await inRolledBackTx(async (tx) => {
      await tx`INSERT INTO payments (fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar)
               VALUES ('fte_1', 1, 'cu_f:1', 'dev_1', 50000)`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(
        /AT-201\/0043 down/
      );
    });
  });

  it("the database refuses what 0043 forbids", async () => {
    await inRolledBackTx(async (tx) => {
      const { order } = await fixtures(tx);
      const ok = await tx`
        INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar)
        VALUES (${order.id}, 1, 'cu_1:1', 'dev_1', 3000) RETURNING status, fee_zar, at`;
      expect(ok[0].status).toBe("pending");
      expect(ok[0].fee_zar).toBeNull();
      expect(ok[0].at).not.toBeNull();

      const refuse = (q: (sp: TransactionSql) => Promise<unknown>, re: RegExp) =>
        expect(tx.savepoint((sp) => q(sp))).rejects.toThrow(re);

      // Exactly one subject.
      await refuse((sp) => sp`
        INSERT INTO payments (attempt, client_reference, webpos_device_id, amount_zar)
        VALUES (1, 'cu_none:1', 'dev_1', 3000)`, /payments_exactly_one_subject/);
      await refuse((sp) => sp`
        INSERT INTO payments (order_id, fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar)
        VALUES (${order.id}, 'fte_1', 1, 'cu_both:1', 'dev_1', 3000)`, /payments_exactly_one_subject/);
      // client_reference: NOT NULL and UNIQUE (P3, REQ-027).
      await refuse((sp) => sp`
        INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar)
        VALUES (${order.id}, 2, 'cu_1:1', 'dev_1', 3000)`, /payments_client_reference_unique/);
      await refuse((sp) => sp`
        INSERT INTO payments (order_id, attempt, webpos_device_id, amount_zar)
        VALUES (${order.id}, 2, 'dev_1', 3000)`, /client_reference/);
      // One row per (order_id, attempt) — a second attempt 1 is refused.
      await refuse((sp) => sp`
        INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar)
        VALUES (${order.id}, 1, 'cu_other:1', 'dev_1', 3000)`, /payments_order_attempt_unique/);
      // webpos_device_id NOT NULL (REQ-065).
      await refuse((sp) => sp`
        INSERT INTO payments (order_id, attempt, client_reference, amount_zar)
        VALUES (${order.id}, 2, 'cu_1:2', 3000)`, /webpos_device_id/);
      // No status outside the four — the old values are gone, `voided` never existed.
      for (const bad of ["failed", "refunded", "deferred", "voided"]) {
        await refuse((sp) => sp`
          INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar, status)
          VALUES (${order.id}, 9, ${"cu_bad_" + bad}, 'dev_1', 3000, ${bad})`, /payment_status/);
      }

      // REQ-011: one successful payment per order; a declined attempt is not blocked.
      await tx`INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar, status)
               VALUES (${order.id}, 2, 'cu_1:2', 'dev_1', 3000, 'declined')`;
      await tx`INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar, status)
               VALUES (${order.id}, 3, 'cu_1:3', 'dev_1', 3000, 'successful')`;
      await refuse((sp) => sp`
        INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar, status)
        VALUES (${order.id}, 4, 'cu_1:4', 'dev_1', 3000, 'successful')`, /payments_one_successful_per_order/);

      // COL-5: one successful payment per fund top-up.
      await tx`INSERT INTO payments (fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar, status)
               VALUES ('fte_1', 1, 'cu_f:1', 'dev_1', 50000, 'successful')`;
      await refuse((sp) => sp`
        INSERT INTO payments (fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar, status)
        VALUES ('fte_1', 2, 'cu_f:2', 'dev_1', 50000, 'successful')`, /payments_one_successful_per_fund_topup/);
    });
  });
});
