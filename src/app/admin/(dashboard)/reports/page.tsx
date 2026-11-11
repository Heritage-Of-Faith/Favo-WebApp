// Report exports — owner: Mia (AT-77, A15)
// Admin only: the (dashboard) layout and proxy.ts gate the route.
//
// T10 (PRD v7.0 §6.8.3, §11.2 importYocoTransactions): the Admin uploads
// Yoco's transaction export for a completed revenue day here, and the day's
// reconciliation exception list renders below it. ?day=YYYY-MM-DD picks the
// day; the default is yesterday (SAST). getT10 authorizes "admin" itself.
import ReportExportForm from "@/components/admin/ReportExportForm";
import YocoImportForm from "@/components/admin/YocoImportForm";
import T10Panel from "@/components/admin/T10Panel";
import { getT10 } from "@/server/actions/reconciliation";
import { revenueDay } from "@/lib/format";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day: requested } = await searchParams;
  // SAST has no daylight saving, so 24 h back is always the previous revenue day.
  const yesterday = revenueDay(new Date(Date.now() - DAY_MS));
  const day = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : yesterday;
  const t10 = await getT10(day);

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="max-w-3xl">
        <header className="mb-6">
          <h1 className="admin-page-title">Report Exports</h1>
          <p className="mt-1 favo-small text-text-muted">
            Download sales, COGS or inventory reports as CSV, or as a printable
            HTML page you can print or save as PDF from your browser.
          </p>
        </header>
        <ReportExportForm />
      </div>

      <section className="space-y-4">
        <header>
          <h2 className="admin-page-title">Yoco reconciliation — {day}</h2>
          <p className="mt-1 favo-small text-text-muted">
            Upload Yoco&apos;s transaction export for a finished day. FAVO reads each card payment&apos;s fee and
            receipt number from it and lists anything that does not line up. It never marks a payment as paid.
          </p>
        </header>
        <YocoImportForm defaultDay={day} maxDay={yesterday} />
        {t10.ok ? (
          <T10Panel view={t10.data} />
        ) : (
          <p className="favo-small" style={{ color: "var(--color-error)" }}>{t10.message}</p>
        )}
      </section>
    </div>
  );
}
