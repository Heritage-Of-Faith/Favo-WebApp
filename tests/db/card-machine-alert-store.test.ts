// The card-machine alert's Postgres store against REAL Postgres (REQ-068,
// PRD §9.6.3, src/server/deferred/drizzle-store.ts createCardMachineAlertStore).
// What the mocked unit tests cannot prove: that the session row lock makes two
// concurrent claims write exactly one alert row; that the per-session `seq`
// orders rows written in one transaction (identical `at`); and that the
// on-duty read is scoped to the session's active staff.
//
// CI-only: requires a real Postgres (see tests/db/helpers.ts) — skips when none.
// The concurrency case needs two connections and committed rows, so it
// commits a CLOSED opening_session (never trips the one-open index) and two
// audit rows, then deletes the session. The audit rows stay: audit_log is
// append-only. Every other case runs in one always-rolled-back transaction.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import type { DB } from "@db/index";
import { connect, hasRealDb } from "./helpers";
import { createCardMachineAlertStore, latestCardMachineRow } from "@/server/deferred/drizzle-store";
import {
  CARD_MACHINE_ALERT_ACTION,
  CARD_MACHINE_RECOVERED_ACTION,
  type CardMachineAlertRow,
} from "@/server/deferred/card-machine-alert";

const maybe = hasRealDb() ? describe : describe.skip;
class Rollback extends Error {}

const DAY = "2001-04-08";
const SUB = { endpoint: "https://push.example/cm", keys: { p256dh: "k", auth: "a" } };

function alertRow(sessionId: string, incidentId: string): CardMachineAlertRow {
  return {
    sessionId, incidentId, at: new Date(), firstFailAt: new Date("2001-04-08T07:00:00Z"),
    recipientKinds: ["admin"], rosteredStaffIds: [], runnerStaffId: null, baristaTargetedStaffIds: [],
  };
}

