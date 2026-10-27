// COGS computation — task G13, rewritten for AT-189 / AT-190 / AT-191 / AT-192.
// getCogsLive: one SAST revenue day through readPeriodFigures — the same
// revenue (orders.revenue_day), COGS (Σ order_cogs, PRD v7 §7.0.2 L1790) and
// expenses reads, and the same periodFigures arithmetic, as the CSV export and
// the weekly/monthly reports. Cost state: empty | unavailable | provisional |
// final (§7.0.1b, REQ-110, REQ-129). Spec: docs/FAVO_PRD_v7.md · L07.

import type { CogsLive } from "@/lib/types";
import { readPeriodFigures } from "@/server/cogs/period-cogs";

// Africa/Johannesburg = UTC+2 (no DST)
const SAST_OFFSET_HOURS = 2;

/**
 * Returns today's SAST date string as YYYY-MM-DD.
 * Uses the UTC offset directly — SA has no DST so this is always correct.
 */
export function todaySast(): string {
  const now = new Date();
  const sast = new Date(now.getTime() + SAST_OFFSET_HOURS * 60 * 60 * 1000);
  return sast.toISOString().slice(0, 10);
}

/**
 * Computes the COGS summary for a given SAST date.
 *
 * A day with no orders is a genuine zero (state "empty"). A day with an absent
 * cost input has cogs, gross margin and net NULL — UNAVAILABLE, the offending
 * items named — never a smaller number (REQ-109).
 */
export async function getCogsLive(date: string): Promise<CogsLive> {
  const f = await readPeriodFigures(date, date);
  return {
    date,
    revenueZar: f.revenueZar,
    cogsZar: f.cogsZar,
    expensesZar: f.expensesZar,
    grossMarginZar: f.grossMarginZar,
    netZar: f.netZar,
    costState: f.costState,
    absentItems: f.cogs.absentItemNames,
    ordersWithoutCost: f.cogs.ordersWithoutCost,
  };
}
