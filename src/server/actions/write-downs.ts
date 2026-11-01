"use server";

// AT-209 — two of §7.3.1's discretionary write-downs, at the counter.
//
//   compOrderLine(orderItemId, reason, adminPin?)   L33, §11.2, REQ-059, REQ-152
//   abandonOrder(orderId, reason)                   T6 step 2b (§6.0.7), REQ-041
//
// Neither creates revenue, touches `payments` or `price_history`, or returns
// money (L02). A comp only lowers what the order will be charged; an abandon
// records waste against an order that was made.
//
// Every refusal is RETURNED, never thrown inside the transaction, so its
// `action='reject'` audit row commits (CLAUDE.md §5, PRD §10.3.2, REQ-064).
// The PIN is never logged, echoed or audited (§9.5.3).
//
// What the weekly write-down block (§7.3.1, not built here) will read:
//   comps     order_items.discount_zar + comp_reason, and the audit_log row
//             action='comp' carrying actor_id (the barista), the value and
//             on_behalf_of_staff_id where an admin PIN authorised it.
//   abandoned waste_log rows category='abandoned' with order_id and
//             by_staff_id, and the audit_log row action='override'.

import { z } from "zod";
import { and, eq, gte, lt, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import {
  orders,
  orderItems,
  menuItems,
  payments,
  openingSessions,
  auditLog,
  appConfig,
  wasteLog,
} from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { verifyAdminPin } from "@/server/auth/admin-pin";
import { alertAdmins } from "@/server/push/admin-alert";
import { notifyOrderChange } from "@/server/queue/notify";
import { isAttemptOpen } from "@/server/tender/tender";
import { revenueDay } from "@/lib/format";
import {
  COMP_REASONS,
  COMP_COPY,
  COMPS_PER_SESSION_WITHOUT_PIN,
  DEFAULT_EXTRA_SHOT_ZAR,
  DEFAULT_MAX_SHOTS_PER_LINE,
  decideComp,
  type CompReason,
} from "@/server/orders/comp";
import { currentSessionWindow } from "@/server/orders/session-window";
import type { ActionResult } from "@/lib/types";

const POS_ROLES = ["barista", "admin"] as const;
const TENANT = "hofmi";

type Session = { id: string; name: string; role: string };
type Refusal = { ok: false; code: string; message: string };

const COPY = {
  NOT_FOUND_LINE: "That order line no longer exists.",
  NOT_FOUND_ORDER: "Order not found.",
  NO_SESSION: "Open today's session first.",
  COMP_MOVED_ON: "This order is cancelled or already collected — it can't be comped.",
  ALREADY_RESOLVED: "Already paid — do not charge again",
  /** PRD §6.0.1 TENDER_IN_PROGRESS copy, verbatim (P4). */
  TENDER_IN_PROGRESS: "This order is at the card machine — finish or cancel the payment first",
  COMP_NEEDS_RERING: "This order already went to the card machine, so it can't be comped to R0. Cancel and re-ring it.",
  ABANDON_NOT_STARTED: "Only a drink that was started can be logged as abandoned. Use Cancel instead.",
  ABANDON_REASON: "Say why the drink was abandoned.",
  VALIDATION: "Invalid input.",
  /** AT-207: not PRD copy (the PRD gives none for these refusals). */
  WRITTEN_OFF_COMP: "This order was written off at the daily close and cannot be comped.",
  WRITTEN_OFF_ABANDON: "This order was written off at the daily close and cannot be logged as abandoned.",
} as const;

// ─── compOrderLine ───────────────────────────────────────────────────────────

const compSchema = z.object({
  orderItemId: z.string().min(1),
  reason: z.enum(COMP_REASONS),
  adminPin: z.string().optional(),
});

export type CompResult = {
  orderId: string;
  orderItemId: string;
  compReason: CompReason;
  valueZar: number;
  totalZar: number;
  /** True when this comp was past the session's two and an admin PIN authorised it. */
  adminOverride: boolean;
};

async function rejectComp(
  client: DB | undefined,
  session: Session,
  orderItemId: unknown,
  code: string,
  message: string,
  detail: Record<string, unknown> = {}
): Promise<Refusal> {
  await writeAudit(
    {
      entityKind: "order_item",
      entityId: typeof orderItemId === "string" ? orderItemId : "",
      action: "reject",
      actorId: session.id,
      actorRole: session.role,
      after: { attempted: "comp", code, ...detail },
      reason: code,
    },
    client
  );
  return { ok: false, code, message };
}

/** An integer app_config value (§10.4), or the PRD default when none is stored. */
async function readIntConfig(tx: Pick<DB, "select">, key: string, fallback: number): Promise<number> {
  const [row] = await tx
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.tenantId, TENANT), eq(appConfig.key, key)))
    .limit(1);
  const v = row?.value;
  return typeof v === "number" && Number.isInteger(v) ? v : fallback;
}

