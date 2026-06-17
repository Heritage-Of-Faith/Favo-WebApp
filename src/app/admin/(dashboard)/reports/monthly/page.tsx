// Monthly P&L — task A13 (L11).
// Admins read, generate drafts, and sign to close (single admin sign-off — the
// finance co-signature was removed with the staff-role simplification).
// Docs: FAVO_PRD_v3.md §04 §08 L11, API.md.
import { getSession } from "@/lib/auth/session";
import { listMonthlyReports } from "@/server/actions/monthly-pnl";
import { revenueDay } from "@/lib/format";
import MonthlyReportsManager from "@/components/admin/MonthlyReportsManager";

export const metadata = { title: "Monthly P\u0026L" };

/** Previous calendar month as YYYY-MM, computed from today's SAST date. */
function previousMonth(): string {
  const [y, m] = revenueDay().split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

export default async function MonthlyReportsPage() {
  const session = await getSession();
  const role = session?.role;
  const canGenerate = role === "admin";
  const canSignAdmin = role === "admin";

  const res = await listMonthlyReports();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="favo-h2" style={{ color: "var(--color-text-strong)" }}>
          Monthly P&amp;L
        </h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Profit &amp; loss by month. An admin signs to close a report (L11).
        </p>
      </header>

      {res.ok ? (
        <MonthlyReportsManager
          initialReports={res.data.reports}
          canGenerate={canGenerate}
          canSignAdmin={canSignAdmin}
          defaultMonth={previousMonth()}
        />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      )}
    </div>
  );
}
