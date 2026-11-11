"use server";

// The POS recents grid read — PRD §6.2.1, REQ-050, REQ-052, REQ-142.
// Barista · Admin only. Returns tiles built by buildRecentsGrid: id, given
// name, surname, last four phone digits, served flag. Email, the full phone
// and status never leave the server. The ordering rules live in
// src/server/recents/grid.ts.

import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, orders, staffEntitlementLog } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { revenueDay } from "@/lib/format";
import { isWeekdayDate } from "@/lib/session-mode";
import { buildRecentsGrid, RECENTS_MATCHED_LIMIT, type RecentsTile } from "@/server/recents/grid";
import type { ActionResult } from "@/lib/types";

export async function getRecentsGrid(): Promise<ActionResult<RecentsTile[]>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;

  const today = revenueDay();
  const weekday = isWeekdayDate(today);
  const lastBound = sql`max(${orders.placedAt})`;
  // Read phone to derive the last four digits; email and status are never selected.
  const projection = { id: customers.id, name: customers.name, surname: customers.surname, phone: customers.phone };

  const [officeStaff, served, matched] = await Promise.all([
    weekday
      ? // Owner decision: EVERY office_staff customer, ordered or not (§6.2.1 "~63").
        db
          .select(projection)
          .from(customers)
          .leftJoin(orders, eq(orders.customerId, customers.id))
          .where(eq(customers.status, "office_staff"))
          .groupBy(customers.id)
          .orderBy(sql`${lastBound} DESC NULLS LAST`, asc(customers.surname), asc(customers.name))
      : Promise.resolve([]),
    weekday
      ? db
          .select({ customerId: staffEntitlementLog.customerId })
          .from(staffEntitlementLog)
          .where(eq(staffEntitlementLog.day, today))
      : Promise.resolve([]),
    db
      .select(projection)
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        weekday
          ? and(isNotNull(orders.customerId), ne(customers.status, "office_staff"))
          : isNotNull(orders.customerId)
      )
      .groupBy(customers.id)
      .orderBy(desc(lastBound))
      .limit(RECENTS_MATCHED_LIMIT),
  ]);

  return {
    ok: true,
    data: buildRecentsGrid({
      weekday,
      officeStaff,
      servedIds: new Set(served.map((r) => r.customerId)),
      matched,
    }),
  };
}
