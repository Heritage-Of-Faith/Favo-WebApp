"use server";

// Customer-data server actions — G19 (orders, summary, profile)
// The customer is always resolved from the signed cookie via getCustomerSession().
// No customerId argument — session is the source of truth (L05: customer PWA is read-only).
// Implements the CustomerDataApi contract from src/lib/customer/contract.ts.
// Docs: docs/API.md · BUSINESS_RULES.md L05

import { eq, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  customers,
  orders,
  orderItems,
  menuItems,
} from "@db/schema";
import { getCustomerSession } from "@/server/auth/customer-session";
import { withCustomerScope } from "@/lib/db-rls";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";
import type {
  CustomerSummary,
  CustomerOrder,
} from "@/lib/customer/contract";

// Row shape returned by the order_items + menu_items join in listCustomerOrders.
type CustomerOrderItemRow = {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItemName: string | null;
  quantity: number;
  unitPriceZar: number;
  modifications: unknown;
};

// ─── Session guard ────────────────────────────────────────────────────────────

async function requireCustomer(): Promise<
  { ok: true; customerId: string } | { ok: false; code: string; message: string }
> {
  const customerId = await getCustomerSession();
  if (!customerId) {
    return { ok: false, code: "UNAUTHORIZED", message: "You must be signed in." };
  }
  return { ok: true, customerId };
}

// ─── getCustomerSummary ───────────────────────────────────────────────────────

export async function getCustomerSummary(): Promise<ActionResult<CustomerSummary>> {
  const session = await requireCustomer();
  if (!session.ok) return session;

  const customer = await withCustomerScope(session.customerId, async (tx) => {
    const [customer] = await tx
      .select({
        id: customers.id,
        name: customers.name,
        hasPushSubscription: sql<boolean>`(push_subscription IS NOT NULL)`,
      })
      .from(customers)
      .where(eq(customers.id, session.customerId));
    return customer;
  });

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer account not found." };
  }

  return {
    ok: true,
    data: {
      customerId: customer.id,
      name: customer.name,
      hasPushSubscription: customer.hasPushSubscription,
    },
  };
}

// ─── listCustomerOrders ───────────────────────────────────────────────────────

export async function listCustomerOrders(limit = 10): Promise<ActionResult<CustomerOrder[]>> {
  const session = await requireCustomer();
  if (!session.ok) return session;

  const { customerOrders, items } = await withCustomerScope(session.customerId, async (tx) => {
    const customerOrders = await tx
      .select({
        id: orders.id,
        state: orders.state,
        placedAt: orders.placedAt,
        completedAt: orders.completedAt,
        totalZar: orders.totalZar,
      })
      .from(orders)
      .where(eq(orders.customerId, session.customerId))
      .orderBy(desc(orders.placedAt))
      .limit(limit);

    if (customerOrders.length === 0) {
      return { customerOrders, items: [] as CustomerOrderItemRow[] };
    }

    const orderIds = customerOrders.map((o) => o.id);
    const items = await tx
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        menuItemId: orderItems.menuItemId,
        menuItemName: menuItems.name,
        quantity: orderItems.quantity,
        unitPriceZar: orderItems.unitPriceZar,
        modifications: orderItems.modifications,
      })
      .from(orderItems)
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(inArray(orderItems.orderId, orderIds));

    return { customerOrders, items };
  });

  if (customerOrders.length === 0) {
    return { ok: true, data: [] };
  }

  const itemsByOrder = new Map<string, typeof items>();
  for (const item of items) {
    const bucket = itemsByOrder.get(item.orderId) ?? [];
    bucket.push(item);
    itemsByOrder.set(item.orderId, bucket);
  }

  const data: CustomerOrder[] = customerOrders.map((o) => ({
    id: o.id,
    state: o.state,
    placedAt: o.placedAt.toISOString(),
    completedAt: o.completedAt?.toISOString() ?? null,
    totalZar: o.totalZar,
    items: (itemsByOrder.get(o.id) ?? []).map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      menuItemName: i.menuItemName ?? i.menuItemId,
      quantity: i.quantity,
      unitPriceZar: i.unitPriceZar,
      modifications: (i.modifications as { id: string; name: string; priceDeltaZar: number }[]) ?? [],
    })),
  }));

  return { ok: true, data };
}

// ─── getCustomerProfile ───────────────────────────────────────────────────────

export async function getCustomerProfile(): Promise<
  ActionResult<{ id: string; name: string; email: string | null; phone: string | null }>
> {
  const session = await requireCustomer();
  if (!session.ok) return session;

  const [customer] = await withCustomerScope(session.customerId, (tx) =>
    tx
      .select({ id: customers.id, name: customers.name, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(eq(customers.id, session.customerId))
  );

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer account not found." };
  }

  return { ok: true, data: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone } };
}

// ─── updateCustomerProfile ────────────────────────────────────────────────────

const profileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(20).optional(),
});

export async function updateCustomerProfile(
  input: z.input<typeof profileSchema>
): Promise<ActionResult<{ id: string }>> {
  const session = await requireCustomer();
  if (!session.ok) return session;

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  if (!data.name && !data.phone) {
    return { ok: false, code: "VALIDATION", message: "Provide at least one field to update." };
  }

  const patch: Partial<{ name: string; phone: string }> = {};
  if (data.name) patch.name = data.name;
  if (data.phone) patch.phone = data.phone;

  const [updated] = await db
    .update(customers)
    .set(patch)
    .where(eq(customers.id, session.customerId))
    .returning({ id: customers.id });

  if (!updated) {
    return { ok: false, code: "NOT_FOUND", message: "Customer account not found." };
  }

  await writeAudit({
    actorId: session.customerId,
    actorRole: "customer",
    action: "customer.profile_update",
    entityKind: "customers",
    entityId: session.customerId,
    after: patch,
  });

  return { ok: true, data: { id: updated.id } };
}
