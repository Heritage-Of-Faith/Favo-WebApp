"use server";

import { or, ilike, eq, desc, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, orders } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import type { ActionResult, Customer } from "@/lib/types";

// Docs: docs/API.md → searchCustomer · ILIKE on name + exact phone match.
// Returns id, name, phone, email (read-only customer lookup for the POS).

const MAX_RESULTS = 10;

export async function searchCustomer(
  query: string
): Promise<ActionResult<Customer[]>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;

  const q = query.trim();
  if (q.length < 2) {
    return { ok: false, code: "QUERY_TOO_SHORT", message: "Enter at least 2 characters." };
  }

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
    })
    .from(customers)
    .where(or(ilike(customers.name, `%${q}%`), eq(customers.phone, q)))
    .limit(MAX_RESULTS);

  const results: Customer[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
  }));

  return { ok: true, data: results };
}

// ─── Admin customer list (GZ / AT-78) ─────────────────────────────────────────

export type CustomerListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string; // ISO
};

/** List up to `limit` customers. If `query` is supplied, filters by name or email ILIKE. */
export async function listCustomers(opts?: {
  query?: string;
  limit?: number;
}): Promise<ActionResult<CustomerListItem[]>> {
  const auth = await authorize("admin");
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
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

// ─── Admin customer detail (GZ / AT-78) ───────────────────────────────────────

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
  createdAt: string;
  recentOrders: AdminOrderRow[];
};

export async function getCustomerDetail(
  customerId: string
): Promise<ActionResult<CustomerDetail>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  }

  const recentOrders = await db
    .select({
      id: orders.id,
      state: orders.state,
      totalZar: orders.totalZar,
      placedAt: orders.placedAt,
    })
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.placedAt))
    .limit(20);

  return {
    ok: true,
    data: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      createdAt: customer.createdAt.toISOString(),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        state: o.state,
        totalZar: o.totalZar,
        placedAt: o.placedAt.toISOString(),
      })),
    },
  };
}
