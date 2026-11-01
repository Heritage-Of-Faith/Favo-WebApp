// AT-203: 0046 (the blessing fund) ships with a tested `down` (PRD §14), and
// the database — not only the application — enforces the fund's invariants.
// Spec: PRD v7.0 §10.3 (donor_funds, donor_fund_entries, donor_fund_members,
// payments.fund_topup_id), §10.6, L44–L47, REQ-172, REQ-174.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0046.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - the three tables match the 0046 snapshot; down drops them; up recreates them;
//   - donor_fund_entries is append-only: UPDATE, DELETE and TRUNCATE all raise;
//   - the signs and proofs are CHECKs: a top-up is > 0, a spend < 0, an
//     adjustment > 0 and tied to an order, a cash/EFT
//     top-up needs a reference, a card top-up its own client_uuid;
//   - one spend per order; one active linked fund per customer (REQ-172), by
//     the partial unique index; deactivating a fund cascades to its members;
//   - payments: exactly one subject (REQ-174); a top-up payment must point at a
//     real entry; one successful payment per top-up (COL-5);
//   - down refuses, changing nothing, while any fund exists.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0046_at203_blessing_fund.sql";
const DOWN = "down/0046_at203_blessing_fund.down.sql";
const TABLES = ["donor_funds", "donor_fund_entries", "donor_fund_members"];
const WHEN_0046 = 1793219500000; // drizzle/meta/_journal.json, idx 46

