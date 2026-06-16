// Fetch full order with item names — used by active order panel (POSWorkspace).
// Auth: POS roles only (barista, manager, admin, owner).
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, menuItems, customers, payments } from "@db/schema";
import { authorize } from "@/server/auth/guard";
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

  const [items, customerRow, paymentRow] = await Promise.all([
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
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(eq(orderItems.orderId, id)),
    row.customerId
      ? db
          .select({ name: customers.name })
          .from(customers)
          .where(eq(customers.id, row.customerId))
      : Promise.resolve([]),
    db
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.orderId, id))
      .limit(1),
  ]);

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
    paymentStatus: paymentRow[0]?.status ?? null,
    items: items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName,
      quantity: i.quantity,
      unitPriceZar: i.unitPriceZar,
      modifications:
        (i.modifications as { id: string; name: string; priceDeltaZar: number }[]) ?? [],
    })),
  };

  return NextResponse.json({ order });
}
