// AT-209 / PRD §7.0.2, REQ-116: walk_in_cups = Σ walk_ins.quantity.
// One walk_ins row is written per order LINE (logWalkIn), so this counts
// walk-in cups and never the whole order's quantities: a paid line beside a
// walk-in line on the same order is not a walk-in cup.
//
// A count of cups, not money. The period is a range of revenue days
// (orders.revenue_day, SAST, L07), inclusive at both ends, so a walk-in falls
// in the same day as the order it was poured on.

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { orders, walkIns } from "@db/schema";

export type RevenueDayRange = {
  /** YYYY-MM-DD, SAST revenue day, inclusive. */
  fromDay: string;
  /** YYYY-MM-DD, SAST revenue day, inclusive. */
  toDay: string;
};

/** The query, exposed so tests can run its exact SQL against real Postgres. */
export function walkInCupsQuery(client: Pick<DB, "select">, range: RevenueDayRange) {
  return client
    .select({ cups: sql<number>`coalesce(sum(${walkIns.quantity}), 0)::int`.as("cups") })
    .from(walkIns)
    .innerJoin(orders, eq(walkIns.orderId, orders.id))
    .where(and(gte(orders.revenueDay, range.fromDay), lte(orders.revenueDay, range.toDay)));
}

/** Σ walk_ins.quantity over the range's revenue days. 0 when none were logged. */
export async function walkInCups(
  range: RevenueDayRange,
  client: Pick<DB, "select"> = db
): Promise<number> {
  const [row] = await walkInCupsQuery(client, range);
  return Number(row?.cups ?? 0);
}
