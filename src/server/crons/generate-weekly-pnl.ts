// Weekly P&L cron — task G14
// Fires Sunday 23:59 SAST. Aggregates revenue, COGS, expenses for
// Mon 00:00 – Sun 23:59 SAST and inserts into weekly_reports.
// Docs: API.md · BUSINESS_RULES.md T05 L09 · FAVO_PRD_v3.md §07 §09

import { and, gte, lt, sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, weeklyReports, expenses } from "@db/schema";
import { readPeriodCogs } from "@/server/cogs/period-cogs";

/** "2026-08-10" + 6 → "2026-08-16" (calendar arithmetic on a YYYY-MM-DD). */
function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Africa/Johannesburg = UTC+2 (no DST)
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * Returns the Monday 00:00 SAST and Sunday 23:59:59.999 SAST for the
 * week containing `referenceDate` (defaults to now).
 * Dates are returned as UTC Date objects.
 */
export function weekBounds(referenceDate?: Date): { start: Date; end: Date; weekStarting: string } {
  const ref = referenceDate ?? new Date();
  // Convert to SAST day
  const sastMs = ref.getTime() + SAST_OFFSET_MS;
  const sastDate = new Date(sastMs);

  // Day of week: 0=Sun … 6=Sat.  We want Monday-based weeks.
  const dowSunday = sastDate.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = dowSunday === 0 ? 6 : dowSunday - 1;

  // Monday 00:00 SAST
  const mondaySast = new Date(sastMs);
  mondaySast.setUTCHours(0, 0, 0, 0);
  mondaySast.setUTCDate(mondaySast.getUTCDate() - daysFromMonday);
  const mondayUtc = new Date(mondaySast.getTime() - SAST_OFFSET_MS);

  // Sunday 23:59:59.999 SAST = Monday + 7 days - 1 ms
  const sundayUtcEnd = new Date(mondayUtc.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

  const weekStarting = mondaySast.toISOString().slice(0, 10);

  return { start: mondayUtc, end: sundayUtcEnd, weekStarting };
}

export async function generateWeeklyPnL(
  referenceDate?: Date
): Promise<{ weekStarting: string; reportId: string; alreadyExists: boolean }> {
  const { start, end, weekStarting } = weekBounds(referenceDate);

  // Idempotent: skip if already generated
  const [existing] = await db
    .select({ id: weeklyReports.id })
    .from(weeklyReports)
    .where(eq(weeklyReports.weekStarting, weekStarting));

  if (existing) {
    return { weekStarting, reportId: existing.id, alreadyExists: true };
  }

  // ── Revenue ────────────────────────────────────────────────────────────────
  const [revRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${orders.totalZar}), 0)::int` })
    .from(orders)
    .where(
      and(
        sql`${orders.state} IN ('in_progress', 'ready', 'collected')`,
        gte(orders.placedAt, start),
        lt(orders.placedAt, end)
      )
    );
  const revenueZar = revRow?.total ?? 0;

  // ── COGS — Σ order_cogs over the week's seven revenue days (AT-189, REQ-106).
  // Never re-rounded, never filtered: an absent cost input stores the week as
  // UNAVAILABLE with the items named (AT-190, REQ-109), and an estimated lot
  // stores it provisional (AT-191, REQ-110/REQ-131).
  const cogs = await readPeriodCogs(weekStarting, addDays(weekStarting, 6));
  const cogsZar = cogs.cogsZar;

  // ── Expenses ─────────────────────────────────────────────────────────────
  // Operating expenses (rent, utilities, staff, …) incurred within the week.
  // Net P&L must subtract these, not just COGS — a report that ignores them
  // overstates profit and disagrees with the live COGS/expenses figures (SC01).
  const [expRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amountZar}), 0)::int` })
    .from(expenses)
    .where(and(gte(expenses.incurredAt, start), lt(expenses.incurredAt, end)));
  const expensesZar = expRow?.total ?? 0;

  const grossMarginZar = cogsZar === null ? null : revenueZar - cogsZar;
  const netZar = grossMarginZar === null ? null : grossMarginZar - expensesZar;

  // ── Insert report ──────────────────────────────────────────────────────────
  const [report] = await db
    .insert(weeklyReports)
    .values({
      weekStarting,
      revenueZar,
      cogsZar,
      expensesZar,
      grossMarginZar,
      netZar,
      costState: cogs.state,
      cogsAbsentItems: cogs.absentItemNames,
    })
    .returning({ id: weeklyReports.id });

  return { weekStarting, reportId: report.id, alreadyExists: false };
}