async function ledgerHas0046(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0046}`;
  return rows.length > 0;
}

function snapshotColumns(table: string): string[] {
  const snap = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle", "meta", "0046_snapshot.json"), "utf8")) as {
    tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }> }>;
  };
  return Object.values(snap.tables[`public.${table}`].columns).map((c) => c.name + (c.notNull ? "!" : "")).sort();
}

async function dbColumns(tx: TransactionSql, table: string): Promise<string[] | null> {
  const [exists] = await tx`SELECT to_regclass(${"public." + table}) AS t`;
  if (exists.t === null) return null;
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort();
}

class Rollback extends Error {}

maybe("0046 blessing fund: up → down → up, and the database's own guarantees (AT-203)", () => {
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

  /** staff, two customers, an order, and one open fund FVO-7K2M with a R500 cash gift. */
  async function fixture(tx: TransactionSql) {
    const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('AT-203 Barista', 'barista', 'x') RETURNING id`;
    const [c1] = await tx`INSERT INTO customers (name) VALUES ('Thandeka') RETURNING id`;
    const [c2] = await tx`INSERT INTO customers (name) VALUES ('Sipho') RETURNING id`;
    const [o] = await tx`
      INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target)
      VALUES (${s.id}, 2000, '2026-10-25', 'none') RETURNING id`;
    const [f] = await tx`
      INSERT INTO donor_funds (code, display_name, non_refundable_ack_by, created_by_staff_id)
      VALUES ('FVO-7K2M', 'Louis Meyer', ${s.id}, ${s.id}) RETURNING id`;
    const [e] = await tx`
      INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, funding_method, reference, recorded_by_staff_id, reason)
      VALUES (${f.id}, 'top_up', 50000, 'cash', 'receipt 0001', ${s.id}, 'gift') RETURNING id`;
    return { staff: s.id as string, c1: c1.id as string, c2: c2.id as string, order: o.id as string, fund: f.id as string, entry: e.id as string };
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("down drops the three tables; up recreates them as the snapshot says", async () => {
    await inRolledBackTx(async (tx) => {
      for (const t of TABLES) expect(await dbColumns(tx, t)).toEqual(snapshotColumns(t));
      const ledgerBefore = await ledgerHas0046(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);
      await tx.unsafe(migrationSql(DOWN));
      for (const t of TABLES) expect(await dbColumns(tx, t)).toBeNull();
      if (ledgerBefore !== null) expect(await ledgerHas0046(tx)).toBe(false);
      await tx.unsafe(migrationSql(UP));
      for (const t of TABLES) expect(await dbColumns(tx, t)).toEqual(snapshotColumns(t));
    });
  });

  it("down refuses, changing nothing, while a fund exists", async () => {
    await inRolledBackTx(async (tx) => {
      await fixture(tx);
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-203\/0046 down/);
      expect(await dbColumns(tx, "donor_fund_entries")).toEqual(snapshotColumns("donor_fund_entries"));
    });
  });

  it("§10.6: donor_fund_entries is append-only — UPDATE, DELETE and TRUNCATE raise", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      await expect(tx.savepoint((sp) => sp`UPDATE donor_fund_entries SET amount_zar = 99999 WHERE id = ${f.entry}`)).rejects.toThrow(/append-only/);
      await expect(tx.savepoint((sp) => sp`DELETE FROM donor_fund_entries WHERE id = ${f.entry}`)).rejects.toThrow(/append-only/);
      await expect(tx.savepoint((sp) => sp`TRUNCATE donor_fund_entries CASCADE`)).rejects.toThrow(/append-only/);
    });
  });

  it("the ledger's CHECKs: signs by kind, a cash/EFT reference, a card top-up's own client_uuid, a spend's order", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      const bad: Array<() => Promise<unknown>> = [
        () => tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, funding_method, reference, recorded_by_staff_id) VALUES (${f.fund}, 'top_up', -100, 'cash', 'r', ${f.staff})`),
        () => tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, order_id, recorded_by_staff_id) VALUES (${f.fund}, 'spend', 2000, ${f.order}, ${f.staff})`),
        () => tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, funding_method, reference, recorded_by_staff_id) VALUES (${f.fund}, 'top_up', 100, 'eft', '  ', ${f.staff})`),
        () => tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, funding_method, recorded_by_staff_id) VALUES (${f.fund}, 'top_up', 100, 'card', ${f.staff})`),
        () => tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, recorded_by_staff_id) VALUES (${f.fund}, 'spend', -2000, ${f.staff})`),
        () => tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, recorded_by_staff_id) VALUES (${f.fund}, 'sweep', -100, ${f.staff})`),
        // An adjustment only gives back a cancelled order's draw: > 0, and tied to an order.
        () => tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, recorded_by_staff_id, reason) VALUES (${f.fund}, 'adjustment', 5000, ${f.staff}, 'typed money')`),
        () => tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, order_id, recorded_by_staff_id) VALUES (${f.fund}, 'adjustment', -2000, ${f.order}, ${f.staff})`),
      ];
      for (const run of bad) await expect(run()).rejects.toThrow(/donor_fund_entries_/);
    });
  });

  it("one spend per order", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      await tx`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, order_id, recorded_by_staff_id) VALUES (${f.fund}, 'spend', -2000, ${f.order}, ${f.staff})`;
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, order_id, recorded_by_staff_id) VALUES (${f.fund}, 'spend', -2000, ${f.order}, ${f.staff})`)
      ).rejects.toThrow(/donor_fund_entries_one_spend_per_order/);
    });
  });

  it("REQ-172: a customer linked to an active fund cannot be linked to a second — refused by the partial unique index", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      const [g] = await tx`INSERT INTO donor_funds (code, non_refundable_ack_by, created_by_staff_id) VALUES ('FVO-9PQR', ${f.staff}, ${f.staff}) RETURNING id`;
      await tx`INSERT INTO donor_fund_members (fund_id, customer_id, added_by_staff_id) VALUES (${f.fund}, ${f.c1}, ${f.staff})`;
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO donor_fund_members (fund_id, customer_id, added_by_staff_id) VALUES (${g.id}, ${f.c1}, ${f.staff})`)
      ).rejects.toThrow(/donor_fund_members_one_active_fund_per_customer/);
      // Deactivate the first fund: fund_active cascades, and the second link is allowed.
      await tx`UPDATE donor_funds SET active = false WHERE id = ${f.fund}`;
      const [m] = await tx`SELECT fund_active FROM donor_fund_members WHERE fund_id = ${f.fund} AND customer_id = ${f.c1}`;
      expect(m.fund_active).toBe(false);
      await tx`INSERT INTO donor_fund_members (fund_id, customer_id, added_by_staff_id) VALUES (${g.id}, ${f.c1}, ${f.staff})`;
    });
  });

  it("REQ-174: a payment has exactly one subject; a top-up payment must name a real entry; one successful payment per top-up", async () => {
    await inRolledBackTx(async (tx) => {
      const f = await fixture(tx);
      const [card] = await tx`
        INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, funding_method, client_uuid, recorded_by_staff_id)
        VALUES (${f.fund}, 'top_up', 50000, 'card', 'cu-topup-db-1', ${f.staff}) RETURNING id`;
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO payments (order_id, fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar) VALUES (${f.order}, ${card.id}, 1, 'cu-x:1', 'dev-1', 2000)`)
      ).rejects.toThrow(/payments_exactly_one_subject/);
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO payments (fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar) VALUES ('no-such-entry', 1, 'cu-y:1', 'dev-1', 50000)`)
      ).rejects.toThrow(/payments_fund_topup_id_donor_fund_entries_id_fk/);
      await tx`INSERT INTO payments (fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar, status) VALUES (${card.id}, 1, 'cu-topup-db-1:1', 'dev-1', 50000, 'successful')`;
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO payments (fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar, status) VALUES (${card.id}, 2, 'cu-topup-db-1:2', 'dev-1', 50000, 'successful')`)
      ).rejects.toThrow(/payments_one_successful_per_fund_topup/);
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO payments (fund_topup_id, attempt, client_reference, webpos_device_id, amount_zar) VALUES (${card.id}, 1, 'cu-topup-db-1:1b', 'dev-1', 50000)`)
      ).rejects.toThrow(/payments_fund_topup_attempt_unique/);
    });
  });
});
