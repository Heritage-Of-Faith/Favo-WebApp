// Report exports — owner: Mia (AT-77, A15)
// Accessible by admin, owner, and finance roles (layout handles auth gate).
import ReportExportForm from "@/components/admin/ReportExportForm";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-strong">
          Report exports
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Download sales, COGS, inventory, or monthly P&amp;L reports as CSV or
          PDF.
        </p>
      </header>
      <ReportExportForm />
    </div>
  );
}