/** The current session's window and this barista's comps in it; null = NO_SESSION. */
async function compsInCurrentSession(client: Pick<DB, "select">, staffId: string, now: Date) {
  const day = revenueDay(now);
  const sessionRows = await client
    .select({ opensAt: openingSessions.opensAt })
    .from(openingSessions)
    .where(eq(openingSessions.sessionDate, day));
  const window = currentSessionWindow(day, sessionRows.map((r) => r.opensAt), now);
  if (!window) return null;
  const prior = await client
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityKind, "order_item"),
      eq(auditLog.action, "comp"),
      eq(auditLog.actorId, staffId),
      gte(auditLog.at, window.from),
      lt(auditLog.at, window.to),
    ));
  return { day, window, count: prior.length };
}

/** Orders a comp may touch: not cancelled, not handed over (§11.2 names no state; the unpaid / no-open-attempt checks do the rest). */
const COMPABLE_STATES = ["ordered", "in_progress", "ready"] as const;

/**
 * L33: comp one order line to R0. `reason` is from the closed list. Refuses a
 * second comp on the order, a line already carrying a free cup or a voucher
 * (L41), a value above min(line_gross − discount_zar, (highest live menu price
 * + (T15 − 2) × extra_shot_zar) × quantity), and — for a barista — a third comp
 * in the session without an admin PIN (COMP_LIMIT). Only while the order is
 * not cancelled or collected, unpaid, and has no open tender attempt (P4,
 * REQ-028).
 */
