"use server";

// The admin exception list — REQ-039 / T5 step 5 / §6.0.5 REPLAY_TOO_OLD: an
// offline order more than 12 hours old at replay is rejected, "not shown to
// the barista; surfaced on the admin exception list". Read only, Admin only.
// Reads the audit rows apply-outbox writes on that rejection; they carry no
// customer id, only what the till rang.

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, staff } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { REPLAY_TOO_OLD_ACTION } from "@/server/sync/apply-outbox";
import type { ActionResult } from "@/lib/types";

export type ReplayTooOldRow = {
  auditId: string;
  clientUuid: string;
  receivedAt: string;
  clientTimestamp: string | null;
  ageMinutes: number | null;
  baristaName: string | null;
  itemCount: number;
  clientTotalZar: number | null;
};

const LIMIT = 200;

/** Newest first. Admin only. */
export async function listReplayTooOld(): Promise<ActionResult<ReplayTooOldRow[]>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const rows = await db
    .select({ id: auditLog.id, at: auditLog.at, after: auditLog.after, baristaName: staff.name })
    .from(auditLog)
    .leftJoin(staff, eq(staff.id, auditLog.actorId))
    .where(eq(auditLog.action, REPLAY_TOO_OLD_ACTION))
    .orderBy(desc(auditLog.at))
    .limit(LIMIT);

  return {
    ok: true,
    data: rows.map((r) => {
      const a = (r.after ?? {}) as {
        clientUuid?: unknown; receivedAt?: unknown; clientTimestamp?: unknown;
        ageMs?: unknown; items?: unknown; clientTotalZar?: unknown;
      };
      const items = Array.isArray(a.items) ? (a.items as { quantity?: unknown }[]) : [];
      return {
        auditId: r.id,
        clientUuid: typeof a.clientUuid === "string" ? a.clientUuid : "",
        receivedAt: typeof a.receivedAt === "string" ? a.receivedAt : new Date(r.at).toISOString(),
        clientTimestamp: typeof a.clientTimestamp === "string" ? a.clientTimestamp : null,
        ageMinutes: typeof a.ageMs === "number" ? Math.floor(a.ageMs / 60_000) : null,
        baristaName: r.baristaName ?? null,
        itemCount: items.reduce((n, i) => n + (typeof i.quantity === "number" ? i.quantity : 0), 0),
        clientTotalZar: typeof a.clientTotalZar === "number" ? a.clientTotalZar : null,
      };
    }),
  };
}
