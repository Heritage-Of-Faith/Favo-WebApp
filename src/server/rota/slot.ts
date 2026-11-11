// The rota slot of a session (PRD §10.3 barista_shifts `shift_date + slot`,
// §6.11.1 COL-23): its order of opening on its revenue day, 1 = the first.
//
// Counted from the day's audited `opening_session` / `create` rows, not from
// the surviving opening_sessions rows: an Admin may delete a closed session,
// and a slot must never go back down (the evening would otherwise take the
// morning's slot and re-attach the morning's barista). audit_log is
// append-only (0021), so the counter only grows. Every session insert writes
// that row in the same transaction (insertSession in actions/opening.ts) with
// after.sessionDate = the SAST revenue day.

import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { auditLog } from "@db/schema";

function sessionCreatesOn(date: string) {
  return and(
    eq(auditLog.entityKind, "opening_session"),
    eq(auditLog.action, "create"),
    sql`${auditLog.after}->>'sessionDate' = ${date}`,
  );
}

/** How many sessions have been opened on `date` (deleted ones included). */
export async function sessionsOpenedOn(dbc: Pick<DB, "select">, date: string): Promise<number> {
  const [r] = await dbc
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(sessionCreatesOn(date));
  return Number(r?.n ?? 0);
}

/**
 * The slot of session `sessionId` opened on `date`: the number of the day's
 * session creates up to and including its own. Null if it has no audited
 * create row (then no rota row can be matched to it).
 */
export async function slotOfSession(dbc: Pick<DB, "select">, sessionId: string, date: string): Promise<number | null> {
  const [r] = await dbc
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(
      sessionCreatesOn(date),
      sql`${auditLog.at} <= (
        SELECT max(a2.at) FROM audit_log a2
        WHERE a2.entity_kind = 'opening_session' AND a2.action = 'create' AND a2.entity_id = ${sessionId}
      )`,
    ));
  const n = Number(r?.n ?? 0);
  return n > 0 ? n : null;
}