export async function compOrderLine(
  orderItemId: string,
  reason: string,
  adminPin?: string
): Promise<ActionResult<CompResult>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session as Session;

  const parsed = compSchema.safeParse({ orderItemId, reason, adminPin });
  if (!parsed.success) {
    return rejectComp(undefined, session, orderItemId, "VALIDATION", COPY.VALIDATION, { reasonGiven: typeof reason === "string" ? reason : null });
  }
  const input = parsed.data;

  // The admin PIN is checked before any row is locked (bcrypt is slow), and
  // only when it is actually required: a barista at or past the session's two
  // comps. A PIN supplied when none is needed is ignored — never checked, never
  // counted toward the lockout. An Admin comps without a PIN (§10.7). The count
  // is re-read under the lock below; if it grew meanwhile, COMP_LIMIT.
  const now = new Date();
  let overridingAdminId: string | null = null;
  if (input.adminPin !== undefined && session.role === "barista") {
    const pre = await compsInCurrentSession(db, session.id, now);
    if (pre && pre.count >= COMPS_PER_SESSION_WITHOUT_PIN) {
      const pin = await verifyAdminPin(input.adminPin, session);
      if (!pin.ok) return rejectComp(undefined, session, input.orderItemId, pin.code, pin.message, { adminPin: "refused" });
      overridingAdminId = pin.adminStaffId;
    }
  }

  const result = await db.transaction(async (tx): Promise<ActionResult<CompResult> & { exceeded?: boolean }> => {
    const txDb = tx as unknown as DB;

    const [found] = await tx
      .select({ orderId: orderItems.orderId })
      .from(orderItems)
      .where(eq(orderItems.id, input.orderItemId));
    if (!found) return rejectComp(txDb, session, input.orderItemId, "NOT_FOUND", COPY.NOT_FOUND_LINE);

    // The order row lock is the one beginTender takes: a comp and a tender
    // start cannot interleave (P4).
    const [order] = await tx.select().from(orders).where(eq(orders.id, found.orderId)).for("update");
    if (!order) return rejectComp(txDb, session, input.orderItemId, "NOT_FOUND", COPY.NOT_FOUND_ORDER);
    // AT-207 / §10.3.3: the close wrote this order off at its total; a comp
    // would make that total drift from the day's daily_closes figure.
    if (order.writtenOffAt) {
      return rejectComp(txDb, session, input.orderItemId, "ORDER_WRITTEN_OFF", COPY.WRITTEN_OFF_COMP, { orderId: order.id });
    }
    if (!(COMPABLE_STATES as readonly string[]).includes(order.state)) {
      return rejectComp(txDb, session, input.orderItemId, "STALE_STATE", COPY.COMP_MOVED_ON, { orderId: order.id, state: order.state });
    }

    const attempts = await tx
      .select({ attempt: payments.attempt, status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(payments.attempt)
      .for("update");
    if (attempts.some((p) => p.status === "successful")) {
      return rejectComp(txDb, session, input.orderItemId, "ALREADY_RESOLVED", COPY.ALREADY_RESOLVED, { orderId: order.id });
    }
    const open = attempts.find(isAttemptOpen);
    if (open) {
      return rejectComp(txDb, session, input.orderItemId, "TENDER_IN_PROGRESS", COPY.TENDER_IN_PROGRESS, {
        orderId: order.id, openAttempt: open.attempt, openStatus: open.status,
      });
    }
    // AT-203 / REQ-167: an order settled from a blessing fund is frozen exactly
    // as P4 freezes it during a card tender — a comp is TENDER_IN_PROGRESS.
    if (order.paymentMode === "donor_fund") {
      return rejectComp(txDb, session, input.orderItemId, "TENDER_IN_PROGRESS", COPY.TENDER_IN_PROGRESS, {
        orderId: order.id, why: "fund_settled",
      });
    }

    // One barista's comps are counted and written one at a time, so two taps
    // cannot both be "the second comp" (L33's cap).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"comp:" + session.id}))`);

    const inSession = await compsInCurrentSession(tx, session.id, now);
    if (!inSession) return rejectComp(txDb, session, input.orderItemId, "NO_SESSION", COPY.NO_SESSION, { orderId: order.id });
    const { day, window } = inSession;

    const lines = await tx
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        unitPriceZar: orderItems.unitPriceZar,
        modsZar: orderItems.modsZar,
        discountZar: orderItems.discountZar,
        compReason: orderItems.compReason,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const line = lines.find((l) => l.id === input.orderItemId);
    if (!line) return rejectComp(txDb, session, input.orderItemId, "NOT_FOUND", COPY.NOT_FOUND_LINE);

    const [priceRow] = await tx
      .select({ highest: max(menuItems.currentPriceZar) })
      .from(menuItems)
      .where(eq(menuItems.active, true));
    const highestLivePriceZar = priceRow?.highest ?? 0;
    const maxShotsPerLine = await readIntConfig(tx, "max_shots_per_line", DEFAULT_MAX_SHOTS_PER_LINE);
    const extraShotZar = await readIntConfig(tx, "extra_shot_zar", DEFAULT_EXTRA_SHOT_ZAR);

    const decision = decideComp({
      line,
      orderHasComp: lines.some((l) => l.compReason !== null),
      highestLivePriceZar,
      maxShotsPerLine,
      extraShotZar,
    });
    if (decision.status === "refused") {
      return rejectComp(txDb, session, input.orderItemId, decision.code, decision.message, {
        orderId: order.id, why: decision.reason,
      });
    }

    // L33: two per barista per session; the third needs an admin PIN.
    const compsBefore = inSession.count;
    const needsPin = session.role === "barista" && compsBefore >= COMPS_PER_SESSION_WITHOUT_PIN;
    if (needsPin && !overridingAdminId) {
      return rejectComp(txDb, session, input.orderItemId, "COMP_LIMIT", COMP_COPY.COMP_LIMIT, {
        orderId: order.id, why: "session_limit", compsInSession: compsBefore,
      });
    }

    const totalZar = order.totalZar - decision.valueZar;
    // REQ-153: an R0 order has no payments row, and no payments row is ever
    // deleted — so an order that already holds one (a declined attempt) is not
    // taken to R0 here. Same rule as applyFreeCoffee.
    if (attempts.length > 0 && totalZar === 0) {
      // No tender is open here, so this is VALIDATION, never TENDER_IN_PROGRESS.
      return rejectComp(txDb, session, input.orderItemId, "VALIDATION", COPY.COMP_NEEDS_RERING, {
        orderId: order.id, why: "order_has_payment_rows",
      });
    }

    const discountZar = line.discountZar + decision.valueZar;
    await tx
      .update(orderItems)
      .set({ discountZar, compReason: input.reason })
      .where(eq(orderItems.id, line.id));
    await tx
      .update(orders)
      .set({ totalZar, paymentMode: totalZar === 0 ? "free" : order.paymentMode })
      .where(eq(orders.id, order.id));
    await writeAudit(
      {
        entityKind: "order_item",
        entityId: line.id,
        action: "comp",
        actorId: session.id,
        actorRole: session.role,
        ...(needsPin && overridingAdminId ? { onBehalfOfStaffId: overridingAdminId } : {}),
        before: { discountZar: line.discountZar, compReason: null, orderTotalZar: order.totalZar },
        after: {
          orderId: order.id,
          compReason: input.reason,
          discountZar,
          valueZar: decision.valueZar,
          ceilingZar: decision.ceilingZar,
          orderTotalZar: totalZar,
          session: { date: day, opensAt: window.opensAt },
          compsInSessionBefore: compsBefore,
        },
        reason: input.reason,
      },
      txDb
    );
    return {
      ok: true,
      data: {
        orderId: order.id,
        orderItemId: line.id,
        compReason: input.reason,
        valueZar: decision.valueZar,
        totalZar,
        adminOverride: needsPin,
      },
      exceeded: needsPin,
    };
  });

  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  // L33: "a session exceeding the ceiling raises the same admin push as an L09
  // stock mismatch". After commit; never throws.
  if (result.exceeded) {
    void alertAdmins(
      "Comp limit exceeded",
      `${session.name ?? session.id} comped a third drink this session (${result.data.compReason}), authorised by admin PIN.`,
      { kind: "comp_limit_exceeded", baristaStaffId: session.id, orderId: result.data.orderId, orderItemId: result.data.orderItemId }
    );
  }
  return { ok: true, data: result.data };
}

// ─── abandonOrder (T6 step 2b) ──────────────────────────────────────────────

const abandonSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(1),
});

