// /admin/unpaid-orders — PRD v7.0 §6.7 "Admin surface. An unpaid-orders list,
// visible to the Admin role, showing every open unpaid order with its
// daily_seq, age and value." Same read as GET /api/admin/unpaid-orders (S3a:
// defined over unpaid, not over yoco_deferred; REQ-166: a fund-paid order is
// never on it). Admin only: the (dashboard) layout and proxy.ts gate the
// route, and listUnpaidOrdersForAdmin authorizes "admin" itself. Read only.
//
// daily_seq does not exist yet, so the order is named by the first 8
// characters of its id (the full id on hover), as the write-downs report does.
// The column headings and the empty-state line are not PRD copy.

import { listUnpaidOrdersForAdmin } from "@/server/actions/deferred";
import { formatZar } from "@/lib/format";

export const metadata = { title: "Unpaid orders" };
export const dynamic = "force-dynamic";

export default async function UnpaidOrdersPage() {
  const res = await listUnpaidOrdersForAdmin();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="admin-page-title">Unpaid orders</h1>
      </header>

      {!res.ok ? (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>{res.message}</p>
      ) : res.data.length === 0 ? (
        <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>No unpaid orders.</p>
      ) : (
        <table className="w-full favo-small">
          <thead>
            <tr className="text-left">
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Revenue day</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2 text-right">Age</th>
              <th className="px-3 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {res.data.map((o) => (
              <tr key={o.orderId} className="border-t" style={{ borderColor: "var(--color-border, rgba(0,0,0,0.1))" }}>
                <td className="px-3 py-2" title={o.orderId}>{o.orderRef}</td>
                <td className="px-3 py-2">{o.revenueDay}</td>
                <td className="px-3 py-2">{o.paymentMode ?? "—"}</td>
                <td className="px-3 py-2 text-right">{o.ageMinutes} min</td>
                <td className="px-3 py-2 text-right">{formatZar(o.valueZar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
