"use server";

// Customer-data server actions — G18 (packs) + G19 (orders, summary, profile)
// The customer is always resolved from the signed cookie via getCustomerSession().
// No customerId argument — session is the source of truth (L05: customer PWA is read-only).
// Implements the CustomerDataApi contract from src/lib/customer/contract.ts.
// Docs: docs/API.md · BUSINESS_RULES.md L05, L06, L16

import { eq, desc, inArray, and, gt, sql, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  customers,
  orders,
  orderItems,
  menuItems,
  coffeePacks,
  loyaltyTransactions,
} from "@db/schema";
import { getCustomerSession } from "@/server/auth/customer-session";
import { withCustomerScope } from "@/lib/db-rls";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";
import type {
  CustomerSummary,
  CustomerOrder,
  PacksView,
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

  const { customer, packCount } = await withCustomerScope(session.customerId, async (tx) => {
    const [customer] = await tx
      .select({
        id: customers.id,
        name: customers.name,
        loyaltyPoints: customers.loyaltyPoints,
        hasPushSubscription: sql<boolean>`(push_subscription IS NOT NULL)`,
      })
      .from(customers)
      .where(eq(customers.id, session.customerId));

    // Short-circuit: no customer row → no need to run the pack-count query.
    if (!customer) return { customer: undefined, packCount: undefined };

    const now = new Date();
    const [packCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(coffeePacks)
      .where(
        and(
          eq(coffeePacks.customerId, session.customerId),
          gt(coffeePacks.expiresAt, now),
          gt(coffeePacks.qtyRemaining, 0)
        )
      );
    return { customer, packCount };
  });

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer account not found." };
  }

  return {
    ok: true,
    data: {
      customerId: customer.id,
      name: customer.name,
      loyaltyPoints: customer.loyaltyPoints,
      activePackCount: packCount?.count ?? 0,
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

// ─── getPacks ─────────────────────────────────────────────────────────────────

export async function getPacks(): Promise<ActionResult<PacksView>> {
  const session = await requireCustomer();
  if (!session.ok) return session;

  const now = new Date();

  const packs = await withCustomerScope(session.customerId, (tx) =>
    tx
      .select({
        id: coffeePacks.id,
        menuItemId: coffeePacks.menuItemId,
        itemName: menuItems.name,
        qtyOriginal: coffeePacks.qtyOriginal,
        qtyRemaining: coffeePacks.qtyRemaining,
        expiresAt: coffeePacks.expiresAt,
        createdAt: coffeePacks.createdAt,
      })
      .from(coffeePacks)
      .leftJoin(menuItems, eq(coffeePacks.menuItemId, menuItems.id))
      .where(eq(coffeePacks.customerId, session.customerId))
      .orderBy(desc(coffeePacks.createdAt))
  );

  const active = packs
    .filter((p) => p.expiresAt > now && p.qtyRemaining > 0)
    .map((p) => ({
      id: p.id,
      itemName: p.itemName ?? p.menuItemId,
      qtyTotal: p.qtyOriginal,
      qtyRemaining: p.qtyRemaining,
      purchasedAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
    }));

  const expired = packs
    .filter((p) => p.expiresAt <= now || p.qtyRemaining === 0)
    .map((p) => ({
      id: p.id,
      itemName: p.itemName ?? p.menuItemId,
      qtyTotal: p.qtyOriginal,
      qtyRemaining: p.qtyRemaining,
      purchasedAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
    }));

  return { ok: true, data: { active, expired } };
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

// ─── listCustomerLoyaltyHistory ───────────────────────────────────────────────

const HISTORY_PAGE_SIZE = 20;

export type LoyaltyHistoryRow = {
  id: string;
  delta: number;
  kind: "earn" | "redeem" | "adjustment" | "expiry";
  reason: string | null;
  at: Date;
  runningBalance: number;
};

export async function listCustomerLoyaltyHistory(
  page = 0
): Promise<ActionResult<{ rows: LoyaltyHistoryRow[]; total: number; currentBalance: number }>> {
  const session = await requireCustomer();
  if (!session.ok) return { ok: false, code: "UNAUTHORIZED", message: "Not signed in." };

  let queryResult: [
    [{ loyaltyPoints: number } | undefined],
    { id: string; delta: number; kind: string; reason: string | null; at: Date }[],
    [{ total: number } | undefined],
  ];
  try {
    queryResult = (await withCustomerScope(session.customerId, (tx) =>
      Promise.all([
        tx
          .select({ loyaltyPoints: customers.loyaltyPoints })
          .from(customers)
          .where(eq(customers.id, session.customerId)),
        tx
          .select({
            id: loyaltyTransactions.id,
            delta: loyaltyTransactions.delta,
            kind: loyaltyTransactions.kind,
            reason: loyaltyTransactions.reason,
            at: loyaltyTransactions.at,
          })
          .from(loyaltyTransactions)
          .where(eq(loyaltyTransactions.customerId, session.customerId))
          .orderBy(desc(loyaltyTransactions.at))
          .limit(HISTORY_PAGE_SIZE)
          .offset(page * HISTORY_PAGE_SIZE),
        tx
          .select({ total: count() })
          .from(loyaltyTransactions)
          .where(eq(loyaltyTransactions.customerId, session.customerId)),
      ])
    )) as typeof queryResult;
  } catch {
    return { ok: false, code: "DB_ERROR", message: "Could not load loyalty history." };
  }
  const [[customer], txRows, [totalRow]] = queryResult;

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer account not found." };
  }

  const currentBalance = customer.loyaltyPoints;
  const totalTransactions = totalRow?.total ?? 0;

  // Compute running balances by working backwards from currentBalance.
  // rows[0] is the newest transaction; its post-balance = currentBalance.
  // Each subsequent row's balance = previous row's balance − previous row's delta.
  const rows: LoyaltyHistoryRow[] = txRows.map((row, i) => {
    // Sum of all deltas for rows 0..i-1 (newer transactions already settled)
    const deltasSoFar = txRows.slice(0, i).reduce((acc, r) => acc + r.delta, 0);
    return {
      id: row.id,
      delta: row.delta,
      kind: row.kind as LoyaltyHistoryRow["kind"],
      reason: row.reason,
      at: row.at,
      runningBalance: currentBalance - deltasSoFar,
    };
  });

  return { ok: true, data: { rows, total: totalTransactions, currentBalance } };
}
