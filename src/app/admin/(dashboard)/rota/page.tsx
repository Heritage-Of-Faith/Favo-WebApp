// The barista rota — PRD §6.3, §10.3 barista_shifts, §6.11.1 COL-23.
// Admin only (§11 access matrix: "Staff & PINs · barista rota"). The next 14
// days; the barista on a session is pushed when that session opens.
import { listRota } from "@/server/actions/rota";
import RotaEditor from "@/components/admin/RotaEditor";

export const metadata = { title: "Barista rota" };

export default async function RotaPage() {
  const res = await listRota();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="admin-page-title">Barista rota</h1>
        <p className="mt-1 favo-small text-text-muted">
          Tick who is on duty for each session. The first session of a day is the one opened first; a Sunday evening
          is the second. When a session opens, the barista on it gets a push.
        </p>
      </header>

      {res.ok ? (
        <RotaEditor today={res.data.today} openedToday={res.data.openedToday} dates={res.data.dates} baristas={res.data.baristas} initialShifts={res.data.shifts} />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      )}
    </div>
  );
}
