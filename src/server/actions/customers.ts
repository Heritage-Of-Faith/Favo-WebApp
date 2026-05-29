"use server";

import { or, ilike, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@db/schema";
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
