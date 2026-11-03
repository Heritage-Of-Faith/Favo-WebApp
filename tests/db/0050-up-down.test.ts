// AT-203 follow-up: 0050 (v_daily_revenue also counts an abandoned fund-paid
// order) ships with a tested `down` (PRD §14). Spec: PRD v7.0 §6.10.4 ("Each
// draw recognises its own revenue at normal margin"), §6.10.5 / REQ-168
// (cancelOrder gives the draw back with an `adjustment`), L47, §6.0.7 T6 step
// 2b (abandon "reverses nothing"). Owner decision, Mia, 3 Nov 2026.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0050.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - at 0050, v_daily_revenue counts a cancelled order holding a fund spend
//     entry and no adjustment (abandoned), never one whose draw was given back,
//     and still counts a cancelled order holding a successful payment;
//   - down restores 0045's view (the abandoned fund order drops out again) and
//     forgets 0050 in drizzle's ledger; up brings it back; a second up is a no-op.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0050_at203_fund_abandon_revenue.sql";
const DOWN = "down/0050_at203_fund_abandon_revenue.down.sql";
const WHEN_0050 = 1793219900000; // drizzle/meta/_journal.json, idx 50

async function ledgerHas0050(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0050}`;
  return rows.length > 0;
}

async function viewReadsFundLedger(tx: TransactionSql): Promise<boolean> {
  const [r] = await tx`SELECT pg_get_viewdef('v_daily_revenue'::regclass) AS def`;
  return (r.def as string).includes("donor_fund_entries");
}

async function revenue(tx: TransactionSql, day: string): Promise<number> {
  const [r] = await tx`SELECT revenue_zar::int AS v FROM v_daily_revenue WHERE sast_date = ${day}::date`;
  return r ? (r.v as number) : 0;
}

class Rollback extends Error {}

maybe("0050 fund-abandon revenue: up → down → up (AT-203 follow-up)", () => {
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

  /**
   * One revenue day: a R20 collected card order, a R30 card order cancelled
   * after a successful payment, a R25 fund-paid order abandoned (spend, no
   * adjustment), a R40 fund-paid order cancelled (spend + adjustment), and a
   * R50 cancelled order with neither.
   */
  async function fixture(tx: TransactionSql, day: string) {
    const placed = `${day}T08:00:00+02:00`;
    const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('AT-203 Barista', 'barista', 'x') RETURNING id`;
    const staffId = s.id as string;
    const mk = async (state: string, total: number, mode: string | null) => {
      const [o] = await tx`
        INSERT INTO orders (staff_id, state, total_zar, revenue_day, notification_target, placed_at, payment_mode)
        VALUES (${staffId}, ${state}, ${total}, ${day}, 'none', ${placed}, ${mode}) RETURNING id, client_uuid`;
      return o as { id: string; client_uuid: string };
    };
    const served = await mk("collected", 2000, "yoco");
    const cancelledPaid = await mk("cancelled", 3000, "yoco");
    const abandonedFund = await mk("cancelled", 2500, "donor_fund");
    const cancelledFund = await mk("cancelled", 4000, "donor_fund");
    await mk("cancelled", 5000, null); // neither: never revenue
    for (const [o, amount] of [[served, 2000], [cancelledPaid, 3000]] as const) {
      await tx`
        INSERT INTO payments (order_id, attempt, client_reference, webpos_device_id, amount_zar, status)
        VALUES (${o.id}, 1, ${o.client_uuid + ":1"}, 'dev', ${amount}, 'successful')`;
    }
    const [f] = await tx`
      INSERT INTO donor_funds (code, display_name, non_refundable_ack_by, created_by_staff_id)
      VALUES ('FVO-7K2M', 'Louis Meyer', ${staffId}, ${staffId}) RETURNING id`;
    await tx`
      INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, funding_method, reference, recorded_by_staff_id, reason)
      VALUES (${f.id}, 'top_up', 50000, 'cash', 'receipt 0001', ${staffId}, 'gift')`;
    await tx`
      INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, order_id, recorded_by_staff_id)
      VALUES (${f.id}, 'spend', -2500, ${abandonedFund.id}, ${staffId}),
             (${f.id}, 'spend', -4000, ${cancelledFund.id}, ${staffId})`;
    await tx`
      INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, order_id, recorded_by_staff_id, reason)
      VALUES (${f.id}, 'adjustment', 4000, ${cancelledFund.id}, ${staffId}, 'order cancelled')`;
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("at 0050 an abandoned fund-paid order is revenue; a cancelled one whose draw was given back is not", async () => {
    await inRolledBackTx(async (tx) => {
      const day = "2001-02-04";
      await fixture(tx, day);
      expect(await viewReadsFundLedger(tx)).toBe(true);
      // R20 served + R30 cancelled-but-paid + R25 abandoned fund draw.
      expect(await revenue(tx, day)).toBe(7500);
    });
  });

  it("down restores 0045's view and forgets 0050; up brings it back; a second up is a no-op", async () => {
    await inRolledBackTx(async (tx) => {
      const day = "2001-02-11";
      await fixture(tx, day);
      const ledgerBefore = await ledgerHas0050(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);

      await tx.unsafe(migrationSql(DOWN));
      expect(await viewReadsFundLedger(tx)).toBe(false);
      expect(await revenue(tx, day)).toBe(5000); // 0045: R20 served + R30 cancelled-but-paid
      if (ledgerBefore !== null) expect(await ledgerHas0050(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await viewReadsFundLedger(tx)).toBe(true);
      expect(await revenue(tx, day)).toBe(7500);
      await tx.unsafe(migrationSql(UP));
      expect(await revenue(tx, day)).toBe(7500);
    });
  });
});
