// Weekly P&L cron — task G14
// Fires Sunday 23:59 SAST. Aggregates revenue, COGS, expenses for
// Mon 00:00 – Sun 23:59 SAST, inserts into weekly_reports,
// and pings Discord #favo-ops with an embed.
// Docs: API.md · BUSINESS_RULES.md T05 L09 · FAVO_PRD_v3.md §07 §09

import { and, gte, lt, sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, expenses, weeklyReports } from "@db/schema";
import { pingFavoOps, formatZarField, pnlColor } from "@/server/discord/webhook";

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

  // ── COGS ───────────────────────────────────────────────────────────────────
  const [cogsRow] = await db.execute<{ total: string | null }>(sql`
    SELECT ROUND(COALESCE(SUM(-sm.delta::numeric * il.unit_cost_zar), 0))::bigint AS total
    FROM stock_movements sm
    JOIN inventory_lots il ON sm.inventory_lot_id = il.id
    WHERE sm.kind = 'deduction'
      AND il.unit_cost_zar IS NOT NULL
      AND sm.at >= ${start}
      AND sm.at < ${end}
  `);
  const cogsZar = parseInt(cogsRow?.total ?? "0", 10) || 0;

  // ── Expenses ───────────────────────────────────────────────────────────────
  const [expRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${expenses.amountZar}), 0)::int` })
    .from(expenses)
    .where(and(gte(expenses.incurredAt, start), lt(expenses.incurredAt, end)));
  const expensesZar = expRow?.total ?? 0;

  const grossMarginZar = revenueZar - cogsZar;
  const netZar = grossMarginZar - expensesZar;

  // ── Insert report ──────────────────────────────────────────────────────────
  const [report] = await db
    .insert(weeklyReports)
    .values({ weekStarting, revenueZar, cogsZar, expensesZar, grossMarginZar, netZar })
    .returning({ id: weeklyReports.id });

  // ── Discord ping ───────────────────────────────────────────────────────────
  await pingFavoOps({
    title: `📊 Weekly P&L — w/c ${weekStarting}`,
    color: pnlColor(netZar),
    fields: [
      { name: "Revenue", value: formatZarField(revenueZar), inline: true },
      { name: "COGS", value: formatZarField(cogsZar), inline: true },
      { name: "Expenses", value: formatZarField(expensesZar), inline: true },
      { name: "Gross Margin", value: formatZarField(grossMarginZar), inline: true },
      { name: "Net P&L", value: formatZarField(netZar), inline: true },
      {
        name: "Status",
        value: netZar >= 0 ? "✅ Profitable" : "🔴 Loss",
        inline: true,
      },
    ],
  });

  return { weekStarting, reportId: report.id, alreadyExists: false };
}
