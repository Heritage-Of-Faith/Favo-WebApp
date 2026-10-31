// Report exports — owner: Mia (AT-77, A15)
// Accessible by admin, owner, and finance roles (layout handles auth gate).
import ReportExportForm from "@/components/admin/ReportExportForm";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="admin-page-title">Report Exports</h1>
        <p className="mt-1 favo-small text-text-muted">
          Download sales, COGS or inventory reports as CSV, or as a printable
          HTML page you can print or save as PDF from your browser.
        </p>
      </header>
      <ReportExportForm />
    </div>
  );
}
