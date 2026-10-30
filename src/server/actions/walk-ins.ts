"use server";

// AT-209 (first slice) — walk-in logging. PRD §6.5, §10.2, §11
// (logWalkIn(orderId, menuItemId, quantity) | barista | Inserts walk_ins.
// Never charges. Never touches staff_entitlement_log), L20, REQ-058, REQ-064.
//
// A walk-in is a log, not a price change: this action writes one walk_ins row
// and its audit row, and nothing else — no payments, orders or order_items
// write, no staff_entitlement_log read or write. Weekday orders carry no
// payment step (L19, S7a); that is where "not charged" lives, not here.
// No identity of any kind is taken or stored. No daily limit (§6.5): barista
// discretion, logged for visibility.

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { orders, orderItems, menuItems, walkIns } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";

const POS_ROLES = ["barista", "admin"] as const;

const logWalkInSchema = z.object({
  orderId: z.string().min(1),
  menuItemId: z.string().min(1),
  quantity: z.number().int().min(1),
});

export type WalkInRefusalCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "ORDER_CANCELLED"
  | "NOT_ON_ORDER"
  | "QUANTITY_EXCEEDS_LINE";

const WALK_IN_COPY: Record<WalkInRefusalCode, string> = {
  INVALID_INPUT: "Invalid walk-in input.",
  NOT_FOUND: "Order not found.",
  ORDER_CANCELLED: "This order was cancelled — nothing to log.",
  NOT_ON_ORDER: "That drink is not on this order.",
  QUANTITY_EXCEEDS_LINE: "More walk-in cups than that drink has on this order.",
};

/**
 * Cups on one order line that may still be logged as walk-ins. Read-only —
 * reads the line's own discount columns, never staff_entitlement_log.
 *   comp_reason set (L33 comp: the line to R0)        → 0
 *   discount_zar > 0 (L03 free cup / §6.9.1 voucher)  → quantity − 1
 *   otherwise                                         → quantity
 */
function walkInEligibleCups(line: {
  quantity: number;
  discountZar: number;
  compReason: string | null;
}): number {
  if (line.compReason !== null) return 0;
  if (line.discountZar > 0) return line.quantity - 1;
  return line.quantity;
}

/**
 * REQ-064: a refused walk-in is audited with action='reject'. entityKind is
 * 'walk_in' (entityId = the order id), never 'order', so a refusal can never
 * stand in for an order's missing creation audit in the audit-coverage check.
 */
async function writeWalkInReject(
  client: DB | undefined,
  session: { id: string; role: string },
  input: { orderId: unknown; menuItemId: unknown; quantity: unknown },
  code: WalkInRefusalCode
): Promise<ActionResult<{ walkInId: string }>> {
  await writeAudit(
    {
      entityKind: "walk_in",
      entityId: typeof input.orderId === "string" ? input.orderId : "",
      action: "reject",
      actorId: session.id,
      actorRole: session.role,
      after: {
        attempted: "walk_in",
        code,
        menuItemId: input.menuItemId,
        quantity: input.quantity,
      },
      reason: code,
    },
    client
  );
  return { ok: false, code, message: WALK_IN_COPY[code] };
}

/**
 * Log a walk-in cup against one line of an order (one row per order LINE).
 * `quantity` is how many cups on that line are walk-ins; it may not exceed
 * what the line has left after earlier walk-in logs. The category comes from
 * the menu item, never from the client.
 */
export async function logWalkIn(
  orderId: string,
  menuItemId: string,
  quantity: number
): Promise<ActionResult<{ walkInId: string }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  const parsed = logWalkInSchema.safeParse({ orderId, menuItemId, quantity });
  if (!parsed.success) {
    return writeWalkInReject(undefined, session, { orderId, menuItemId, quantity }, "INVALID_INPUT");
  }
  const input = parsed.data;

  return db.transaction(async (tx): Promise<ActionResult<{ walkInId: string }>> => {
    const txDb = tx as unknown as DB;
    // Lock the order so two concurrent logs on one line cannot both pass the
    // quantity check. Refusals RETURN (never throw) so their audit commits.
    const [order] = await tx
      .select({ id: orders.id, state: orders.state })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update");
    if (!order) return writeWalkInReject(txDb, session, input, "NOT_FOUND");
    if (order.state === "cancelled") return writeWalkInReject(txDb, session, input, "ORDER_CANCELLED");

    const lines = await tx
      .select({
        quantity: orderItems.quantity,
        discountZar: orderItems.discountZar,
        compReason: orderItems.compReason,
        category: menuItems.category,
      })
      .from(orderItems)
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(and(eq(orderItems.orderId, input.orderId), eq(orderItems.menuItemId, input.menuItemId)));
    if (lines.length === 0) return writeWalkInReject(txDb, session, input, "NOT_ON_ORDER");

    const logged = await tx
      .select({ quantity: walkIns.quantity })
      .from(walkIns)
      .where(and(eq(walkIns.orderId, input.orderId), eq(walkIns.menuItemId, input.menuItemId)));
    // Walk-in cups are disjoint from entitlement cups (§7.0.2). A cup already
    // given free is not a walk-in cup: a free cup or voucher (L03, §6.9.1)
    // zeroes ONE unit of its line; a comp (L33) zeroes the WHOLE line.
    const lineCups = lines.reduce((sum, l) => sum + walkInEligibleCups(l), 0);
    const loggedCups = logged.reduce((sum, w) => sum + w.quantity, 0);
    if (loggedCups + input.quantity > lineCups) {
      return writeWalkInReject(txDb, session, input, "QUANTITY_EXCEEDS_LINE");
    }

    const category = lines[0].category;
    const [row] = await tx
      .insert(walkIns)
      .values({
        orderId: input.orderId,
        menuItemId: input.menuItemId,
        quantity: input.quantity,
        category,
        loggedByStaffId: session.id,
      })
      .returning({ id: walkIns.id });

    await writeAudit(
      {
        entityKind: "walk_in",
        entityId: row.id,
        action: "create",
        actorId: session.id,
        actorRole: session.role,
        before: null,
        after: { orderId: input.orderId, menuItemId: input.menuItemId, quantity: input.quantity, category },
      },
      txDb
    );
    return { ok: true, data: { walkInId: row.id } };
  });
}