/**
 * T6 step 2b: the customer left mid-make. The barista alone, no PIN, "because
 * it reverses nothing": the order leaves the queue (state 'cancelled'), one
 * waste_log row (category 'abandoned', order_id, the mandatory reason) records
 * the made drink, and audit_log takes action='override'. No compensating stock
 * movement — the drink was made and its ingredients consumed. Payments are not
 * touched: L02 keeps the money.
 */
export async function abandonOrder(
  orderId: string,
  reason: string
): Promise<ActionResult<{ wasteLogId: string }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session as Session;

  const reject = async (client: DB | undefined, code: string, message: string, detail: Record<string, unknown> = {}): Promise<Refusal> => {
    await writeAudit(
      {
        entityKind: "order",
        entityId: typeof orderId === "string" ? orderId : "",
        action: "reject",
        actorId: session.id,
        actorRole: session.role,
        after: { attempted: "abandon", code, ...detail },
        reason: code,
      },
      client
    );
    return { ok: false, code, message };
  };

  const parsed = abandonSchema.safeParse({ orderId, reason });
  if (!parsed.success) {
    const noReason = typeof orderId === "string" && orderId.length > 0;
    return reject(undefined, "VALIDATION", noReason ? COPY.ABANDON_REASON : COPY.VALIDATION);
  }
  const input = parsed.data;

  const result = await db.transaction(async (tx): Promise<ActionResult<{ wasteLogId: string }>> => {
    const txDb = tx as unknown as DB;
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order) return reject(txDb, "NOT_FOUND", COPY.NOT_FOUND_ORDER);
    // AT-207 / §10.3.3: the close wrote this order off; that is its outcome.
    if (order.writtenOffAt) return reject(txDb, "ORDER_WRITTEN_OFF", COPY.WRITTEN_OFF_ABANDON);
    if (order.state !== "in_progress" && order.state !== "ready") {
      return reject(txDb, "STALE_STATE", COPY.ABANDON_NOT_STARTED, { state: order.state });
    }

    // REQ-028 / P4: nothing ends an order while a tender attempt is open
    // (pending, or sent and unresolved) — the same check cancelOrder makes.
    const attempts = await tx
      .select({ attempt: payments.attempt, status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId })
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(payments.attempt);
    const open = attempts.find(isAttemptOpen);
    if (open) {
      return reject(txDb, "TENDER_IN_PROGRESS", COPY.TENDER_IN_PROGRESS, { openAttempt: open.attempt, openStatus: open.status });
    }

    const lines = await tx
      .select({ quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const cups = lines.reduce((n, l) => n + l.quantity, 0);

    const [waste] = await tx
      .insert(wasteLog)
      .values({
        category: "abandoned",
        orderId: order.id,
        inventoryLotId: null,
        quantity: Math.max(cups, 1),
        reason: input.reason,
        byStaffId: session.id,
      })
      .returning({ id: wasteLog.id });
    await tx.update(orders).set({ state: "cancelled" }).where(eq(orders.id, order.id));

    await writeAudit(
      {
        entityKind: "waste_log",
        entityId: waste.id,
        action: "create",
        actorId: session.id,
        actorRole: session.role,
        after: { category: "abandoned", orderId: order.id, quantity: Math.max(cups, 1) },
        reason: input.reason,
      },
      txDb
    );
    await writeAudit(
      {
        entityKind: "order",
        entityId: order.id,
        action: "override",
        actorId: session.id,
        actorRole: session.role,
        before: { state: order.state },
        after: { state: "cancelled", abandoned: true, wasteLogId: waste.id },
        reason: input.reason,
      },
      txDb
    );
    return { ok: true, data: { wasteLogId: waste.id } };
  });

  if (result.ok) {
    // "The order leaves the queue immediately" (T6).
    notifyOrderChange({ type: "state_change", orderId: input.orderId, state: "cancelled", at: new Date().toISOString() }).catch(() => {});
  }
  return result;
}
