"use server";

import { or, ilike, eq, desc, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, orders, loyaltyTransactions, walletTransactions, coffeePacks, menuItems } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import type { ActionResult, Customer } from "@/lib/types";

// Docs: docs/API.md → searchCustomer · ILIKE on name + exact phone match.
// Returns id, name, phone, loyalty_points (read-only customer lookup for the POS).

const MAX_RESULTS = 10;

export async function searchCustomer(
  query: string
): Promise<ActionResult<Customer[]>> {
  const auth = await authorize("barista", "manager", "admin", "owner");
  if (!auth.ok) return auth;

  const q = query.trim();
  if (q.length < 2) {
    return { ok: false, code: "QUERY_TOO_SHORT", message: "Enter at least 2 characters." };
  }

  const rows = await db
    .select()
    .from(customers)
    .where(or(ilike(customers.name, `%${q}%`), eq(customers.phone, q)))
    .limit(MAX_RESULTS);

  const results: Customer[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    loyaltyPoints: c.loyaltyPoints,
  }));

  return { ok: true, data: results };
}

// ─── Admin customer list (GZ / AT-78) ─────────────────────────────────────────

export type CustomerListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  loyaltyPoints: number;
  walletZar: number;
  createdAt: string; // ISO
};

/** List up to `limit` customers. If `query` is supplied, filters by name or email ILIKE. */
export async function listCustomers(opts?: {
  query?: string;
  limit?: number;
}): Promise<ActionResult<CustomerListItem[]>> {
  const auth = await authorize("manager", "admin", "owner");
  if (!auth.ok) return auth;

  const limit = Math.min(opts?.limit ?? 100, 500);
  const q = opts?.query?.trim();

  const rows = await db
    .select()
    .from(customers)
    .where(
      q && q.length >= 2
        ? or(ilike(customers.name, `%${q}%`), ilike(customers.email, `%${q}%`))
        : undefined
    )
    .orderBy(asc(customers.name))
    .limit(limit);

  return {
    ok: true,
    data: rows.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      loyaltyPoints: c.loyaltyPoints,
      walletZar: c.walletZar,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

// ─── Admin customer detail (GZ / AT-78) ───────────────────────────────────────

export type LoyaltyTxnRow = {
  id: string;
  delta: number;
  kind: string;
  orderId: string | null;
  at: string;
};

export type WalletTxnRow = {
  id: string;
  deltaZar: number;
  kind: string;
  description: string | null;
  at: string;
};

export type AdminPackRow = {
  id: string;
  menuItemName: string;
  qtyOriginal: number;
  qtyRemaining: number;
  expiresAt: string;
};

export type AdminOrderRow = {
  id: string;
  state: string;
  totalZar: number;
  placedAt: string;
};

export type CustomerDetail = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  loyaltyPoints: number;
  walletZar: number;
  createdAt: string;
  loyaltyTxns: LoyaltyTxnRow[];
  walletTxns: WalletTxnRow[];
  activePacks: AdminPackRow[];
  expiredPacks: AdminPackRow[];
  recentOrders: AdminOrderRow[];
};

export async function getCustomerDetail(
  customerId: string
): Promise<ActionResult<CustomerDetail>> {
  const auth = await authorize("manager", "admin", "owner");
  if (!auth.ok) return auth;

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  }

  const now = new Date();

  const [loyaltyTxns, walletTxns, packs, recentOrders] = await Promise.all([
    db
      .select()
      .from(loyaltyTransactions)
      .where(eq(loyaltyTransactions.customerId, customerId))
      .orderBy(desc(loyaltyTransactions.at))
      .limit(50),

    db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.customerId, customerId))
      .orderBy(desc(walletTransactions.at))
      .limit(50),

    db
      .select({
        id: coffeePacks.id,
        menuItemName: menuItems.name,
        qtyOriginal: coffeePacks.qtyOriginal,
        qtyRemaining: coffeePacks.qtyRemaining,
        expiresAt: coffeePacks.expiresAt,
      })
      .from(coffeePacks)
      .innerJoin(menuItems, eq(coffeePacks.menuItemId, menuItems.id))
      .where(eq(coffeePacks.customerId, customerId))
      .orderBy(desc(coffeePacks.expiresAt))
      .limit(100),

    db
      .select({
        id: orders.id,
        state: orders.state,
        totalZar: orders.totalZar,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.placedAt))
      .limit(20),
  ]);

  const activePacks: AdminPackRow[] = [];
  const expiredPacks: AdminPackRow[] = [];

  for (const p of packs) {
    const row: AdminPackRow = {
      id: p.id,
      menuItemName: p.menuItemName,
      qtyOriginal: p.qtyOriginal,
      qtyRemaining: p.qtyRemaining,
      expiresAt: p.expiresAt.toISOString(),
    };
    if (p.expiresAt < now || p.qtyRemaining === 0) {
      expiredPacks.push(row);
    } else {
      activePacks.push(row);
    }
  }

  return {
    ok: true,
    data: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      loyaltyPoints: customer.loyaltyPoints,
      walletZar: customer.walletZar,
      createdAt: customer.createdAt.toISOString(),
      loyaltyTxns: loyaltyTxns.map((t) => ({
        id: t.id,
        delta: t.delta,
        kind: t.kind,
        orderId: t.orderId,
        at: t.at.toISOString(),
      })),
      walletTxns: walletTxns.map((t) => ({
        id: t.id,
        deltaZar: t.deltaZar,
        kind: t.kind,
        description: t.description,
        at: t.at.toISOString(),
      })),
      activePacks,
      expiredPacks,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        state: o.state,
        totalZar: o.totalZar,
        placedAt: o.placedAt.toISOString(),
      })),
    },
  };
}
