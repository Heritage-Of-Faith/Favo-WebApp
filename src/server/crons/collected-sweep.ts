// The `collected` sweep (AT-194) — PRD §9.6.2 job 5, S7.
// Every 5 min, moves `ready` orders to `collected` 20 minutes after
// `completed_at`, the moment the barista tapped Done. Its only purpose is to
// clear the queue board: no barista tap is added (L15), a `ready` order is
// never blocked by its absence, and §7.5 / §05 read `completed_at`, never
// `collected`. A missed run is skipped: ageing is from `completed_at`, so the
// next run sweeps everything eligible.
//
// It changes `orders.state` and nothing else. No stock, no payments, no push,
// and `completed_at` keeps the Done time. Keyed on `completed_at` only: until
// transitionOrder stamps it at Done (Mia's lane, raised on AT-194) a `ready`
// order has a NULL `completed_at` and is left alone.

import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { orders } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { notifyOrderChange } from "@/server/queue/notify";

/** S7: `ready` → `collected` this long after `completed_at`. */
export const SWEEP_AFTER_MS = 20 * 60 * 1000;
/** Upper bound per run; anything left over is swept 5 minutes later. */
export const SWEEP_BATCH = 500;

export type CollectedSweepResult = { cutoff: string; due: number; swept: number; skipped: number };

export async function sweepCollected(now: Date = new Date()): Promise<CollectedSweepResult> {
  const cutoff = new Date(now.getTime() - SWEEP_AFTER_MS);
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.state, "ready"), isNotNull(orders.completedAt), lte(orders.completedAt, cutoff)))
    .orderBy(asc(orders.completedAt))
    .limit(SWEEP_BATCH);

  const swept: string[] = [];
  for (const { id } of due) {
    const moved = await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;
      // Conditional on still being `ready`: a barista who taps Collected in
      // the meantime wins, and this order is skipped, not overwritten.
      const rows = await txDb
        .update(orders)
        .set({ state: "collected" })
        .where(and(eq(orders.id, id), eq(orders.state, "ready")))
        .returning({ id: orders.id });
      if (rows.length === 0) return false;
      await writeAudit(
        {
          entityKind: "order",
          entityId: id,
          action: "transition",
          actorRole: "system",
          before: { state: "ready" },
          after: { state: "collected" },
          reason: "collected sweep: ready for 20 minutes (PRD S7)",
        },
        txDb
      );
      return true;
    });
    if (moved) swept.push(id);
  }

  // Clear the queue board. Non-fatal: the state change is already committed.
  const at = now.toISOString();
  for (const orderId of swept) {
    await notifyOrderChange({ type: "state_change", orderId, state: "collected", at }).catch((e) =>
      console.error(`[collected-sweep] queue notify for ${orderId} failed:`, e)
    );
  }

  return { cutoff: cutoff.toISOString(), due: due.length, swept: swept.length, skipped: due.length - swept.length };
}
