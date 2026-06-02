// Audit log viewer — owner: Mia (task A6)
// Paginated, read-only. Docs: docs/DATA_MODEL.md → audit_log.
// Uses placeholder data until Gian's listAudit action lands (audit-placeholders.ts).

import AuditViewer from "@/components/admin/AuditViewer";

export default function AuditPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-strong">Audit log</h1>
        <p className="mt-1 text-sm text-text-muted">
          Read-only record of every change. Filter by entity or action, and view
          the before/after of each entry.
        </p>
      </header>
      <AuditViewer />
    </div>
  );
}
