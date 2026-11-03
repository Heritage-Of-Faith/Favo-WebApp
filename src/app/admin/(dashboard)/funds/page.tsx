// AT-203 — /admin/funds (PRD v7.0 §13.9, §10.7). Admin only: proxy.ts and the
// (dashboard) layout gate the route, and listFundsForAdmin authorises "admin"
// itself. The only surface where a fund's ledger and member list are readable,
// and the only place a cash or EFT top-up is recorded.

import FundsManager from "@/components/admin/FundsManager";
import { listFundsForAdmin } from "@/server/actions/funds";

export const metadata = { title: "Blessing funds" };
export const dynamic = "force-dynamic";

export default async function FundsPage() {
  const res = await listFundsForAdmin();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="admin-page-title">Blessing funds</h1>
      </header>
      {res.ok ? (
        <FundsManager initialFunds={res.data.funds} />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      )}
    </div>
  );
}
