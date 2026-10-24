"use server";

import { or, and, ilike, eq, desc, asc, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, orders } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import type { ActionResult, CustomerSearchResult } from "@/lib/types";

// Docs: docs/API.md → searchCustomer · PRD §6.9.4a (DEF-F) contract.
// Prefix match on given name and surname, exact full phone, or a 2–4 digit
// prefix of the phone's last four digits. Returns id, name, surname and the
// last four phone digits only (read-only POS lookup).
// REQ-142 / AT-185 / AT-213: no email, no full phone number and no status ever
// leave the server.

const MAX_RESULTS = 10;

/** Escape LIKE wildcards so user input is matched literally (backslash is Postgres' default escape). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Last four digits of a phone number, or null if absent / fewer than four digits. */
function phoneLast4(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export async function searchCustomer(
  query: string
): Promise<ActionResult<CustomerSearchResult[]>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;

  const q = query.trim();
  if (q.length < 2) {
    return { ok: false, code: "QUERY_TOO_SHORT", message: "Enter at least 2 characters." };
  }

  // DEF-F: prefix match on the given name or the surname.
  const prefix = `${escapeLike(q)}%`;
  const conditions: SQL[] = [
    ilike(customers.name, prefix),
    ilike(customers.surname, prefix),
    eq(customers.phone, q),
  ];
  // A "Given Surname" query (DEF-F is silent on this; AT-213's choice): the
  // first word prefix-matches the given name AND the rest prefix-matches the surname.
  const words = q.split(/\s+/);
  if (words.length > 1) {
    conditions.push(
      and(
        ilike(customers.name, `${escapeLike(words[0]!)}%`),
        ilike(customers.surname, `${escapeLike(words.slice(1).join(" "))}%`)
      )!
    );
  }
  // DEF-F: "Prefix match … on the last four digits of a phone".
  if (/^\d{2,4}$/.test(q)) {
    conditions.push(
      sql`right(regexp_replace(${customers.phone}, '\\D', '', 'g'), 4) like ${`${q}%`}`
    );
  }

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      surname: customers.surname,
      phone: customers.phone,
    })
    .from(customers)
    .where(or(...conditions))
    .limit(MAX_RESULTS);

  // Build each result field by field — never spread the row, so the full
  // phone cannot ride along into the response.
  const results: CustomerSearchResult[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    surname: c.surname ?? null,
    phoneLast4: phoneLast4(c.phone),
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
