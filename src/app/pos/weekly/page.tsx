// POS weekly ops summary — AT-206, PRD §7.3, REQ-123. The single in-app
// screen the Monday push opens, for the three baristas and the Admin role.
// Read-only. ?week=YYYY-MM-DD picks a generated week; default = the latest.
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import WeeklySummaryView from "@/components/pos/WeeklySummary";
import { listWeeklyReportWeeks, readWeeklySummary, summaryForRole } from "@/server/reports/weekly-summary";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session) redirect("/staff/login" as Route);

  const weeks = await listWeeklyReportWeeks();
  const asked = (await searchParams).week;
  const week = typeof asked === "string" && weeks.includes(asked) ? asked : weeks[0];
  // The week-level expenses/net block is stripped here, server-side, for
  // every non-Admin session (summaryForRole).
  const summary = week ? summaryForRole(await readWeeklySummary(week), session.role) : null;
  return <WeeklySummaryView summary={summary} weeks={weeks} />;
}
