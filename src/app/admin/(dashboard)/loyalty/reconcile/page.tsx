// Admin loyalty reconciliation page — AT-124 / LOY-5
// Server component: runs reconcileLoyalty() at render time and shows drift report.
// Auth gate is enforced by the parent (dashboard) layout.
// Note: add a "Reconcile" link to src/components/admin/Sidebar.tsx under the
//       Loyalty section manually after merge.

import { reconcileLoyalty } from "@/server/actions/loyalty";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Loyalty Reconciliation — FAVO Admin" };

export default async function LoyaltyReconcilePage() {
  const result = await reconcileLoyalty();

  if (!result.ok) {
    return (
      <div className="p-6 text-error favo-small">
        Could not run reconciliation: {result.message}
      </div>
    );
  }

  const { checked, drifted, rows } = result.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="admin-page-title">Loyalty Reconciliation</h1>
        <p className="favo-small text-text-muted mt-1">
          Compares <code>customers.loyalty_points</code> against{" "}
          <code>SUM(loyalty_transactions.delta)</code>. Drift is logged to the
          audit trail — balances are never auto-corrected.
        </p>
      </div>

      <p className="favo-small text-text-muted">
        {checked} customer{checked !== 1 ? "s" : ""} checked.{" "}
        <strong>{drifted}</strong> drifted.
      </p>

      {drifted === 0 ? (
        <p className="text-emerald-600 font-medium">
          All balances reconciled — no drift detected.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Cached balance</TableHead>
                <TableHead className="text-right">Ledger balance</TableHead>
                <TableHead className="text-right">Delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.customerId}>
                  <TableCell className="font-mono text-xs">{row.customerId}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-right">{row.cached}</TableCell>
                  <TableCell className="text-right">{row.ledger}</TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      row.delta !== 0 ? "text-destructive" : ""
                    }`}
                  >
                    {row.delta > 0 ? "+" : ""}
                    {row.delta}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Re-run: timestamp query param forces a fresh navigation */}
      <a
        href={`/admin/loyalty/reconcile?t=${Date.now()}`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Re-run reconciliation
      </a>
    </div>
  );
}
