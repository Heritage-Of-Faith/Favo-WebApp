"use server";

// The Untracked hot drink voucher — AT-204 (backend). PRD §6.9, §11
// (redeemVoucher · removeVoucher · recordVoucherCount), L41, L42, L43, COL-29.
//
//  - One voucher = one cup: discount_zar grows by one unit's line_unit_price
//    and one voucher_redemptions row is written, in ONE transaction.
//  - Removal is a reversal (reversed_at, reversed_by_staff_id), never a delete.
//  - opening_sessions.voucher_redemptions_recorded follows the live rows: it is
//    changed by one under the session row's lock, in the same transaction.
//  - Payments (P4, REQ-028), mirroring applyFreeCoffee / declineFreeCoffee
//    (AT-201 part 2b, owner decision 31 Oct 2026): any open tender attempt
//    (pending, or sent and unresolved) freezes the total → TENDER_IN_PROGRESS;
//    a successful one, or an order past `ordered`, refuses. A payment row's
//    amount is never changed, and no payments row is ever written here: "no
//    row" is a normal state, and a later attempt is begun by beginTender at
//    the new total. With a row present (e.g. a declined attempt), a voucher
//    that would take the order to R0 is refused, as applyFreeCoffee refuses it
//    (no payments row is ever deleted). A rowless order that nets R0 becomes
//    payment_mode='free' (L42); removeVoucher on a free order makes it
//    chargeable with no row until beginTender runs.
//  - Refusals are returned, not thrown, so their reject audit commits.

import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import {
  orders, orderItems, openingSessions, voucherRedemptions, eventWindows,
} from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { LINE_SURCHARGE_CHARGED_ZAR, decideRedeem, decideRemove } from "@/server/orders/voucher";
import { lockOpenSession } from "@/server/orders/voucher-session";
import { pairAlreadyRecorded, pushVoucherVariance, slipVariance } from "@/server/push/admin-alert";
import {
  CHECKOUT_EXISTS, ORDER_MOVED_ON as LOCK_ORDER_MOVED_ON, lockPaymentForTotalChange,
} from "@/server/orders/payment-lock";
import type { ActionResult } from "@/lib/types";
import { revenueDay } from "@/lib/format";
import { forcedCloseAt } from "@/lib/session-mode";
import { NO_VOUCHERS, voucherContextFor, type VoucherContext } from "@/lib/pos-vouchers";

const POS_ROLES = ["barista", "admin"] as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { id: string; role: string };
type Fail = { ok: false; code: string; message: string };

const ORDER_MOVED_ON: Fail = {
  ok: false, code: "ALREADY_RESOLVED", message: "Already under way — vouchers can't change now.",
};
// Same codes as the helper's refusals; voucher wording instead of free-cup wording.
const PAYMENT_STARTED: Fail = {
  ok: false, code: "TENDER_IN_PROGRESS", message: "Payment has started. Cancel and re-ring the order to change a voucher.",
};

const idSchema = z.string().trim().min(1);

type LockedLine = {
  line: {
    id: string; orderId: string; quantity: number; unitPriceZar: number; modsZar: number;
    discountZar: number; compReason: string | null;
  };
  order: { id: string; state: string; totalZar: number; paymentMode: string | null };
};

const LINE_NOT_FOUND: Fail = { ok: false, code: "NOT_FOUND", message: "That drink isn't on an order." };

/**
 * Lock the line's ORDER first, then read the line under its own lock. Every
 * voucher write on an order takes the order lock first, so under READ
 * COMMITTED the line, its live rows and the order total are all read after
 * any earlier writer committed — never a stale discount_zar (review blocker).
 * Only order_items.order_id, which never changes, is read before the lock.
 */
async function lockLine(tx: Tx, orderItemId: string): Promise<LockedLine | Fail> {
  const [ref] = await tx
    .select({ orderId: orderItems.orderId })
    .from(orderItems)
    .where(eq(orderItems.id, orderItemId));
  if (!ref) return LINE_NOT_FOUND;
  const [order] = await tx
    .select({ id: orders.id, state: orders.state, totalZar: orders.totalZar, paymentMode: orders.paymentMode })
    .from(orders)
    .where(eq(orders.id, ref.orderId))
    .for("update");
  if (!order) return LINE_NOT_FOUND;
  const [line] = await tx
    .select({
      id: orderItems.id, orderId: orderItems.orderId, quantity: orderItems.quantity,
      unitPriceZar: orderItems.unitPriceZar, modsZar: orderItems.modsZar,
      discountZar: orderItems.discountZar, compReason: orderItems.compReason,
    })
    .from(orderItems)
    .where(eq(orderItems.id, orderItemId))
    .for("update");
  if (!line) return LINE_NOT_FOUND;
  return { line, order };
}

