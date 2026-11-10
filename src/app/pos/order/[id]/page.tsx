// Active order page — owner: Mine (M6)
// Server component: loads order from DB, passes to ActiveOrder client component.
// Rule L15: Done button must be the most visually dominant action.

import { redirect, notFound } from "next/navigation";
import type { Route } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, menuItems, payments } from "@db/schema";
import { isFreeCupWeekday } from "@/server/orders/free-coffee";
import { readTillMode } from "@/server/orders/till-mode-read";
import { getSession } from "@/lib/auth/session";
import ActiveOrder from "@/components/pos/ActiveOrder";
import { liveVoucherCountsByLine } from "@/server/orders/voucher-session";
import { summarisePayments } from "@/server/tender/summary";
import type { Order } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

export default async function ActiveOrderPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/staff/login" as Route);

  const { id } = await params;

  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) notFound();

  const [itemRows, paymentRow, vouchersByLine, till] = await Promise.all([
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
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(eq(orderItems.orderId, id)),
    db
      .select({ status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId })
      .from(payments)
      .where(eq(payments.orderId, id))
      .orderBy(payments.attempt), // one row per attempt: the LATEST decides (§10.3.3)
    liveVoucherCountsByLine(db, id),
    // AT-212 follow-up: the same weekday test declineFreeCoffee applies — the
    // mode in force when the order was rung (src/lib/till-mode.ts).
    readTillMode(db, row.revenueDay, row.placedAt),
  ]);
  const payState = summarisePayments(paymentRow);
  const weekdayFree = isFreeCupWeekday(till.modes, row.placedAt);

  const order: Order = {
    id: row.id,
    customerId: row.customerId,
    customerName: null,
    staffId: row.staffId,
    state: row.state,
    placedAt: row.placedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    totalZar: row.totalZar,
    isStaffDiscount: row.isStaffDiscount,
    paymentStatus: payState.paymentStatus,
    cardCheckout: payState.totalFrozen,
    paymentAwaitingLookup: payState.awaitingLookup,
    items: itemRows.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName ?? i.menuItemId,
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

  return (
    <main className="flex h-screen flex-col p-[var(--spacing-m)]">
      <ActiveOrder order={order} weekdayFree={weekdayFree} />
    </main>
  );
}
