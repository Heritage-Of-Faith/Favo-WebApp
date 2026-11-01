// AT-207: 0048 (daily_closes + orders.written_off_at) ships with a tested
// `down` (PRD §14), and the write-off sweep's SQL does what the rules say on a
// real Postgres. Renumbered 0047 -> 0048 at merge.
// Spec: PRD v7.0 §10.2 daily_closes, §10.3.3, §6.0.5, S3a, L47;
// REQ-007, REQ-035, REQ-166.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0048.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - daily_closes matches the 0048 snapshot; down drops it and the column (and
//     0048 is gone from drizzle's ledger); up recreates them;
//   - down refuses, changing nothing, while a close record or a written-off order exists;
//   - daily_closes' CHECKs: a blocked close names a reason, a payments_matched one does not; no negative money;
//   - the sweep, through Drizzle: writes off an unpaid yoco order, an unpaid
//     deferred order and an unresolved one, each with its reason and the
//     barista as actor — and never a free, cancelled, paid, R0 or fund-settled
//     order (by payment_mode and by a spend entry alone); a re-run writes
//     nothing; the unpaid-orders read agrees with it; the day then shows as
//     unapproved in the approval queue.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import type { DB } from "@db/index";
import {
  dayWriteOffStatus,
  listUnapprovedWriteOffDays,
  listUnpaidOrders,
  sweepWriteOffs,
} from "@/server/close/write-offs";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0048_at207_daily_closes_writeoffs.sql";
const DOWN = "down/0048_at207_daily_closes_writeoffs.down.sql";
const WHEN_0048 = 1793219700000; // drizzle/meta/_journal.json, idx 48
const DAY = "2026-10-25";

