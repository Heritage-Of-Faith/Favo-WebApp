"use server";

import { z } from "zod";
import { and, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderItems,
  menuItems,
  menuCustomisations,
  customers,
  loyaltyTransactions,
  staffEntitlementLog,
  payments,
  packRedemptions,
  coffeePacks,
} from "@db/schema";
import { writeAudit } from "@/server/audit";
import { authorize } from "@/server/auth/guard";
import { revenueDay } from "@/lib/format";
import { canTransition } from "@/server/orders/state-machine";
import { deductForOrder, DeductionError } from "@/server/orders/deduction";
import type { DB } from "@/lib/db";
import {
  computeOrderTotalZar,
  type PricedLine,
} from "@/server/orders/pricing";
import { checkStaffDiscountEligibility } from "@/server/orders/discount";
import { earnPoints } from "@/server/loyalty/calc";
import { createPaymentIntent } from "@/server/yoco/client";
import { notifyOrderChange } from "@/server/queue/notify";
import { sendOrderReadyPush, sendPointsEarnedPush } from "@/server/push/send";
import { isValidPushSubscription } from "@/server/push/payload";
import type { ActionResult, Order, OrderState } from "@/lib/types";

// Docs: docs/API.md · Business rules L01–L06, L14–L15.
// Roles allowed to operate the POS:
const POS_ROLES = ["barista", "admin"] as const;

export type CreateOrderInput = {
  customerId?: string;
  items: {
    menuItemId: string;
    quantity: number;
    modifications: string[];
  }[];
};

const createOrderSchema = z.object({
  customerId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        modifications: z.array(z.string()),
      })
    )
    .min(1),
});

/**
 * Create an order in `ordered` state and return its id + a Yoco payment intent.
 * No stock is deducted at creation (rule L01 — that happens on in_progress, P2).
 */
export async function createOrder(
  input: CreateOrderInput
): Promise<ActionResult<{ orderId: string; yocoClientSecret: string }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid order input." };
  }
  const data = parsed.data;

  // Resolve current prices from the DB (never trust client-supplied prices).
  // The item and modifier lookups are independent — run them in parallel so
  // creation costs one round trip here, not two sequential ones.
  const modIds = data.items.flatMap((i) => i.modifications);
  const [menuRows, modRows] = await Promise.all([
    db
      .select()
      .from(menuItems)
      .where(inArray(menuItems.id, data.items.map((i) => i.menuItemId))),
    modIds.length
      ? db
          .select()
          .from(menuCustomisations)
          .where(inArray(menuCustomisations.id, modIds))
      : Promise.resolve([]),
  ]);
  const menuById = new Map(menuRows.map((m) => [m.id, m]));
  const modById = new Map(modRows.map((m) => [m.id, m]));

  const lines: PricedLine[] = [];
  for (const item of data.items) {
    const mi = menuById.get(item.menuItemId);
    if (!mi) {
      return {
        ok: false,
        code: "UNKNOWN_MENU_ITEM",
        message: `Unknown menu item: ${item.menuItemId}`,
      };
    }
    const mods = item.modifications.map((id) => ({
      priceDeltaZar: modById.get(id)?.priceDeltaZar ?? 0,
    }));
    lines.push({
      unitPriceZar: mi.currentPriceZar,
      quantity: item.quantity,
      modifications: mods,
    });
  }
  const totalZar = computeOrderTotalZar(lines);

  // Pre-generate the order ID in Node so we can supply it to both the DB
  // transaction and the Yoco intent call simultaneously (gen_random_uuid() in
  // Postgres produces a v4 UUID with the same entropy — crypto.randomUUID() is
  // equivalent and lets us avoid waiting for .returning()).
  const orderId = crypto.randomUUID();

  const itemRows = data.items.map((item) => {
    const mi = menuById.get(item.menuItemId)!;
    const mods = item.modifications
      .map((id) => modById.get(id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => ({ id: m.id, name: m.name, priceDeltaZar: m.priceDeltaZar }));
    return {
      orderId,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      unitPriceZar: mi.currentPriceZar,
      modifications: mods,
    };
  });

  // Run the DB transaction and the Yoco intent creation in parallel — the
  // pre-generated orderId lets both start immediately without waiting on each
  // other. Yoco is an external HTTPS call to Ireland (~200–500ms); overlapping
  // it with the DB work removes it from the critical path entirely.
  const [, yocoResult] = await Promise.all([
    db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      // INSERT orders + INSERT order_items + writeAudit: orders must come first
      // (FK constraint), then items and audit can run in parallel since both
      // only need orderId.
      await tx.insert(orders).values({
        id: orderId,
        customerId: data.customerId ?? null,
        staffId: session.id,
        state: "ordered",
        totalZar,
      });

      await Promise.all([
        tx.insert(orderItems).values(itemRows),
        writeAudit(
          {
            entityKind: "order",
            entityId: orderId,
            action: "create",
            actorId: session.id,
            actorRole: session.role,
            after: { state: "ordered", totalZar, customerId: data.customerId ?? null },
          },
          txDb
        ),
      ]);
    }),

    // Yoco intent runs concurrently with the DB work.
    // NEVER throw on Yoco failure: the order has already been committed in the
    // parallel transaction, so throwing here would (a) show the barista a generic
    // "Failed to place order" while (b) leaving a ghost order in the DB that never
    // reaches the queue. Degrade gracefully — return null and let the POS fall back
    // to "accept cash or card manually" (yocoClientSecret === "" path in POSWorkspace).
    createPaymentIntent({ amountZar: totalZar, metadata: { orderId } }).catch(
      (err: unknown) => {
        const reason = !process.env.YOCO_SECRET_KEY ? "YOCO_SECRET_KEY not set" : String(err);
        console.error(`[createOrder] Yoco intent failed — falling back to manual payment (${reason})`);
        return null;
      }
    ),
  ]);

  const yocoClientSecret = yocoResult?.clientSecret ?? "";

  // Insert a payments row now that the order is committed and we optionally
  // have the Yoco checkout ID. yocoPaymentId is null until the webhook fires.
  await db.insert(payments).values({
    orderId,
    amountZar: totalZar,
    status: "pending",
    yocoCheckoutId: yocoResult?.id ?? null,
  });

  // Notify the live queue board that a new order is waiting.
  notifyOrderChange({
    type: "state_change",
    orderId,
    state: "ordered",
    at: new Date().toISOString(),
  }).catch(() => {}); // Non-fatal

  return { ok: true, data: { orderId, yocoClientSecret } };
}

