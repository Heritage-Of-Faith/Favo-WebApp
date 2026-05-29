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
import { requireRole } from "@/lib/auth/session";
import { revenueDay } from "@/lib/format";
import { canTransition } from "@/server/orders/state-machine";
import {
  computeOrderTotalZar,
  type PricedLine,
} from "@/server/orders/pricing";
import { checkStaffDiscountEligibility } from "@/server/orders/discount";
import { earnPoints } from "@/server/loyalty/calc";
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
  const session = await requireRole(...POS_ROLES);

  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid order input." };
  }
  const data = parsed.data;

  // Resolve current prices from the DB (never trust client-supplied prices).
  const menuRows = await db
    .select()
    .from(menuItems)
    .where(inArray(menuItems.id, data.items.map((i) => i.menuItemId)));
  const menuById = new Map(menuRows.map((m) => [m.id, m]));

  const modIds = data.items.flatMap((i) => i.modifications);
  const modRows = modIds.length
    ? await db
        .select()
        .from(menuCustomisations)
        .where(inArray(menuCustomisations.id, modIds))
    : [];
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

  const orderId = await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(orders)
      .values({
        customerId: data.customerId ?? null,
        staffId: session.id,
        state: "ordered",
        totalZar,
      })
      .returning({ id: orders.id });

    await tx.insert(orderItems).values(
      data.items.map((item) => {
        const mi = menuById.get(item.menuItemId)!;
        const mods = item.modifications
          .map((id) => modById.get(id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m))
          .map((m) => ({ id: m.id, name: m.name, priceDeltaZar: m.priceDeltaZar }));
        return {
          orderId: order.id,
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          unitPriceZar: mi.currentPriceZar,
          modifications: mods,
        };
      })
    );

    return order.id;
  });

  await writeAudit({
    entityKind: "order",
    entityId: orderId,
    action: "create",
    actorId: session.id,
    actorRole: session.role,
    after: { state: "ordered", totalZar, customerId: data.customerId ?? null },
  });

  // TODO (G6): create a real Yoco payment intent and return its client secret.
  return { ok: true, data: { orderId, yocoClientSecret: "" } };
}

/**
 * Move an order through the state machine. On `ready`, accrue loyalty for a
 * known customer (rule L06). Push + pg_notify wiring is G6/G7.
 */
export async function transitionOrder(
  orderId: string,
  toState: OrderState
): Promise<ActionResult<Order>> {
  const session = await requireRole(...POS_ROLES);

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

  await db
    .update(orders)
    .set({
      state: toState,
      completedAt: toState === "collected" ? new Date() : current.completedAt,
    })
    .where(eq(orders.id, orderId));

  // Loyalty accrues when the drink is ready, for a known (non-guest) customer.
  if (toState === "ready" && current.customerId) {
    const points = earnPoints(current.totalZar);
    if (points > 0) {
      await db.insert(loyaltyTransactions).values({
        customerId: current.customerId,
        orderId: current.id,
        delta: points,
        kind: "earn",
      });
      await db
        .update(customers)
        .set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${points}` })
        .where(eq(customers.id, current.customerId));
    }
    // TODO (G6/G7): notifyOrderChange(...) + sendOrderReadyPush(...)
  }

  await writeAudit({
    entityKind: "order",
    entityId: orderId,
    action: "transition",
    actorId: session.id,
    actorRole: session.role,
    before: { state: current.state },
    after: { state: toState },
  });

  return await loadOrder(orderId);
}

/** Cancel an order — valid only while still `ordered` (rule L01). */
export async function cancelOrder(
  orderId: string,
  reason: string
): Promise<ActionResult> {
  const session = await requireRole(...POS_ROLES);

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
  const session = await requireRole(...POS_ROLES);

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

/** Reload an order with its items into the shared Order shape. */
async function loadOrder(orderId: string): Promise<ActionResult<Order>> {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return { ok: false, code: "NOT_FOUND", message: "Order not found." };

  const items = await db
    .select()
    .from(orderItems)
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
    items: items.map((it) => ({
      id: it.id,
      menuItemId: it.menuItemId,
      menuItemName: "",
      quantity: it.quantity,
      unitPriceZar: it.unitPriceZar,
      modifications:
        (it.modifications as { id: string; name: string; priceDeltaZar: number }[]) ??
        [],
    })),
  };
  return { ok: true, data: order };
}