async function inRollback(sql: Sql, fn: (tx: DB) => Promise<void>) {
  const db = drizzle(sql, { schema }) as unknown as DB;
  try {
    await db.transaction(async (raw) => { await fn(raw as unknown as DB); throw new Rollback(); });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

maybe("card-machine alert store on Postgres", () => {
  let sql: Sql;
  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("two concurrent claimAlert calls on one session write exactly one alert row", async () => {
    const pool = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false, onnotice: () => {} });
    const db = drizzle(pool, { schema }) as unknown as DB;
    const [s] = await db.insert(schema.openingSessions)
      .values({ sessionDate: DAY, mode: "sunday", opensAt: "06:01", closedAt: new Date("2001-04-08T09:00:00Z") })
      .returning();
    try {
      const store = createCardMachineAlertStore(db);
      const [a, b] = await Promise.all([
        store.claimAlert(alertRow(s!.id, "race-a")),
        store.claimAlert(alertRow(s!.id, "race-b")),
      ]);
      expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
      expect(a.incidentId).toBe(b.incidentId); // the loser is told the winner's incident
      const rows = await db.select().from(schema.auditLog).where(and(
        eq(schema.auditLog.entityKind, "opening_session"), eq(schema.auditLog.entityId, s!.id),
        eq(schema.auditLog.action, CARD_MACHINE_ALERT_ACTION),
      ));
      expect(rows).toHaveLength(1);
    } finally {
      await db.delete(schema.openingSessions).where(eq(schema.openingSessions.id, s!.id));
      await pool.end({ timeout: 5 });
    }
  });

  it("claim, close, claim alternate with matching incident ids; one transaction = tied `at`, ordered by seq", async () => {
    await inRollback(sql, async (tx) => {
      const [s] = await tx.insert(schema.openingSessions)
        .values({ sessionDate: DAY, mode: "sunday", opensAt: "06:02", closedAt: new Date("2001-04-08T09:00:00Z") })
        .returning();
      const store = createCardMachineAlertStore(tx);
      const at = new Date("2001-04-08T07:05:00Z");

      expect(await store.closeIncident(s!.id, at, null)).toBeNull(); // nothing open
      expect(await store.claimAlert(alertRow(s!.id, "inc-1"))).toEqual({ claimed: true, incidentId: "inc-1" });
      expect(await store.claimAlert(alertRow(s!.id, "inc-x"))).toEqual({ claimed: false, incidentId: "inc-1" });
      expect(await store.closeIncident(s!.id, at, { staff_louis: "sent" })).toEqual({ incidentId: "inc-1", baristaTargetedStaffIds: [] });
      expect(await store.closeIncident(s!.id, at, null)).toBeNull(); // once per incident
      expect(await store.claimAlert(alertRow(s!.id, "inc-2"))).toEqual({ claimed: true, incidentId: "inc-2" });
      expect(await store.closeIncident(s!.id, at, null)).toMatchObject({ incidentId: "inc-2" });

      const rows = await tx.select({ action: schema.auditLog.action, at: schema.auditLog.at, after: schema.auditLog.after })
        .from(schema.auditLog)
        .where(and(
          eq(schema.auditLog.entityKind, "opening_session"), eq(schema.auditLog.entityId, s!.id),
          inArray(schema.auditLog.action, [CARD_MACHINE_ALERT_ACTION, CARD_MACHINE_RECOVERED_ACTION]),
        ));
      // now() is the transaction's start: every row has the same `at`.
      expect(new Set(rows.map((r) => r.at.getTime())).size).toBe(1);
      const bySeq = rows.map((r) => r.after as { seq: number; incidentId: string; alertDelivery?: unknown })
        .sort((x, y) => x.seq - y.seq);
      expect(bySeq.map((r) => [r.seq, r.incidentId])).toEqual([[1, "inc-1"], [2, "inc-1"], [3, "inc-2"], [4, "inc-2"]]);
      expect(bySeq[1].alertDelivery).toEqual({ staff_louis: "sent" });
      expect(await latestCardMachineRow(tx, s!.id)).toMatchObject({ action: CARD_MACHINE_RECOVERED_ACTION, incidentId: "inc-2", seq: 4 });
    });
  });

  it("latest() picks the most recently written row on tied timestamps, whatever the insert or id order", async () => {
    await inRollback(sql, async (tx) => {
      const at = new Date("2001-04-08T07:10:00Z");
      const sid = "cm-tie-session";
      // The recovered row (seq 2) is inserted first, with an id that sorts first.
      await tx.insert(schema.auditLog).values({
        id: "00000000-0000-0000-0000-000000000001", entityKind: "opening_session", entityId: sid,
        action: CARD_MACHINE_RECOVERED_ACTION, actorRole: "system", at, after: { seq: 2, incidentId: "inc-1" },
      });
      await tx.insert(schema.auditLog).values({
        id: "ffffffff-ffff-ffff-ffff-ffffffffffff", entityKind: "opening_session", entityId: sid,
        action: CARD_MACHINE_ALERT_ACTION, actorRole: "system", at, after: { seq: 1, incidentId: "inc-1" },
      });
      expect(await latestCardMachineRow(tx, sid)).toMatchObject({ action: CARD_MACHINE_RECOVERED_ACTION, seq: 2 });
    });
  });

  it("readOnDutyBaristas: this session's active rostered staff only — not inactive staff, other sessions' shifts or customers", async () => {
    await inRollback(sql, async (tx) => {
      const ins = (name: string, active = true) =>
        tx.insert(schema.staff).values({ name, role: "barista", pinHash: "x", active, pushSubscription: SUB }).returning();
      const [louis] = await ins("CM Louis");
      const [gone] = await ins("CM Gone", false);
      const [other] = await ins("CM Other");
      const [admin] = await tx.insert(schema.staff).values({ name: "CM Admin", role: "admin", pinHash: "x" }).returning();
      const [customer] = await tx.insert(schema.customers).values({ name: "CM Customer" }).returning();
      const closedAt = new Date("2001-04-08T09:00:00Z");
      const [s1] = await tx.insert(schema.openingSessions).values({ sessionDate: DAY, mode: "sunday", opensAt: "06:03", closedAt }).returning();
      const [s2] = await tx.insert(schema.openingSessions).values({ sessionDate: DAY, mode: "sunday", opensAt: "06:04", closedAt }).returning();
      await tx.insert(schema.baristaShifts).values([
        { staffId: louis!.id, shiftDate: DAY, slot: 1, sessionId: s1!.id, createdByStaffId: admin!.id },
        { staffId: gone!.id, shiftDate: DAY, slot: 1, sessionId: s1!.id, createdByStaffId: admin!.id },
        { staffId: other!.id, shiftDate: DAY, slot: 2, sessionId: s2!.id, createdByStaffId: admin!.id },
      ]);
      const store = createCardMachineAlertStore(tx);
      const onDuty = await store.readOnDutyBaristas(s1!.id);
      expect(onDuty).toEqual([{ staffId: louis!.id, role: "barista", active: true, pushSubscription: SUB }]);
      expect(onDuty.map((r) => r.staffId)).not.toContain(customer!.id);
      expect(await store.readStaff([])).toEqual([]);
      expect((await store.readStaff([gone!.id])).map((r) => r.active)).toEqual([false]);
    });
  });
});
