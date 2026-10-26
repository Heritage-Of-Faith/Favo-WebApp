"use server";

// The Untracked hot drink voucher — AT-204 (backend). PRD §6.9, §11
// (redeemVoucher · removeVoucher · recordVoucherCount), L41, L42, L43, COL-29.
//
//  - One voucher = one cup: discount_zar grows by one unit's line_unit_price
//    and one voucher_redemptions row is written, in ONE transaction.
//  - Removal is a reversal (reversed_at, reversed_by_staff_id), never a delete.
//  - opening_sessions.voucher_redemptions_recorded follows the live rows: it is
//    changed by one under the session row's lock, in the same transaction.
//  - Payments (P4), mirroring applyFreeCoffee / declineFreeCoffee (Mia, Q2(b)
//    and Q3): a pending row with no Yoco checkout follows the order's total;
//    a checkout, a non-pending row or an order past `ordered` refuses. With a
//    row present, a voucher that would take the order to R0 is refused, as
//    applyFreeCoffee refuses it (no payments row is ever deleted). A rowless
//    order that nets R0 becomes payment_mode='free' (L42). removeVoucher on a
//    free order writes a pending row first, then creates the checkout.
//  - Refusals are returned, not thrown, so their reject audit commits.

import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import {
  orders, orderItems, payments, openingSessions, eventWindows, voucherRedemptions,
} from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { revenueDay } from "@/lib/format";
import { forcedCloseAt } from "@/lib/session-mode";
import { decideRedeem, decideRemove } from "@/server/orders/voucher";
import { pushVoucherVariance, slipVariance } from "@/server/push/admin-alert";
import {
  CHECKOUT_EXISTS, ORDER_MOVED_ON as LOCK_ORDER_MOVED_ON, ROW_NOT_WRITTEN_YET, lockPaymentForTotalChange,
} from "@/server/orders/payment-lock";
import { createPaymentIntent } from "@/server/yoco/client";
import type { ActionResult } from "@/lib/types";

const POS_ROLES = ["barista", "admin"] as const;

// createOrder charges no extra-shot surcharge today: there is no
// extra_shot_zar in app_config and no surcharge on the order_items line, so
// what the line was charged per unit is unit_price_zar + mods_zar. A voucher
// can only take off what the line was charged.
const LINE_SURCHARGE_CHARGED_ZAR = 0;

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

/** Read the line, lock its order and any payments row, and say whether the total may change. */
async function lockLine(tx: Tx, orderItemId: string): Promise<LockedLine | Fail> {
  const [line] = await tx
    .select({
      id: orderItems.id, orderId: orderItems.orderId, quantity: orderItems.quantity,
      unitPriceZar: orderItems.unitPriceZar, modsZar: orderItems.modsZar,
      discountZar: orderItems.discountZar, compReason: orderItems.compReason,
    })
    .from(orderItems)
    .where(eq(orderItems.id, orderItemId));
  if (!line) return { ok: false, code: "NOT_FOUND", message: "That drink isn't on an order." };
  const [order] = await tx
    .select({ id: orders.id, state: orders.state, totalZar: orders.totalZar, paymentMode: orders.paymentMode })
    .from(orders)
    .where(eq(orders.id, line.orderId))
    .for("update");
  if (!order) return { ok: false, code: "NOT_FOUND", message: "That drink isn't on an order." };
  return { line, order };
}

/**
 * P4 guard — lockPaymentForTotalChange, the rule applyFreeCoffee uses (owner
 * rule, Mia 12 Oct 2026; for vouchers, Mia Q2(b)): a pending row with no Yoco
 * checkout may follow the order's total; anything further along refuses.
 * The one addition: an offline (yoco_deferred) order has no row by design, so
 * it is not mistaken for one still inside createOrder.
 */
async function paymentGuard(
  tx: Tx,
  order: LockedLine["order"]
): Promise<{ fail: Fail } | { fail: null; payment: { id: string } | null }> {
  if (order.state !== "ordered") return { fail: ORDER_MOVED_ON };
  const { payment, refusal } = await lockPaymentForTotalChange(tx, order);
  if (!refusal) return { fail: null, payment };
  if (refusal === ROW_NOT_WRITTEN_YET && !payment && order.paymentMode === "yoco_deferred") {
    return { fail: null, payment: null };
  }
  if (refusal === CHECKOUT_EXISTS) return { fail: PAYMENT_STARTED };
  if (refusal === LOCK_ORDER_MOVED_ON) return { fail: ORDER_MOVED_ON };
  return { fail: refusal };
}