// Local errors used to surface structured failures out of transactions
// without leaking exception details across the client boundary.
class TransitionError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID_TRANSITION" | "PAYMENT_REQUIRED",
    message: string
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

class CancelError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "CancelError";
  }
}

class DiscountError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DiscountError";
  }
}

/**
 * Move an order through the state machine.
 *
 * On `ordered → in_progress`: deducts stock atomically inside a transaction
 *   (rule L01 / R5). Returns OUT_OF_STOCK if any ingredient lot is empty.
 * On `in_progress → ready`:  accrues loyalty for known customers (rule L06).
 *
 * All DB mutations (state change + deduction + loyalty + audit) are wrapped
 * in a single transaction so every failure rolls back the full operation.
 * Side effects (push, pg_notify) fire after the transaction commits.
 */
export async function transitionOrder(
  orderId: string,
  toState: OrderState
): Promise<ActionResult<Order>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  // Fast existence check — avoids opening a transaction for a clearly missing ID.
  const [exists] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!exists) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }

  // Track whether we need to send the ready-push after the transaction.
  let pushSubscription: unknown = null;
  let pushCustomerName: string | null = null;
  let pushCustomerId: string | null = null;
  // Track loyalty earn details for points-earned push (AT-128).
  let earnedPoints = 0;
  let newLoyaltyBalance = 0;

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      // ── 0. Lock the row for the duration of this transaction ───────────────
      // SELECT FOR UPDATE makes the canTransition check and the state UPDATE
      // atomic: any concurrent transitionOrder call blocks here until we commit,
      // so two requests cannot both pass the guard and both apply their writes.
      // This eliminates the TOCTOU race between reading state and updating it.
      const [current] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");

      if (!current) throw new TransitionError("NOT_FOUND", "Order not found.");
      if (!canTransition(current.state, toState)) {
        throw new TransitionError(
          "INVALID_TRANSITION",
          `Cannot move order from ${current.state} to ${toState}.`
        );
      }

      // ── Cash-remove guard (AT-122): ordered → in_progress requires a
      // confirmed Yoco payment for non-free orders. Free orders (totalZar === 0
      // after loyalty/staff-discount) need no payment row.
      // Bypass when YOCO_SECRET_KEY is absent (dev/simulation mode — no real Yoco). ──
      if (toState === "in_progress" && current.totalZar > 0 && process.env.YOCO_SECRET_KEY) {
        const [pmt] = await tx
          .select({ status: payments.status })
          .from(payments)
          .where(eq(payments.orderId, orderId));
        if (pmt?.status !== "successful") {
          throw new TransitionError(
            "PAYMENT_REQUIRED",
            "Order cannot start — card payment not yet confirmed."
          );
        }
      }

      // ── 1. Update order state ──────────────────────────────────────────────
      await tx
        .update(orders)
        .set({
          state: toState,
          completedAt: toState === "collected" ? new Date() : current.completedAt,
        })
        .where(eq(orders.id, orderId));

      // ── 2. Deduct stock on ordered → in_progress (L01 / R5) ───────────────
      if (toState === "in_progress") {
        await deductForOrder(orderId, txDb, session.id);
      }

      // ── 3. Loyalty accrual on in_progress → ready (L06) ───────────────────
      if (toState === "ready" && current.customerId) {
        const points = earnPoints(current.totalZar);
        if (points > 0) {
          await tx.insert(loyaltyTransactions).values({
            customerId: current.customerId,
            orderId: current.id,
            delta: points,
            kind: "earn",
          });
          await tx
            .update(customers)
            .set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${points}` })
            .where(eq(customers.id, current.customerId));
          earnedPoints = points;
        }
        // Capture push subscription for post-transaction delivery.
        // Re-fetch after the loyalty update so loyaltyPoints reflects the new balance.
        const [cust] = await tx
          .select({ name: customers.name, pushSubscription: customers.pushSubscription, loyaltyPoints: customers.loyaltyPoints })
          .from(customers)
          .where(eq(customers.id, current.customerId));
        pushSubscription = cust?.pushSubscription ?? null;
        pushCustomerName = cust?.name ?? null;
        pushCustomerId = current.customerId ?? null;
        newLoyaltyBalance = cust?.loyaltyPoints ?? 0;
      }

      // ── 4. Audit ───────────────────────────────────────────────────────────
      await writeAudit(
        {
          entityKind: "order",
          entityId: orderId,
          action: "transition",
          actorId: session.id,
          actorRole: session.role,
          before: { state: current.state },
          after: { state: toState },
        },
        txDb
      );
    });
  } catch (err) {
    if (err instanceof TransitionError) {
      return { ok: false, code: err.code, message: err.message };
    }
    if (err instanceof DeductionError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err; // Unexpected — let Next.js error boundary handle it
  }

  // ── Post-transaction side effects (non-fatal) ──────────────────────────────

  // Notify SSE queue listeners of the state change.
  notifyOrderChange({
    type: "state_change",
    orderId,
    state: toState,
    at: new Date().toISOString(),
  }).catch(() => {}); // POS resyncs on reconnect if this drops

  // Push to customer device when order is ready.
  // On 410 Gone, null out the stale subscription so we don't retry it forever.
  if (toState === "ready" && pushSubscription && isValidPushSubscription(pushSubscription)) {
    sendOrderReadyPush(pushSubscription, orderId, pushCustomerName ?? undefined)
      .then((alive) => {
        if (!alive && pushCustomerId) {
          const custId = pushCustomerId;
          db.transaction(async (tx) => {
            const txDb = tx as unknown as DB;
            const cleared = await tx
              .update(customers)
              .set({ pushSubscription: null })
              .where(
                and(
                  eq(customers.id, custId),
                  eq(customers.pushSubscription, pushSubscription as Record<string, unknown>)
                )
              )
              .returning({ id: customers.id });

            if (cleared.length === 0) return;

            await writeAudit(
              {
                entityKind: "customer",
                entityId: custId,
                action: "push_unsubscribe",
                actorId: custId,
                actorRole: "customer",
              },
              txDb
            );
          }).catch(() => {});
        }
      })
      .catch((err: unknown) => {
        console.error("[push] sendOrderReadyPush failed for order", orderId, err);
      });
  }

  // Push loyalty points earned notification (AT-128) — fire-and-forget.
  if (earnedPoints > 0 && pushSubscription && isValidPushSubscription(pushSubscription)) {
    sendPointsEarnedPush(pushSubscription, earnedPoints, newLoyaltyBalance)
      .then((ok) => {
        if (!ok) {
          // Subscription expired — logged already inside sendPointsEarnedPush.
          // Pruning is handled by the order-ready push path above; skip duplicate cleanup.
        }
      })
      .catch((err: unknown) => {
        console.error("[push] sendPointsEarnedPush failed for order", orderId, err);
      });
  }

  return await loadOrder(orderId);
}

/** Cancel an order — valid only while still `ordered` (rule L01). */
export async function cancelOrder(
  orderId: string,
  reason: string
): Promise<ActionResult> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  // Fast existence check before opening a transaction.
  const [exists] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!exists) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      // SELECT FOR UPDATE serializes concurrent cancel attempts on the same order.
      // The state check and the UPDATE are now atomic — a second request will
      // block here until we commit, then re-read the already-cancelled state.
      const [current] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");

      if (!current) throw new CancelError("NOT_FOUND", "Order not found.");
      if (current.state !== "ordered") {
        throw new CancelError(
          "CONFLICT",
          `Only unpaid (ordered) orders can be cancelled; this one is ${current.state}.`
        );
      }

      // Reverse any pack redemptions on this order (AT-111).
      // Increment qty_remaining on the pack and stamp reversed_at — never delete.
      const redemptions = await tx
        .select({ id: packRedemptions.id, packId: packRedemptions.packId })
        .from(packRedemptions)
        .where(and(eq(packRedemptions.orderId, orderId), isNull(packRedemptions.reversedAt)));

      for (const r of redemptions) {
        await tx
          .update(coffeePacks)
          .set({ qtyRemaining: sql`${coffeePacks.qtyRemaining} + 1` })
          .where(eq(coffeePacks.id, r.packId));

        await tx
          .update(packRedemptions)
          .set({ reversedAt: sql`now()` })
          .where(eq(packRedemptions.id, r.id));
      }

      await tx.update(orders).set({ state: "cancelled" }).where(eq(orders.id, orderId));
      await writeAudit(
        {
          entityKind: "order",
          entityId: orderId,
          action: "cancel",
          actorId: session.id,
          actorRole: session.role,
          before: { state: current.state },
          after: { state: "cancelled", packRedemptionsReversed: redemptions.length },
          reason,
        },
        txDb
      );
    });
  } catch (err) {
    if (err instanceof CancelError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  return { ok: true, data: undefined };
}

/**
 * Apply the staff free-coffee discount (rules L03/L14): Cappuccino + weekday,
 * 100% off, once per staff per day (DB UNIQUE enforces the daily limit).
 */
export async function applyStaffDiscount(
  orderId: string,
  beneficiaryStaffId: string
): Promise<ActionResult> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  const [current] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!current) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }

  // The order must contain a Cappuccino.
  const lines = await db
    .select({ name: menuItems.name })
    .from(orderItems)
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(eq(orderItems.orderId, orderId));

  const cappuccino = lines.find(
    (l) => l.name.trim().toLowerCase() === "cappuccino"
  );
  const eligibility = checkStaffDiscountEligibility(
    cappuccino?.name ?? "",
    new Date()
  );
  if (!eligibility.eligible) {
    return { ok: false, code: eligibility.code, message: eligibility.message };
  }

  const day = revenueDay();

  // Wrap the entitlement insert, order update, and audit in one transaction so
  // they are all-or-nothing. The UNIQUE index on (staffId, day) enforces the
  // daily limit at DB level — onConflictDoNothing handles a concurrent race
  // between two requests for the same staff on the same day.
  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      const inserted = await tx
        .insert(staffEntitlementLog)
        .values({ staffId: beneficiaryStaffId, appliedByStaffId: session.id, orderId, day })
        .onConflictDoNothing()
        .returning({ id: staffEntitlementLog.id });

      if (inserted.length === 0) {
        throw new DiscountError(
          "ALREADY_CLAIMED",
          "This staff member has already claimed their free coffee today."
        );
      }

      await tx
        .update(orders)
        .set({ totalZar: 0, isStaffDiscount: true })
        .where(eq(orders.id, orderId));

      // Mark the payment row as free — no Yoco card transaction needed for
      // staff discount orders. Setting amountZar=0 + status=successful keeps
      // the daily close reconciliation accurate (both revenue and payments = 0).
      await tx
        .update(payments)
        .set({ amountZar: 0, status: "successful" })
        .where(eq(payments.orderId, orderId));

      await writeAudit(
        {
          entityKind: "order",
          entityId: orderId,
          action: "staff_discount",
          actorId: session.id,
          actorRole: session.role,
          after: { beneficiaryStaffId, day, totalZar: 0 },
        },
        txDb
      );
    });
  } catch (err) {
    if (err instanceof DiscountError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  return { ok: true, data: undefined };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Reload an order with its items into the shared Order shape, including menu item names. */
async function loadOrder(orderId: string): Promise<ActionResult<Order>> {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return { ok: false, code: "NOT_FOUND", message: "Order not found." };

  const [itemRows, paymentRow, customerRow] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        menuItemId: orderItems.menuItemId,
        menuItemName: menuItems.name,
        quantity: orderItems.quantity,
        unitPriceZar: orderItems.unitPriceZar,
        modifications: orderItems.modifications,
      })
      .from(orderItems)
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(eq(orderItems.orderId, orderId)),
    db
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .limit(1),
    o.customerId
      ? db
          .select({ name: customers.name })
          .from(customers)
          .where(eq(customers.id, o.customerId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const order: Order = {
    id: o.id,
    customerId: o.customerId,
    customerName: customerRow[0]?.name ?? null,
    staffId: o.staffId,
    state: o.state,
    placedAt: o.placedAt.toISOString(),
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    totalZar: o.totalZar,
    isStaffDiscount: o.isStaffDiscount,
    paymentStatus: paymentRow[0]?.status ?? null,
    items: itemRows.map((it) => ({
      id: it.id,
      menuItemId: it.menuItemId,
      menuItemName: it.menuItemName ?? it.menuItemId,
      quantity: it.quantity,
      unitPriceZar: it.unitPriceZar,
      modifications:
        (it.modifications as { id: string; name: string; priceDeltaZar: number }[]) ??
        [],
    })),
  };
  return { ok: true, data: order };
}

/** Bootstrap the POS queue on page load — returns non-terminal orders from the last 48 h. */
export async function listActiveOrders(): Promise<ActionResult<{ orderId: string; state: OrderState; lastUpdatedAt: string; customerName: string | null }[]>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;

  // 48-hour window covers orders that span the SAST midnight boundary and any
  // that are stuck in a non-terminal state from the previous shift.
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: orders.id,
      state: orders.state,
      placedAt: orders.placedAt,
      customerName: customers.name,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(and(notInArray(orders.state, ["collected", "cancelled"]), gte(orders.placedAt, cutoff)))
    .orderBy(orders.placedAt);

  return {
    ok: true,
    data: rows.map((r) => ({
      orderId: r.id,
      state: r.state,
      lastUpdatedAt: r.placedAt.toISOString(),
      customerName: r.customerName ?? null,
    })),
  };
}

// ─── getOrderItems (AT-116) ───────────────────────────────────────────────────

/**
 * Returns the line items for a given order with their DB IDs. Used by the POS
 * payment panel to look up orderLineRef values for pack redemption (AT-116).
 * One row per order_items row — quantities > 1 produce multiple rows.
 */
export async function getOrderItems(
  orderId: string
): Promise<ActionResult<{ id: string; menuItemId: string; menuItemName: string; unitPriceZar: number }[]>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;

  if (!orderId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "orderId is required." };
  }

  const rows = await db
    .select({
      id: orderItems.id,
      menuItemId: orderItems.menuItemId,
      menuItemName: menuItems.name,
      unitPriceZar: orderItems.unitPriceZar,
    })
    .from(orderItems)
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(eq(orderItems.orderId, orderId));

  return { ok: true, data: rows };
}
