// Admin loyalty liability report — AT-127 (LOY-7)
// Server component: SSR only, no client-side data fetching.

import { getLoyaltyLiabilityReport } from "@/server/actions/loyalty";
import { formatZar, formatDate } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Loyalty Liability — FAVO Admin" };

export default async function LoyaltyLiabilityPage() {
  const result = await getLoyaltyLiabilityReport();

  if (!result.ok) {
    return (
      <div className="p-6">
        <p className="text-error favo-small">
          Could not load loyalty liability report: {result.message}
        </p>
      </div>
    );
  }

  const { totalPoints, totalLiabilityZar, activeCustomers, averagePoints, top10 } = result.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="admin-page-title">Loyalty Liability Report</h1>
        <p className="favo-small text-text-muted mt-1">
          Outstanding point liability across all customers active within the last 12 months.
          100 pts = R20 (2 000 c).
        </p>
      </div>

      {/* KPI tiles */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px] rounded-lg border border-border bg-surface p-4">
          <p className="favo-small text-text-muted mb-1">Total outstanding points</p>
          <p className="text-2xl font-semibold text-text">
            {totalPoints.toLocaleString()}
          </p>
        </div>

        <div className="flex-1 min-w-[200px] rounded-lg border border-border bg-surface p-4">
          <p className="favo-small text-text-muted mb-1">Estimated liability</p>
          <p className="text-2xl font-semibold text-text">
            {formatZar(totalLiabilityZar)}
          </p>
        </div>

        <div className="flex-1 min-w-[200px] rounded-lg border border-border bg-surface p-4">
          <p className="favo-small text-text-muted mb-1">Active customers</p>
          <p className="text-2xl font-semibold text-text">{activeCustomers}</p>
          <p className="favo-small text-text-muted">with points, active ≤12 mo</p>
        </div>

        <div className="flex-1 min-w-[200px] rounded-lg border border-border bg-surface p-4">
          <p className="favo-small text-text-muted mb-1">Average points</p>
          <p className="text-2xl font-semibold text-text">
            {averagePoints.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Top 10 table */}
      <div>
        <h2 className="text-base font-semibold text-text mb-3">Top 10 holders</h2>
        {top10.length === 0 ? (
          <p className="favo-small text-text-muted">No active customers with loyalty points.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Liability (ZAR)</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top10.map((row, i) => (
                  <TableRow key={row.customerId}>
                    <TableCell className="text-text-muted favo-small">{i + 1}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.loyaltyPoints.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatZar(row.liabilityZar)}
                    </TableCell>
                    <TableCell className="favo-small text-text-muted">
                      {row.lastActivityAt
                        ? formatDate(row.lastActivityAt, "Africa/Johannesburg")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* CSV export */}
      <div>
        <a
          href="/api/admin/loyalty-liability"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 favo-small font-medium text-text hover:bg-surface-hover transition-colors"
        >
          Export full list as CSV
        </a>
        <p className="favo-small text-text-muted mt-1">
          Downloads all active customers with points — sorted by points descending.
        </p>
      </div>
    </div>
  );
}