/**
 * P4 guard — lockPaymentForTotalChange, the rule applyFreeCoffee uses (owner
 * rule, Mia 12 Oct 2026; AT-201 part 2b): any open tender attempt freezes the
 * total; a successful attempt refuses; no row, or only declined / closed-out
 * never-sent attempts, allows the change. Never writes a payments row.
 */
async function paymentGuard(
  tx: Tx,
  order: LockedLine["order"]
): Promise<{ fail: Fail } | { fail: null; hasPayments: boolean }> {
  if (order.state !== "ordered") return { fail: ORDER_MOVED_ON };
  const { hasPayments, refusal } = await lockPaymentForTotalChange(tx, order);
  if (!refusal) return { fail: null, hasPayments };
  if (refusal === CHECKOUT_EXISTS) return { fail: PAYMENT_STARTED };
  if (refusal === LOCK_ORDER_MOVED_ON) return { fail: ORDER_MOVED_ON };
  return { fail: refusal };
}

async function liveRedemptions(tx: Tx, orderItemId: string) {
  return tx
    .select({
      id: voucherRedemptions.id, discountZar: voucherRedemptions.discountZar,
      at: voucherRedemptions.at, sessionId: voucherRedemptions.sessionId,
    })
    .from(voucherRedemptions)
    .where(and(eq(voucherRedemptions.orderItemId, orderItemId), isNull(voucherRedemptions.reversedAt)));
}

async function auditReject(tx: Tx, actor: Actor, orderId: string, attempted: string, orderItemId: string, f: Fail) {
  await writeAudit(
    {
      entityKind: "order", entityId: orderId, action: "reject", actorId: actor.id, actorRole: actor.role,
      after: { attempted, orderItemId, code: f.code }, reason: f.code,
    },
    tx as unknown as DB
  );
}

/**
 * redeemVoucher(orderItemId, kind) — PRD §11. Discounts one unit of the line
 * and writes one voucher_redemptions row. Errors: VOUCHER_NOT_IN_MODE ·
 * TENDER_IN_PROGRESS · VALIDATION, plus NO_SESSION, NOT_FOUND,
 * ALREADY_RESOLVED, STALE_STATE.
 */
export async function redeemVoucher(
  orderItemId: string,
  kind: string
): Promise<ActionResult<{ totalZar: number; lineDiscountZar: number }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const actor = { id: auth.session.id, role: auth.session.role };
  const id = idSchema.safeParse(orderItemId);
  const k = idSchema.safeParse(kind);
  if (!id.success || !k.success) return { ok: false, code: "VALIDATION", message: "Pick a drink and a voucher kind." };
  const now = new Date();

  return db.transaction(async (tx): Promise<ActionResult<{ totalZar: number; lineDiscountZar: number }>> => {
    const locked = await lockLine(tx, id.data);
    if ("ok" in locked) return locked;
    const { line, order } = locked;
    const guard = await paymentGuard(tx, order);
    if (guard.fail) {
      await auditReject(tx, actor, order.id, "redeem_voucher", line.id, guard.fail);
      return guard.fail;
    }
    const hasPayments = guard.hasPayments;

    const session = await lockOpenSession(tx, now);
    const live = await liveRedemptions(tx, line.id);
    const decision = decideRedeem({
      session: session ? { mode: session.mode, voucherKindsActive: session.voucherKindsActive } : null,
      kind: k.data,
      line: { ...line, surchargeZar: LINE_SURCHARGE_CHARGED_ZAR },
      live: { count: live.length, discountZar: live.reduce((sum, r) => sum + r.discountZar, 0) },
    });
    if (decision.status === "refused" || !session) {
      const f: Fail = decision.status === "refused"
        ? { ok: false, code: decision.code, message: decision.message }
        : { ok: false, code: "NO_SESSION", message: "Open the session first." };
      await auditReject(tx, actor, order.id, "redeem_voucher", line.id, f);
      return f;
    }

    const totalZar = order.totalZar - decision.discountZar;
    // As applyFreeCoffee: REQ-153 wants an R0 order to have no payments row,
    // and no payments row is ever deleted — so a row-carrying order cannot be
    // taken to R0 here.
    if (hasPayments && totalZar === 0) {
      await auditReject(tx, actor, order.id, "redeem_voucher", line.id, PAYMENT_STARTED);
      return PAYMENT_STARTED;
    }
    // L42 / REQ-153: an order that nets R0 is `free` and never gets a payments row.
    const paymentMode = totalZar === 0 ? "free" : order.paymentMode;
    const txDb = tx as unknown as DB;
    const [row] = await tx
      .insert(voucherRedemptions)
      .values({
        orderItemId: line.id, sessionId: session.id, voucherKind: k.data,
        discountZar: decision.discountZar, redeemedByStaffId: actor.id, at: now,
      })
      .returning({ id: voucherRedemptions.id });
    await tx.update(orderItems).set({ discountZar: decision.lineDiscountZar }).where(eq(orderItems.id, line.id));
    await tx
      .update(orders)
      .set({ totalZar, paymentMode: paymentMode as typeof orders.$inferInsert.paymentMode })
      .where(eq(orders.id, order.id));
    await tx
      .update(openingSessions)
      .set({ voucherRedemptionsRecorded: session.voucherRedemptionsRecorded + 1 })
      .where(eq(openingSessions.id, session.id));
    await writeAudit(
      {
        entityKind: "order", entityId: order.id, action: "redeem_voucher", actorId: actor.id, actorRole: actor.role,
        before: { totalZar: order.totalZar, lineDiscountZar: line.discountZar },
        after: {
          redemptionId: row?.id ?? null, orderItemId: line.id, sessionId: session.id, voucherKind: k.data,
          discountZar: decision.discountZar, lineDiscountZar: decision.lineDiscountZar, totalZar, paymentMode,
        },
      },
      txDb
    );
    return { ok: true, data: { totalZar, lineDiscountZar: decision.lineDiscountZar } };
  });
}

