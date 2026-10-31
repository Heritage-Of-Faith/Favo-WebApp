// Weekly P&L cron — task G14
// Scheduled Monday 06:00 SAST for the completed week (src/server/jobs/registry.ts). Aggregates revenue, COGS, expenses for
// Mon 00:00 – Sun 23:59 SAST and inserts into weekly_reports.
// Docs: API.md · BUSINESS_RULES.md T05 L09 · FAVO_PRD_v3.md §07 §09

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { weeklyReports } from "@db/schema";
import { readPeriodFigures } from "@/server/cogs/period-cogs";

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

/** Whether the report for the week starting `weekStarting` exists: the scheduler's "done" for this job. */
export async function hasWeeklyReport(weekStarting: string): Promise<boolean> {
  const [row] = await db
    .select({ id: weeklyReports.id })
    .from(weeklyReports)
    .where(eq(weeklyReports.weekStarting, weekStarting))
    .limit(1);
  return Boolean(row);
}

export async function generateWeeklyPnL(
  referenceDate?: Date
): Promise<{ weekStarting: string; reportId: string; alreadyExists: boolean }> {
  const { weekStarting } = weekBounds(referenceDate);

  // Idempotent: skip if already generated
  const [existing] = await db
    .select({ id: weeklyReports.id })
    .from(weeklyReports)
    .where(eq(weeklyReports.weekStarting, weekStarting));

  if (existing) {
    return { weekStarting, reportId: existing.id, alreadyExists: true };
  }

  const weekEnding = addDays(weekStarting, 6);

  // Revenue (orders.revenue_day), COGS (Σ order_cogs — never re-rounded, never
  // filtered: AT-189/AT-190, REQ-106/REQ-109) and expenses over the week's
  // seven revenue days, through the same reads and periodFigures arithmetic
  // as the dashboard, the CSV and the monthly report.
  const f = await readPeriodFigures(weekStarting, weekEnding);
  const { cogs, revenueZar, cogsZar, expensesZar, grossMarginZar, netZar } = f;

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
      ordersWithoutCost: cogs.ordersWithoutCost,
    })
    .returning({ id: weeklyReports.id });

  return { weekStarting, reportId: report.id, alreadyExists: false };
}
