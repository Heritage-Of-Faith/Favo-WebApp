// Fetch full order with item names — used by active order panel
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, menuItems, customers } from "@db/schema";
import { getSession } from "@/lib/auth/session";
import { NextResponse } from "next/server";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = await db.select({
    id: orderItems.id, menuItemId: orderItems.menuItemId,
    menuItemName: menuItems.name, quantity: orderItems.quantity,
    unitPriceZar: orderItems.unitPriceZar, modifications: orderItems.modifications,
  }).from(orderItems)
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(eq(orderItems.orderId, id));

  let customerName: string | null = null;
  if (row.customerId) {
    const [c] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, row.customerId));
    customerName = c?.name ?? null;
  }

  const order: Order = {
    id: row.id, customerId: row.customerId, customerName, staffId: row.staffId,
    state: row.state, placedAt: row.placedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    totalZar: row.totalZar, isStaffDiscount: row.isStaffDiscount,
    items: items.map(i => ({
      id: i.id, menuItemId: i.menuItemId, menuItemName: i.menuItemName,
      quantity: i.quantity, unitPriceZar: i.unitPriceZar,
      modifications: (i.modifications as { id: string; name: string; priceDeltaZar: number }[]) ?? [],
    })),
  };
  return NextResponse.json({ order });
}