async function ledgerHas0048(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0048}`;
  return rows.length > 0;
}

function snapshotColumns(table: string): string[] {
  const snap = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle", "meta", "0048_snapshot.json"), "utf8")) as {
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

maybe("0048 daily_closes + write-off sweep: up → down → up, and the sweep on Postgres (AT-207)", () => {
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

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("down drops daily_closes and orders.written_off_at; up recreates them as the snapshot says", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbColumns(tx, "daily_closes")).toEqual(snapshotColumns("daily_closes"));
      expect(await dbColumns(tx, "orders")).toEqual(snapshotColumns("orders"));
      // scheduled-jobs.test.ts commits close records and written-off orders
      // (closeDaily on past days); down refuses over them, so clear them here,
      // inside this rolled-back transaction.
      await tx.unsafe(`DELETE FROM daily_closes; UPDATE orders SET written_off_at = NULL WHERE written_off_at IS NOT NULL;`);
      const ledgerBefore = await ledgerHas0048(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);
      await tx.unsafe(migrationSql(DOWN));
      expect(await dbColumns(tx, "daily_closes")).toBeNull();
      expect(await dbColumns(tx, "orders")).not.toContain("written_off_at");
      if (ledgerBefore !== null) expect(await ledgerHas0048(tx)).toBe(false);
      await tx.unsafe(migrationSql(UP));
      expect(await dbColumns(tx, "daily_closes")).toEqual(snapshotColumns("daily_closes"));
      expect(await dbColumns(tx, "orders")).toEqual(snapshotColumns("orders"));
      // Re-runnable: a second up changes nothing and does not fail.
      await tx.unsafe(migrationSql(UP));
    });
  });

  it("down refuses, changing nothing, while a close record or a written-off order exists", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`INSERT INTO daily_closes (revenue_day, reconciliation_status) VALUES (${DAY}, 'payments_matched')`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-207\/0048 down/);
      expect(await dbColumns(tx, "daily_closes")).toEqual(snapshotColumns("daily_closes"));
    });
    await inRolledBackTx(async (tx) => {
      const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('AT-207 Barista', 'barista', 'x') RETURNING id`;
      await tx`INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, written_off_at) VALUES (${s.id}, 2500, ${DAY}, 'none', now())`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-207\/0048 down/);
      expect(await dbColumns(tx, "orders")).toContain("written_off_at");
    });
  });

  it("daily_closes' CHECKs: a blocked close names its reason, a payments_matched one has none, no negative count or value", async () => {
    await inRolledBackTx(async (tx) => {
      const bad: Array<() => Promise<unknown>> = [
        () => tx.savepoint((sp) => sp`INSERT INTO daily_closes (revenue_day, reconciliation_status) VALUES ('2026-10-01', 'blocked')`),
        () => tx.savepoint((sp) => sp`INSERT INTO daily_closes (revenue_day, reconciliation_status, blocked_reason) VALUES ('2026-10-02', 'payments_matched', 'x')`),
        () => tx.savepoint((sp) => sp`INSERT INTO daily_closes (revenue_day, reconciliation_status) VALUES ('2026-10-03', 'ok')`),
        () => tx.savepoint((sp) => sp`INSERT INTO daily_closes (revenue_day, reconciliation_status, written_off_zar) VALUES ('2026-10-04', 'payments_matched', -1)`),
        () => tx.savepoint((sp) => sp`INSERT INTO daily_closes (revenue_day, reconciliation_status, written_off_count) VALUES ('2026-10-05', 'payments_matched', -1)`),
      ];
      for (const run of bad) await expect(run()).rejects.toThrow(/daily_closes_/);
      await tx`INSERT INTO daily_closes (revenue_day, reconciliation_status, blocked_reason) VALUES (${DAY}, 'blocked', 'variance')`;
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO daily_closes (revenue_day, reconciliation_status) VALUES (${DAY}, 'payments_matched')`)
      ).rejects.toThrow(/daily_closes_pkey/);
    });
  });

  it("the sweep writes off exactly the unpaid orders, with reasons and the barista as actor; idempotent; agrees with the unpaid read", async () => {
    const db = drizzle(sql, { schema }) as unknown as DB;
    try {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DB;
        const [louis] = await tx.insert(schema.staff).values({ name: "AT-207 Louis", role: "barista", pinHash: "x" }).returning({ id: schema.staff.id });
        const [nkuli] = await tx.insert(schema.staff).values({ name: "AT-207 Nkuli", role: "barista", pinHash: "x" }).returning({ id: schema.staff.id });

        const mk = async (o: { staffId?: string; totalZar: number; paymentMode: "yoco" | "yoco_deferred" | "free" | "donor_fund" | null; state?: "ordered" | "collected" | "cancelled"; revenueDay?: string }) => {
          const [row] = await tx
            .insert(schema.orders)
            .values({
              staffId: o.staffId ?? louis.id,
              totalZar: o.totalZar,
              paymentMode: o.paymentMode,
              state: o.state ?? "collected",
              revenueDay: o.revenueDay ?? DAY,
              notificationTarget: "none",
            })
            .returning({ id: schema.orders.id, clientUuid: schema.orders.clientUuid });
          return row;
        };
        const pay = (orderId: string, cu: string, attempt: number, status: "pending" | "successful" | "declined" | "unresolved", sent = true) =>
          tx.insert(schema.payments).values({
            orderId,
            attempt,
            clientReference: `${cu}:${attempt}`,
            webposDeviceId: "dev-1",
            amountZar: 2500,
            status,
            sentAt: sent ? new Date("2026-10-25T08:00:00Z") : null,
          });

        const declined = await mk({ totalZar: 2500, paymentMode: "yoco", state: "ordered" });
        await pay(declined.id, declined.clientUuid, 1, "declined");
        const deferred = await mk({ totalZar: 3000, paymentMode: "yoco_deferred" });
        const unresolved = await mk({ staffId: nkuli.id, totalZar: 4500, paymentMode: "yoco" });
        await pay(unresolved.id, unresolved.clientUuid, 1, "unresolved");
        const paid = await mk({ totalZar: 2500, paymentMode: "yoco" });
        await pay(paid.id, paid.clientUuid, 1, "declined");
        await pay(paid.id, paid.clientUuid, 2, "successful");
        const free = await mk({ totalZar: 2000, paymentMode: "free" });
        const cancelled = await mk({ totalZar: 2500, paymentMode: "yoco", state: "cancelled" });
        const r0 = await mk({ totalZar: 0, paymentMode: "yoco" });
        const [fund] = await tx
          .insert(schema.donorFunds)
          .values({ code: "FVO-7K2M", nonRefundableAckBy: louis.id, createdByStaffId: louis.id })
          .returning({ id: schema.donorFunds.id });
        const fundMode = await mk({ totalZar: 2500, paymentMode: "donor_fund" });
        const spendOnly = await mk({ totalZar: 2500, paymentMode: "yoco" });
        for (const o of [fundMode, spendOnly]) {
          await tx.insert(schema.donorFundEntries).values({ fundId: fund.id, kind: "spend", amountZar: -2500, orderId: o.id, recordedByStaffId: louis.id });
        }

        const listed = (await listUnpaidOrders(tx, { revenueDay: DAY })).map((o) => o.id).sort();
        const now = new Date("2026-10-25T22:05:00.000Z");
        const res = await sweepWriteOffs(tx, DAY, now);
        const expected = [declined.id, deferred.id, unresolved.id].sort();

        expect(res.written.map((w) => w.orderId).sort()).toEqual(expected);
        expect(listed).toEqual(expected);
        expect(res.dayCount).toBe(3);
        expect(res.dayZar).toBe(10000);

        const audits = await tx
          .select({ entityId: schema.auditLog.entityId, actorId: schema.auditLog.actorId, actorRole: schema.auditLog.actorRole, reason: schema.auditLog.reason })
          .from(schema.auditLog)
          .where(and(eq(schema.auditLog.action, "write_off"), inArray(schema.auditLog.entityId, expected)));
        const byId = Object.fromEntries(audits.map((a) => [a.entityId, { actor_id: a.actorId, actor_role: a.actorRole, reason: a.reason }]));
        expect(byId[declined.id]).toMatchObject({ actor_id: louis.id, actor_role: "system", reason: "declined_not_retendered" });
        expect(byId[deferred.id]).toMatchObject({ actor_id: louis.id, actor_role: "system", reason: "deferred_unsettled" });
        expect(byId[unresolved.id]).toMatchObject({ actor_id: nkuli.id, actor_role: "system", reason: "unresolved_at_close" });

        for (const o of [paid, free, cancelled, r0, fundMode, spendOnly]) {
          const [row] = await tx.select({ w: schema.orders.writtenOffAt }).from(schema.orders).where(eq(schema.orders.id, o.id));
          expect(row.w).toBeNull();
        }

        // Idempotent: a second sweep writes nothing.
        const again = await sweepWriteOffs(tx, DAY, new Date("2026-10-26T04:00:00Z"));
        expect(again.written).toEqual([]);
        expect(again.dayCount).toBe(3);
        expect(await listUnpaidOrders(tx, { revenueDay: DAY })).toEqual([]);

        // Weekday fail-safe until S7a: a Monday R20 order with no payment is never swept.
        const MON = "2026-10-26";
        const weekday = await mk({ totalZar: 2000, paymentMode: null, revenueDay: MON });
        expect(await listUnpaidOrders(tx, { revenueDay: MON })).toEqual([]);
        expect((await sweepWriteOffs(tx, MON, new Date("2026-10-26T22:05:00Z"))).written).toEqual([]);
        const [wk] = await tx.select({ w: schema.orders.writtenOffAt }).from(schema.orders).where(eq(schema.orders.id, weekday.id));
        expect(wk.w).toBeNull();

        // REQ-035: the day is unapproved until an Admin clears it.
        expect(await dayWriteOffStatus(tx, DAY)).toMatchObject({ count: 3, totalZar: 10000, approved: false });
        const queue = await listUnapprovedWriteOffDays(tx, { revenueDay: DAY });
        expect(queue).toHaveLength(1);
        expect(queue[0]).toMatchObject({ revenueDay: DAY, count: 3, totalZar: 10000 });
        expect(queue[0].items.map((i) => i.reason).sort()).toEqual(["declined_not_retendered", "deferred_unsettled", "unresolved_at_close"]);
        await tx.insert(schema.auditLog).values({ entityKind: "daily_close", entityId: DAY, action: "write_off_approved", actorId: "staff-admin", actorRole: "admin" });
        expect(await listUnapprovedWriteOffDays(tx, { revenueDay: DAY })).toEqual([]);
        expect((await dayWriteOffStatus(tx, DAY)).approved).toBe(true);

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  });
});