/**
 * removeVoucher(orderItemId) — PRD §11. The undo: reverses the line's latest
 * live redemption (COL-29, never a delete) and restores one unit.
 */
export async function removeVoucher(
  orderItemId: string
): Promise<ActionResult<{ totalZar: number; lineDiscountZar: number }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const actor = { id: auth.session.id, role: auth.session.role };
  const id = idSchema.safeParse(orderItemId);
  if (!id.success) return { ok: false, code: "VALIDATION", message: "Pick a drink." };
  const now = new Date();

  type Done = { totalZar: number; lineDiscountZar: number };
  return db.transaction(async (tx): Promise<ActionResult<Done>> => {
    const locked = await lockLine(tx, id.data);
    if ("ok" in locked) return locked;
    const { line, order } = locked;
    const guard = await paymentGuard(tx, order);
    if (guard.fail) {
      await auditReject(tx, actor, order.id, "remove_voucher", line.id, guard.fail);
      return guard.fail;
    }

    const live = await liveRedemptions(tx, line.id);
    const decision = decideRemove({ line, live });
    const target = decision.status === "apply" ? live.find((r) => r.id === decision.redemptionId) : undefined;
    if (decision.status === "refused" || !target) {
      const f: Fail = { ok: false, code: "VALIDATION", message: "This drink has no voucher to remove." };
      await auditReject(tx, actor, order.id, "remove_voucher", line.id, f);
      return f;
    }
    const [session] = await tx
      .select({
        id: openingSessions.id, closedAt: openingSessions.closedAt,
        voucherRedemptionsRecorded: openingSessions.voucherRedemptionsRecorded,
      })
      .from(openingSessions)
      .where(eq(openingSessions.id, target.sessionId))
      .for("update");
    // A closed session's recorded count is what its tin was reconciled
    // against; it is never changed after the close.
    if (!session || session.closedAt) {
      const f: Fail = { ok: false, code: "STALE_STATE", message: "That session is closed." };
      await auditReject(tx, actor, order.id, "remove_voucher", line.id, f);
      return f;
    }
    const totalZar = order.totalZar + decision.restoredZar;
    const txDb = tx as unknown as DB;
    await tx
      .update(voucherRedemptions)
      .set({ reversedAt: now, reversedByStaffId: actor.id })
      .where(and(eq(voucherRedemptions.id, target.id), isNull(voucherRedemptions.reversedAt)));
    await tx.update(orderItems).set({ discountZar: decision.lineDiscountZar }).where(eq(orderItems.id, line.id));
    // As declineFreeCoffee: a free order that becomes chargeable loses `free`.
    // No payments row is written here — the screen begins a tender
    // (beginTender) at the committed new total, before anything is sent
    // (REQ-026).
    const wasFree = order.paymentMode === "free";
    const paymentMode = wasFree ? null : order.paymentMode;
    await tx
      .update(orders)
      .set({ totalZar, paymentMode: paymentMode as typeof orders.$inferInsert.paymentMode })
      .where(eq(orders.id, order.id));
    await tx
      .update(openingSessions)
      .set({ voucherRedemptionsRecorded: session.voucherRedemptionsRecorded - 1 })
      .where(eq(openingSessions.id, session.id));
    await writeAudit(
      {
        entityKind: "order", entityId: order.id, action: "remove_voucher", actorId: actor.id, actorRole: actor.role,
        before: { totalZar: order.totalZar, lineDiscountZar: line.discountZar },
        after: {
          redemptionId: target.id, orderItemId: line.id, sessionId: target.sessionId,
          restoredZar: decision.restoredZar, lineDiscountZar: decision.lineDiscountZar, totalZar,
        },
      },
      txDb
    );
    return { ok: true, data: { totalZar, lineDiscountZar: decision.lineDiscountZar } };
  });
}

