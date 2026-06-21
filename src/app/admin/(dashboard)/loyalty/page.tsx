// Admin loyalty audit page — AT-120
// Server component: fetches first page at render time.
// Auth gate is enforced by the parent (dashboard) layout.

import LoyaltyAuditTable from "@/components/admin/LoyaltyAuditTable";
import { listLoyaltyAudit } from "@/server/actions/loyalty";

export const metadata = { title: "Loyalty Audit — FAVO Admin" };

export default async function LoyaltyAuditPage() {
  const result = await listLoyaltyAudit({ page: 0 });

  if (!result.ok) {
    return (
      <div className="p-6 text-error favo-small">
        Could not load loyalty audit: {result.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Loyalty Audit</h1>
        <p className="favo-small text-text-muted mt-1">
          All loyalty point transactions — earn, redeem, adjustment, expiry. Newest first.
        </p>
      </div>

      <LoyaltyAuditTable
        initialRows={result.data.rows}
        total={result.data.total}
      />
    </div>
  );
}
