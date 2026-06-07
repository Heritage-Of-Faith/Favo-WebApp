// Monthly P&L — task A13 (L11).
// Admin AND finance read; admin generates drafts; admin + finance co-sign to
// close. Docs: FAVO_PRD_v3.md §04 §08 L11, API.md.
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
  const canGenerate = role === "admin" || role === "owner";
  const canSignAdmin = role === "admin" || role === "owner";
  const canSignFinance = role === "finance" || role === "owner";

  const res = await listMonthlyReports();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="favo-h2" style={{ color: "var(--color-text-strong)" }}>
          Monthly P&amp;L
        </h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Profit &amp; loss by month. Closing a report needs both an admin and a finance signature (L11).
        </p>
      </header>

      {res.ok ? (
        <MonthlyReportsManager
          initialReports={res.data.reports}
          canGenerate={canGenerate}
          canSignAdmin={canSignAdmin}
          canSignFinance={canSignFinance}
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