/**
 * getVoucherContext() — read-only, for the POS chip (§6.9.3, L48, REQ-146).
 * The open session (closed_at IS NULL, not past its forced close) decides
 * whether the chip renders and which kind it redeems. Writes nothing.
 */
export async function getVoucherContext(): Promise<ActionResult<VoucherContext>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const now = new Date();
  const [s] = await db
    .select({
      sessionDate: openingSessions.sessionDate, mode: openingSessions.mode,
      voucherKindsActive: openingSessions.voucherKindsActive, windowEndsAt: eventWindows.endsAt,
    })
    .from(openingSessions)
    .leftJoin(eventWindows, eq(openingSessions.eventWindowId, eventWindows.id))
    .where(isNull(openingSessions.closedAt))
    .limit(1);
  if (!s) return { ok: true, data: NO_VOUCHERS };
  const window = s.windowEndsAt ? { endsAt: s.windowEndsAt } : null;
  if (forcedCloseAt(s, window, revenueDay(now), now)) return { ok: true, data: NO_VOUCHERS };
  return { ok: true, data: voucherContextFor(s) };
}

/**
 * recordVoucherCount(sessionId, counted) — PRD §11. Writes the session's
 * voucher_slips_counted; a variance against voucher_redemptions_recorded
 * pushes the Admin with both figures (REQ-156). Never blocks anything (L43).
 */
export async function recordVoucherCount(
  sessionId: string,
  counted: number
): Promise<ActionResult<{ counted: number; recorded: number }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const id = idSchema.safeParse(sessionId);
  if (!id.success || !(Number.isInteger(counted) && counted >= 0)) {
    return { ok: false, code: "VALIDATION", message: "The slip count must be a whole number, 0 or more." };
  }

  const result = await db.transaction(async (tx) => {
    const [s] = await tx
      .select({
        id: openingSessions.id, sessionDate: openingSessions.sessionDate, opensAt: openingSessions.opensAt,
        voucherSlipsCounted: openingSessions.voucherSlipsCounted,
        voucherRedemptionsRecorded: openingSessions.voucherRedemptionsRecorded,
      })
      .from(openingSessions)
      .where(eq(openingSessions.id, id.data))
      .for("update");
    if (!s) return null;
    // Push only when this (counted, recorded) pair has not been recorded before.
    const v = slipVariance(s, counted);
    const variance = v && !(await pairAlreadyRecorded(tx, v)) ? v : null;
    await tx.update(openingSessions).set({ voucherSlipsCounted: counted }).where(eq(openingSessions.id, s.id));
    await writeAudit(
      {
        entityKind: "opening_session", entityId: s.id, action: "voucher_count",
        actorId: auth.session.id, actorRole: auth.session.role,
        before: { voucherSlipsCounted: s.voucherSlipsCounted },
        after: { voucherSlipsCounted: counted, voucherRedemptionsRecorded: s.voucherRedemptionsRecorded },
      },
      tx as unknown as DB
    );
    return { recorded: s.voucherRedemptionsRecorded, variance };
  });

  if (!result) return { ok: false, code: "NOT_FOUND", message: "Session not found." };
  if (result.variance) pushVoucherVariance(result.variance);
  return { ok: true, data: { counted, recorded: result.recorded } };
}
