"use server";

// Deferred mode and deferred settlement — the server actions (PRD v7.0
// §6.0.4 T3, §6.7, §11.2 rows setDeferredMode / settleDeferredOrder, §11.3
// matrix: barista ✔ admin ✔ for both; off-when-entered-by-check is admin only
// for a person, REQ-006). The rules live in src/server/deferred/*.
//
// Under DEC-21 (Sunday card sales still on the Yoco machine) this is inert by
// construction: a Sunday order is never swept unless an attempt was sent
// (write-offs.ts), the live Web POS port is off unless YOCO_WEBPOS_LIVE=1, and
// a standalone settle writes the order only — never payments.

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, staff } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { applyDeferredMode, type DeferredActor } from "@/server/deferred/mode";
import {
  createDeferredAdminNotifier,
  createDrizzleDeferredStore,
  readOpenSessionDeferred,
  type OpenSessionDeferred,
} from "@/server/deferred/drizzle-store";
import { settleDeferredOrder as settle } from "@/server/deferred/settle";
import { readOpenDeferredOrders, readUnpaidOrders, type UnpaidOrderRow } from "@/server/deferred/unpaid";
import { revenueDay } from "@/lib/format";
import { DEFERRED_SETTLED_ACTION } from "@/server/tender/tender";
import { getTenderDeps } from "@/server/tender/runtime";
import type { ActionResult } from "@/lib/types";

const POS_ROLES = ["barista", "admin"] as const;
const INVALID = { ok: false as const, code: "VALIDATION", message: "Invalid input." };

const setSchema = z.object({ sessionId: z.string().min(1), on: z.boolean(), reason: z.string().max(200) });
const settleSchema = z.object({ orderId: z.string().min(1), ref: z.string().max(100).nullable().optional() });

/** §6.7 "Admin surface": the unpaid-orders list, the same read as GET /api/admin/unpaid-orders. Admin only. */
export async function listUnpaidOrdersForAdmin(): Promise<ActionResult<UnpaidOrderRow[]>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  return { ok: true, data: await readUnpaidOrders(db, new Date()) };
}

/** T3 "Settling": today's open deferred orders, oldest first, with the amount. Barista or admin. */
export async function listOpenDeferredOrders(): Promise<ActionResult<UnpaidOrderRow[]>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const now = new Date();
  return { ok: true, data: await readOpenDeferredOrders(db, revenueDay(now), now) };
}

/** The open session's deferred state, for the till's banner. */
export async function getDeferredState(): Promise<ActionResult<OpenSessionDeferred | null>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  return { ok: true, data: await readOpenSessionDeferred(db) };
}

/** §11.2 setDeferredMode(sessionId, on, reason). Entry fires S2a's Admin push (REQ-005). */
export async function setDeferredMode(
  sessionId: string,
  on: boolean,
  reason: string
): Promise<ActionResult<{ deferred: boolean; changed: boolean }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  if (!setSchema.safeParse({ sessionId, on, reason }).success) return INVALID;
  const actor: DeferredActor = { kind: "staff", staffId: auth.session.id, role: auth.session.role };
  const r = await applyDeferredMode(
    { store: createDrizzleDeferredStore(db), now: () => new Date(), notifyEntered: createDeferredAdminNotifier(db) },
    actor,
    sessionId,
    on,
    reason
  );
  if (!r.ok) return r;
  return { ok: true, data: { deferred: r.deferred, changed: r.changed } };
}

export type SettleResult =
  | { path: "standalone"; settledAt: string }
  | { path: "card"; attempt: number; amountZar: number };

/**
 * §11.2 settleDeferredOrder(orderId, ref?). With a ref: the standalone
 * machine's reference (§6.7 path B). Without: a fresh card attempt, after the
 * query-before-send lookup (T3 3a) — the screen then sends and polls it with
 * the existing tender actions. On ALREADY_RESOLVED it names who settled the
 * order and when (T3 "Settling"), where FAVO recorded a settlement.
 */
export async function settleDeferredOrder(
  orderId: string,
  ref?: string | null
): Promise<ActionResult<SettleResult> | { ok: false; code: string; message: string; settledAt?: string; settledBy?: string | null }> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  if (!settleSchema.safeParse({ orderId, ref }).success) return INVALID;
  const r = await settle(getTenderDeps(), { kind: "staff", staffId: auth.session.id, role: auth.session.role }, orderId, ref);
  if (r.ok) {
    return r.path === "standalone"
      ? { ok: true, data: { path: "standalone", settledAt: r.settledAt.toISOString() } }
      : { ok: true, data: { path: "card", attempt: r.attempt, amountZar: r.amountZar } };
  }
  if (r.code === "ALREADY_RESOLVED" && r.settledAt) {
    return { ok: false, code: r.code, message: r.message, settledAt: r.settledAt.toISOString(), settledBy: await settledBy(orderId) };
  }
  return { ok: false, code: r.code, message: r.message };
}

/** The name on the order's `order.settled` audit row, or null (a system attach, or none). */
async function settledBy(orderId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: staff.name })
    .from(auditLog)
    .leftJoin(staff, eq(staff.id, auditLog.actorId))
    .where(and(eq(auditLog.entityKind, "order"), eq(auditLog.entityId, orderId), eq(auditLog.action, DEFERRED_SETTLED_ACTION)))
    .orderBy(desc(auditLog.at))
    .limit(1);
  return row?.name ?? null;
}
