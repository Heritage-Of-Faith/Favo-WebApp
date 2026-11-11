// The barista rota against REAL Postgres (PRD §6.3, §10.3 barista_shifts,
// §6.11.1 COL-23). What the mocked unit tests cannot prove: that the slot
// counter (src/server/rota/slot.ts) reads the day's audited session creates,
// so an Admin deleting the closed morning session never lowers the evening's
// slot, and the morning's barista is never re-attached or re-pushed.
//
// Runs against the CI test DB at 0056, inside one transaction that is always
// rolled back. The push transport is stubbed (never a real Web Push).
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, isNull } from "drizzle-orm";
import * as schema from "@db/schema";
import type { DB } from "@db/index";
import { connect, hasRealDb } from "./helpers";

const mockSend = vi.fn().mockResolvedValue("sent");
vi.mock("@/server/push/send", () => ({ sendShiftStartPush: (...a: unknown[]) => mockSend(...a) }));

import { notifyShiftStart } from "@/server/rota/shift-start";
import { sessionsOpenedOn } from "@/server/rota/slot";

const maybe = hasRealDb() ? describe : describe.skip;

class Rollback extends Error {}

const DAY = "2001-03-11";
const SUB = { endpoint: "https://push.example/rota", keys: { p256dh: "k", auth: "a" } };

maybe("rota shift-start on Postgres: delete-then-reopen keeps the slot counter", () => {
  let sql: Sql;
  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("morning (slot 1, Louis) → closed → deleted → evening is slot 2, Nkuli pushed, Louis not re-attached", async () => {
    const db = drizzle(sql, { schema }) as unknown as DB;
    try {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DB;
        // Any session another suite left open would trip the one-open index.
        await tx.update(schema.openingSessions).set({ closedAt: new Date() }).where(isNull(schema.openingSessions.closedAt));
        const [louis] = await tx.insert(schema.staff).values({ name: "Rota Louis", role: "barista", pinHash: "x", pushSubscription: SUB }).returning();
        const [nkuli] = await tx.insert(schema.staff).values({ name: "Rota Nkuli", role: "barista", pinHash: "x", pushSubscription: SUB }).returning();
        const [admin] = await tx.insert(schema.staff).values({ name: "Rota Admin", role: "admin", pinHash: "x" }).returning();
        const [louisShift] = await tx.insert(schema.baristaShifts)
          .values({ staffId: louis!.id, shiftDate: DAY, slot: 1, createdByStaffId: admin!.id }).returning();
        const [nkuliShift] = await tx.insert(schema.baristaShifts)
          .values({ staffId: nkuli!.id, shiftDate: DAY, slot: 2, createdByStaffId: admin!.id }).returning();

        // Opening a session = the row + its audited create (as insertSession writes them).
        async function open(opensAt: string, at: string) {
          const [os] = await tx.insert(schema.openingSessions)
            .values({ sessionDate: DAY, mode: "sunday", opensAt }).returning();
          await tx.insert(schema.auditLog).values({
            entityKind: "opening_session", entityId: os!.id, action: "create", actorId: louis!.id,
            actorRole: "barista", at: new Date(at), after: { sessionDate: DAY, opensAt },
          });
          return os!;
        }
        const actor = { id: louis!.id, role: "barista" };

        const morning = await open("08:45", "2001-03-11T06:45:00Z");
        const m = await notifyShiftStart({ sessionId: morning.id, sessionDate: DAY, opensAt: "08:45" }, actor, tx);
        expect(m).toEqual({ slot: 1, pushed: [louis!.id] });

        await tx.update(schema.openingSessions)
          .set({ closedAt: new Date("2001-03-11T09:00:00Z") })
          .where(eq(schema.openingSessions.id, morning.id));
        await tx.delete(schema.openingSessions).where(eq(schema.openingSessions.id, morning.id));
        expect(await sessionsOpenedOn(tx, DAY)).toBe(1); // the deleted session still counts

        const evening = await open("18:30", "2001-03-11T16:30:00Z");
        const e = await notifyShiftStart({ sessionId: evening.id, sessionDate: DAY, opensAt: "18:30" }, actor, tx);
        expect(e).toEqual({ slot: 2, pushed: [nkuli!.id] });
        expect(mockSend).toHaveBeenCalledTimes(2);

        const shifts = await tx.select().from(schema.baristaShifts);
        const l = shifts.find((s) => s.id === louisShift!.id)!;
        const n = shifts.find((s) => s.id === nkuliShift!.id)!;
        expect(l.sessionId).toBeNull();      // detached by the delete, never re-attached
        expect(l.notifiedAt).not.toBeNull(); // the morning push stays on record
        expect(n.sessionId).toBe(evening.id);
        expect(n.notifiedAt).not.toBeNull();

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  });
});