/** The one open session (closed_at IS NULL), locked; null if none or past its end (L07, COL-11). */
async function lockOpenSession(tx: Tx, now: Date) {
  const [s] = await tx
    .select({
      id: openingSessions.id, sessionDate: openingSessions.sessionDate, mode: openingSessions.mode,
      voucherKindsActive: openingSessions.voucherKindsActive, eventWindowId: openingSessions.eventWindowId,
      voucherRedemptionsRecorded: openingSessions.voucherRedemptionsRecorded,
    })
    .from(openingSessions)
    .where(isNull(openingSessions.closedAt))
    .for("update");
  if (!s) return null;
  let window: { endsAt: Date } | null = null;
  if (s.eventWindowId) {
    const [w] = await tx
      .select({ endsAt: eventWindows.endsAt })
      .from(eventWindows)
      .where(eq(eventWindows.id, s.eventWindowId));
    window = w ?? null;
  }
  return forcedCloseAt(s, window, revenueDay(now), now) ? null : s;
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
    const payment = guard.payment;

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
    if (payment && totalZar === 0) {
      await auditReject(tx, actor, order.id, "redeem_voucher", line.id, PAYMENT_STARTED);
      return PAYMENT_STARTED;
    }
    // L42 / REQ-153: an order that nets R0 is `free` and never gets a payments row.
    const paymentMode = totalZar === 0 ? "free" : order.paymentMode;
    const txDb = tx as unknown as DB;
    if (payment) {
      // A pending row with no checkout: keep its amount equal to the order's.
      await tx.update(payments).set({ amountZar: totalZar }).where(eq(payments.id, payment.id));
    }
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
): Promise<ActionResult<{ totalZar: number; lineDiscountZar: number; yocoClientSecret: string }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const actor = { id: auth.session.id, role: auth.session.role };
  const id = idSchema.safeParse(orderItemId);
  if (!id.success) return { ok: false, code: "VALIDATION", message: "Pick a drink." };
  const now = new Date();

  type Done = { totalZar: number; lineDiscountZar: number; orderId: string; rowCreated: boolean };
  const result = await db.transaction(async (tx): Promise<ActionResult<Done>> => {
    const locked = await lockLine(tx, id.data);
    if ("ok" in locked) return locked;
    const { line, order } = locked;
    const guard = await paymentGuard(tx, order);
    if (guard.fail) {
      await auditReject(tx, actor, order.id, "remove_voucher", line.id, guard.fail);
      return guard.fail;
    }
    const payment = guard.payment;

    const live = await liveRedemptions(tx, line.id);
    const decision = decideRemove({ line, live });
    const target = decision.status === "apply" ? live.find((r) => r.id === decision.redemptionId) : undefined;
    if (decision.status === "refused" || !target) {
      const f: Fail = { ok: false, code: "VALIDATION", message: "This drink has no voucher to remove." };
      await auditReject(tx, actor, order.id, "remove_voucher", line.id, f);
      return f;
    }
    const [session] = await tx
      .select({ id: openingSessions.id, voucherRedemptionsRecorded: openingSessions.voucherRedemptionsRecorded })
      .from(openingSessions)
      .where(eq(openingSessions.id, target.sessionId))
      .for("update");
    const totalZar = order.totalZar + decision.restoredZar;
    const txDb = tx as unknown as DB;
    await tx
      .update(voucherRedemptions)
      .set({ reversedAt: now, reversedByStaffId: actor.id })
      .where(and(eq(voucherRedemptions.id, target.id), isNull(voucherRedemptions.reversedAt)));
    await tx.update(orderItems).set({ discountZar: decision.lineDiscountZar }).where(eq(orderItems.id, line.id));
    // As declineFreeCoffee: a free order that becomes chargeable loses `free`
    // and gets a pending row at the new total, written BEFORE anything is sent.
    const wasFree = order.paymentMode === "free";
    const paymentMode = wasFree ? null : order.paymentMode;
    await tx
      .update(orders)
      .set({ totalZar, paymentMode: paymentMode as typeof orders.$inferInsert.paymentMode })
      .where(eq(orders.id, order.id));
    let rowCreated = false;
    if (payment) {
      // A pending row with no checkout: keep its amount equal to the order's.
      await tx.update(payments).set({ amountZar: totalZar }).where(eq(payments.id, payment.id));
    } else if (wasFree) {
      await tx.insert(payments).values({ orderId: order.id, amountZar: totalZar, status: "pending" });
      rowCreated = true;
    }
    if (session) {
      await tx
        .update(openingSessions)
        .set({ voucherRedemptionsRecorded: session.voucherRedemptionsRecorded - 1 })
        .where(eq(openingSessions.id, session.id));
    }
    await writeAudit(
      {
        entityKind: "order", entityId: order.id, action: "remove_voucher", actorId: actor.id, actorRole: actor.role,
        before: { totalZar: order.totalZar, lineDiscountZar: line.discountZar },
        after: {
          redemptionId: target.id, orderItemId: line.id, sessionId: target.sessionId,
          restoredZar: decision.restoredZar, lineDiscountZar: decision.lineDiscountZar, totalZar,
          paymentRow: payment ? "repriced" : rowCreated ? "created" : "none",
        },
      },
      txDb
    );
    return {
      ok: true,
      data: { totalZar, lineDiscountZar: decision.lineDiscountZar, orderId: order.id, rowCreated },
    };
  });

  if (!result.ok) return result;
  const { totalZar, lineDiscountZar, orderId, rowCreated } = result.data;
  let yocoClientSecret = "";
  if (rowCreated) {
    // As declineFreeCoffee: the pending row is committed; now price the checkout from it.
    const intent = await createPaymentIntent({ amountZar: totalZar, metadata: { orderId } }).catch(() => null);
    if (intent?.id) {
      await db
        .update(payments)
        .set({ yocoCheckoutId: intent.id })
        .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")));
    }
    yocoClientSecret = intent?.clientSecret ?? "";
  }
  return { ok: true, data: { totalZar, lineDiscountZar, yocoClientSecret } };
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
    return { recorded: s.voucherRedemptionsRecorded, variance: slipVariance(s, counted) };
  });

  if (!result) return { ok: false, code: "NOT_FOUND", message: "Session not found." };
  if (result.variance) pushVoucherVariance(result.variance);
  return { ok: true, data: { counted, recorded: result.recorded } };
}
