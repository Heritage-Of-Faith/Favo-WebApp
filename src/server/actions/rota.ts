"use server";

// The barista rota, Admin side — PRD §6.3 ("an in-app barista schedule"),
// §10.2/§10.3 barista_shifts (`session_id, or shift_date + slot`), §6.11.1
// COL-23, and the §11 access matrix row "Staff & PINs · barista rota ·
// stock-alert recipients": Admin ✔, Barista ✖. So every action here, the read
// included, is Admin-only.
//
// A shift is planned by date + slot before its session exists; the opening
// action attaches it and sends the shift-start push (src/server/rota/shift-start.ts).
// Every refusal is audited outside any transaction (CLAUDE.md §5).

import { z } from "zod";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { baristaShifts, staff } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { todaySast } from "@/server/cogs/compute";
import { isRotaDate, rotaDates } from "@/lib/rota";
import { sessionsOpenedOn } from "@/server/rota/slot";
import type { ActionResult } from "@/lib/types";

export type RotaShift = {
  id: string;
  staffId: string;
  staffName: string;
  shiftDate: string; // YYYY-MM-DD
  slot: number;
  /** The session for this date + slot has opened and the shift is attached to it. */
  sessionOpened: boolean;
  /** The shift-start push was sent. */
  notified: boolean;
};

export type RotaView = {
  today: string;
  dates: string[];
  baristas: { id: string; name: string }[];
  shifts: RotaShift[];
  /** Sessions opened today (deleted ones included): today's slots up to this are locked. */
  openedToday: number;
};

type Actor = { id: string; role: string };
type Refusal = { ok: false; code: string; message: string };

async function refuse(r: Refusal, entityId: string, actor: Actor, after: Record<string, unknown>): Promise<Refusal> {
  await writeAudit({
    entityKind: "barista_shift", entityId, action: "reject",
    actorId: actor.id, actorRole: actor.role,
    after: { ...after, code: r.code }, reason: r.code,
  });
  return r;
}

/** The next 14 days of the rota (today first), and who can be put on it. */
export async function listRota(): Promise<ActionResult<RotaView>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const dates = rotaDates(todaySast());
  const baristas = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(eq(staff.role, "barista"), eq(staff.active, true)))
    .orderBy(asc(staff.name));
  const rows = await db
    .select({
      id: baristaShifts.id, staffId: baristaShifts.staffId, staffName: staff.name,
      shiftDate: baristaShifts.shiftDate, slot: baristaShifts.slot,
      sessionId: baristaShifts.sessionId, notifiedAt: baristaShifts.notifiedAt,
    })
    .from(baristaShifts)
    .innerJoin(staff, eq(baristaShifts.staffId, staff.id))
    .where(and(gte(baristaShifts.shiftDate, dates[0]!), lte(baristaShifts.shiftDate, dates[dates.length - 1]!)))
    .orderBy(asc(baristaShifts.shiftDate), asc(baristaShifts.slot), asc(staff.name));
  const openedToday = await sessionsOpenedOn(db, dates[0]!);

  return {
    ok: true,
    data: {
      today: dates[0]!,
      dates,
      baristas,
      shifts: rows.map((r) => ({
        id: r.id, staffId: r.staffId, staffName: r.staffName, shiftDate: r.shiftDate, slot: r.slot,
        sessionOpened: r.sessionId !== null, notified: r.notifiedAt !== null,
      })),
      openedToday,
    },
  };
}

const addShiftSchema = z.object({
  staffId: z.string().min(1),
  shiftDate: z.string().refine(isRotaDate, "Date must be YYYY-MM-DD."),
  slot: z.number().int().min(1),
});

/** Put a barista on duty for a date and slot (1 = the day's first session, 2 = the second). */
export async function addShift(
  input: z.input<typeof addShiftSchema>
): Promise<ActionResult<{ shiftId: string }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const actor = { id: auth.session.id, role: auth.session.role };

  const parsed = addShiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Pick a barista, a date and a session." };
  }
  const { staffId, shiftDate, slot } = parsed.data;
  const key = `${shiftDate}#${slot}#${staffId}`;

  if (shiftDate < todaySast()) {
    return refuse(
      { ok: false, code: "INVALID_INPUT", message: "That date has passed. Pick today or later." },
      key, actor, { attempted: "add_shift", why: "past_date", staffId, shiftDate, slot }
    );
  }

  const [member] = await db
    .select({ id: staff.id, role: staff.role, active: staff.active })
    .from(staff)
    .where(eq(staff.id, staffId));
  if (!member || member.role !== "barista" || !member.active) {
    return refuse(
      { ok: false, code: "INVALID_INPUT", message: "Only an active barista can be put on the rota." },
      key, actor, { attempted: "add_shift", why: "not_an_active_barista", staffId, shiftDate, slot }
    );
  }

  // A slot whose session has already opened today cannot be planned: the push
  // for it has fired. Counted from the audited creates, so a deleted session counts.
  if (shiftDate === todaySast() && slot <= (await sessionsOpenedOn(db, shiftDate))) {
    return refuse(
      { ok: false, code: "STALE_STATE", message: "That session has already opened. Pick a later session." },
      key, actor, { attempted: "add_shift", why: "session_opened", staffId, shiftDate, slot }
    );
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(baristaShifts)
      .values({ staffId, shiftDate, slot, createdByStaffId: actor.id })
      .onConflictDoNothing()
      .returning({ id: baristaShifts.id });
    if (!row) return null;
    await writeAudit(
      {
        entityKind: "barista_shift", entityId: row.id, action: "create",
        actorId: actor.id, actorRole: actor.role,
        before: null, after: { staffId, shiftDate, slot },
      },
      tx as unknown as DB
    );
    return row;
  });

  if (!created) {
    return refuse(
      { ok: false, code: "CONFLICT", message: "That barista is already on for this session." },
      key, actor, { attempted: "add_shift", why: "already_on_this_slot", staffId, shiftDate, slot }
    );
  }
  return { ok: true, data: { shiftId: created.id } };
}

/** Take a barista off a planned shift. A shift whose session has opened stays. */
export async function removeShift(shiftId: string): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const actor = { id: auth.session.id, role: auth.session.role };

  const [row] = await db
    .select({
      id: baristaShifts.id, staffId: baristaShifts.staffId, shiftDate: baristaShifts.shiftDate,
      slot: baristaShifts.slot, sessionId: baristaShifts.sessionId,
    })
    .from(baristaShifts)
    .where(eq(baristaShifts.id, shiftId));
  if (!row) return { ok: false, code: "NOT_FOUND", message: "Shift not found." };

  if (row.sessionId !== null) {
    return refuse(
      { ok: false, code: "STALE_STATE", message: "This session has opened, so the shift stays on the record." },
      row.id, actor, { attempted: "remove_shift", why: "session_opened", sessionId: row.sessionId }
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(baristaShifts).where(eq(baristaShifts.id, row.id));
    await writeAudit(
      {
        entityKind: "barista_shift", entityId: row.id, action: "delete",
        actorId: actor.id, actorRole: actor.role,
        before: { staffId: row.staffId, shiftDate: row.shiftDate, slot: row.slot }, after: null,
      },
      tx as unknown as DB
    );
  });
  return { ok: true, data: undefined };
}
