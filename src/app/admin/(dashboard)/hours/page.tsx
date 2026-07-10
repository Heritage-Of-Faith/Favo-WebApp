// Operating hours editor — owner: Mia (AT-76, A14)
// Loads current hours server-side; renders the AT-134 Today's Hours planner
// (same-day session overrides) above HoursEditor for the weekly schedule.
// L04: hours are display-only — orders are never refused based on time.
import HoursEditor from "@/components/admin/HoursEditor";
import TodaySessionsPlanner from "@/components/admin/TodaySessionsPlanner";
import { getOperatingHours } from "@/server/actions/hours";
import { getTodaySessions } from "@/server/actions/opening";

export const metadata = { title: "Hours" };

export default async function HoursPage() {
  const [res, sessionsRes] = await Promise.all([
    getOperatingHours(),
    getTodaySessions().catch(() => ({ ok: false as const, code: "FETCH_ERROR", message: "Sessions unavailable" })),
  ]);
  const hours = res.ok ? res.data : [];
  const sessions = sessionsRes.ok ? sessionsRes.data.sessions : [];

  const nowSast = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
  const todayLabel = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", weekday: "short", day: "numeric", month: "short",
  }).format(new Date());
  const weekday = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "long" }).format(new Date());
  const todayHours = hours.find((h) => h.dayOfWeek === nowSast.getDay()) ?? null;
  const fallbackLabel = todayHours && !todayHours.isClosed
    ? `your usual ${weekday} hours (${todayHours.opensAt}–${todayHours.closesAt})`
    : `your usual ${weekday} schedule`;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="admin-page-title">Operating Hours</h1>
        <p className="mt-1 favo-small text-text-muted">
          Set the opening and closing times shown to customers. Hours are
          display-only and never block orders.
        </p>
      </header>
      <TodaySessionsPlanner initialSessions={sessions} todayLabel={todayLabel} fallbackLabel={fallbackLabel} />
      <HoursEditor initialHours={hours} />
    </div>
  );
}
