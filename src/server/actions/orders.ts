"use server";

import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderItems,
  menuItems,
  menuCustomisations,
  customers,
  loyaltyTransactions,
  staffEntitlementLog,
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
import { sendOrderReadyPush } from "@/server/push/send";
import { isValidPushSubscription } from "@/server/push/payload";
import type { ActionResult, Order, OrderState } from "@/lib/types";

// Docs: docs/API.md · Business rules L01–L06, L14–L15.
// Roles allowed to operate the POS:
const POS_ROLES = ["barista", "manager", "admin", "owner"] as const;

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

  // Notify the live queue board that a new order is waiting.
  notifyOrderChange({
    type: "state_change",
    orderId,
    state: "ordered",
    at: new Date().toISOString(),
  }).catch(() => {}); // Non-fatal

  return { ok: true, data: { orderId, yocoClientSecret } };
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

  // Read outside the transaction — guard checks don't need to be atomic.
  const [current] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!current) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }
  if (!canTransition(current.state, toState)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Cannot move order from ${current.state} to ${toState}.`,
    };
  }

  // Track whether we need to send the ready-push after the transaction.
  let pushSubscription: unknown = null;
  let pushCustomerName: string | null = null;

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

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
        }
        // Capture push subscription for post-transaction delivery.
        const [cust] = await tx
          .select({ name: customers.name, pushSubscription: customers.pushSubscription })
          .from(customers)
          .where(eq(customers.id, current.customerId));
        pushSubscription = cust?.pushSubscription ?? null;
        pushCustomerName = cust?.name ?? null;
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
    if (err instanceof DeductionError) {
      // Structured error the client can handle (e.g. show "out of stock" toast)
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
  if (toState === "ready" && pushSubscription && isValidPushSubscription(pushSubscription)) {
    sendOrderReadyPush(pushSubscription, orderId, pushCustomerName ?? undefined).catch(
      () => {}
    );
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

  const [current] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!current) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }
  if (current.state !== "ordered") {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Only unpaid (ordered) orders can be cancelled; this one is ${current.state}.`,
    };
  }

  await db.update(orders).set({ state: "cancelled" }).where(eq(orders.id, orderId));
  await writeAudit({
    entityKind: "order",
    entityId: orderId,
    action: "cancel",
    actorId: session.id,
    actorRole: session.role,
    before: { state: current.state },
    after: { state: "cancelled" },
    reason,
  });

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
  const inserted = await db
    .insert(staffEntitlementLog)
    .values({ staffId: beneficiaryStaffId, appliedByStaffId: session.id, orderId, day })
    .onConflictDoNothing()
    .returning({ id: staffEntitlementLog.id });

  if (inserted.length === 0) {
    return {
      ok: false,
      code: "ALREADY_CLAIMED",
      message: "This staff member has already claimed their free coffee today.",
    };
  }

  await db
    .update(orders)
    .set({ totalZar: 0, isStaffDiscount: true })
    .where(eq(orders.id, orderId));

  await writeAudit({
    entityKind: "order",
    entityId: orderId,
    action: "staff_discount",
    actorId: session.id,
    actorRole: session.role,
    after: { beneficiaryStaffId, day, totalZar: 0 },
  });

  return { ok: true, data: undefined };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Reload an order with its items into the shared Order shape, including menu item names. */
async function loadOrder(orderId: string): Promise<ActionResult<Order>> {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return { ok: false, code: "NOT_FOUND", message: "Order not found." };

  const itemRows = await db
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
    .where(eq(orderItems.orderId, orderId));

  const order: Order = {
    id: o.id,
    customerId: o.customerId,
    customerName: null,
    staffId: o.staffId,
    state: o.state,
    placedAt: o.placedAt.toISOString(),
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    totalZar: o.totalZar,
    isStaffDiscount: o.isStaffDiscount,
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
