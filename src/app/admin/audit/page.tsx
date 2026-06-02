// Audit log viewer — task A6 (Gian, taken over from Mia)
// Server component: fetches the first page at render time.
// Auth gate is enforced by the parent (dashboard) layout.
// Docs: docs/DATA_MODEL.md → audit_log · docs/API.md → listAudit

import AuditViewer from "@/components/admin/AuditViewer";
import { listAudit } from "@/server/actions/audit";

export const metadata = { title: "Audit Log — FAVO Admin" };

export default async function AuditPage() {
  const result = await listAudit({ page: 0 });

  // If auth fails the layout redirect fires first — this is a fallback.
  if (!result.ok) {
    return (
      <div className="p-6 text-error favo-small">
        Could not load audit log: {result.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="favo-h3 text-text-strong">Audit Log</h1>
        <p className="favo-small text-text-muted mt-1">
          Append-only record of every mutation in the system.
          Newest entries shown first.
        </p>
      </div>

      <AuditViewer
        initialRows={result.data.rows}
        total={result.data.total}
      />
    </div>
  );
}
