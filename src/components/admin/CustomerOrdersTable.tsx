// CustomerOrdersTable — owner: Mia (AT-79, A17)
// Recent orders for a customer. All data is passed as props from the server
// component. Read-only: no mutation buttons or forms.

import { formatZar, formatDate } from "@/lib/format";
import type { AdminOrderRow } from "@/server/actions/customers";

const ORDER_STATE: Record<string, string> = {
  ordered: "Ordered",
  in_progress: "In progress",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

export interface CustomerOrdersTableProps {
  recentOrders: AdminOrderRow[];
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-text-muted">{text}</p>;
}

export default function CustomerOrdersTable({
  recentOrders,
}: CustomerOrdersTableProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium uppercase tracking-wider text-text-muted">
        Orders
      </h2>
      {recentOrders.length === 0 ? (
        <EmptyState text="No orders yet." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-elevated">
                <th className="px-4 py-2.5 text-left font-medium text-text-muted">Order ID</th>
                <th className="px-4 py-2.5 text-left font-medium text-text-muted">State</th>
                <th className="px-4 py-2.5 text-right font-medium text-text-muted">Total</th>
                <th className="px-4 py-2.5 text-left font-medium text-text-muted">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id} className="border-b border-border-subtle last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                    {o.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-2.5 text-text-strong">
                    {ORDER_STATE[o.state] ?? o.state}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatZar(o.totalZar)}
                  </td>
                  <td className="px-4 py-2.5 text-text-muted">{formatDate(o.placedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
