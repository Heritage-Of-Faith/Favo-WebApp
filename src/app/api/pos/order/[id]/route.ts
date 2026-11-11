// Fetch full order with item names — used by active order panel (POSWorkspace).
// Auth: POS roles only (barista, manager, admin, owner).
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, menuItems, customers, payments, eventWindows } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { liveVoucherCountsByLine } from "@/server/orders/voucher-session";
import { summarisePayments } from "@/server/tender/summary";
import { isFundSettled } from "@/server/orders/payment-lock";
import { NextResponse } from "next/server";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";

const POS_ROLES = ["barista", "admin"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) {
    const status = auth.code === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: auth.message }, { status });
  }

  const { id } = await params;
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // DEC-28 (b): the queue card's gate reads the posture of the order's event window.
  const eventPosture = row.eventWindowId
    ? db
        .select({ paymentPosture: eventWindows.paymentPosture })
        .from(eventWindows)
        .where(eq(eventWindows.id, row.eventWindowId))
    : Promise.resolve([] as { paymentPosture: string }[]);

  const [items, customerRow, paymentRow, vouchersByLine, eventRow] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        menuItemId: orderItems.menuItemId,
        menuItemName: menuItems.name,
        quantity: orderItems.quantity,
        unitPriceZar: orderItems.unitPriceZar,
        discountZar: orderItems.discountZar,
        modifications: orderItems.modifications,
        shots: orderItems.shots,
        surchargeZar: orderItems.surchargeZar,
      })
      .from(orderItems)
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(eq(orderItems.orderId, id)),
    row.customerId
      ? db
          .select({ name: customers.name })
          .from(customers)
          .where(eq(customers.id, row.customerId))
      : Promise.resolve([]),
    db
      .select({ status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId })
      .from(payments)
      .where(eq(payments.orderId, id))
      .orderBy(payments.attempt), // one row per attempt: the LATEST decides (§10.3.3)
    liveVoucherCountsByLine(db, id),
    eventPosture,
  ]);
  const payState = summarisePayments(paymentRow);

  const order: Order = {
    id: row.id,
    customerId: row.customerId,
    customerName: customerRow[0]?.name ?? null,
    staffId: row.staffId,
    state: row.state,
    placedAt: row.placedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    totalZar: row.totalZar,
    isStaffDiscount: row.isStaffDiscount,
    paymentStatus: payState.paymentStatus,
    // AT-203 / REQ-167: a fund-settled total is frozen too, and nothing is owed.
    cardCheckout: payState.totalFrozen || isFundSettled(row.paymentMode),
    paymentAwaitingLookup: payState.awaitingLookup,
    fundSettled: isFundSettled(row.paymentMode),
    // DEC-21: the queue card's payment gate (src/server/orders/payment-gate.ts).
    paymentMode: row.paymentMode,
    revenueDay: row.revenueDay,
    latestAttemptSent: (paymentRow[paymentRow.length - 1]?.sentAt ?? null) !== null,
    eventPaymentPosture: eventRow[0]?.paymentPosture ?? null,
    items: items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName,
      quantity: i.quantity,
      unitPriceZar: i.unitPriceZar,
      discountZar: i.discountZar,
      voucherCount: vouchersByLine.get(i.id) ?? 0,
      modifications:
        (i.modifications as { id: string; name: string; priceDeltaZar: number }[]) ?? [],
      shots: i.shots,
      surchargeZar: i.surchargeZar,
    })),
  };

  return NextResponse.json({ order });
}
