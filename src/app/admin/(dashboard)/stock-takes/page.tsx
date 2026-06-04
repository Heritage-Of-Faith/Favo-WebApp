// Stock takes — task A9.
// List past + in-progress takes with a "Start take" CTA. Tap a take to resume
// counting or view its variance summary. Docs: API.md, BUSINESS_RULES.md T01.

import Link from "next/link";
import { listStockTakes } from "@/server/actions/stock-takes";
import { varianceBand } from "@/lib/status/variance-band";
import StatusBadge, { varianceVariant } from "@/components/shared/StatusBadge";
import StockTakeStarter from "@/components/admin/StockTakeStarter";
import { formatDate } from "@/lib/format";

export default async function StockTakesPage() {
  const res = await listStockTakes();
  const takes = res.ok ? res.data.takes : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="favo-h2" style={{ color: "var(--color-text-strong)" }}>
            Stock takes
          </h1>
          <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
            Count lots, review variance, and apply corrective adjustments (T01).
          </p>
        </div>
        <StockTakeStarter />
      </header>

      {!res.ok && (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      )}

      {res.ok && takes.length === 0 && (
        <p
          className="rounded-[var(--radius-card)] border p-6 text-center favo-small"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-muted)" }}
        >
          No stock takes yet. Start one to begin counting.
        </p>
      )}

      <ul className="space-y-2">
        {takes.map((take) => {
          const open = take.completedAt === null;
          return (
            <li key={take.id}>
              <Link
                href={`/admin/stock-takes/${take.id}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border p-4 transition-colors hover:bg-[color:var(--color-porcelain-soft)]"
                style={{ borderColor: "var(--color-border-subtle)" }}
              >
                <div className="min-w-0">
                  <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600, textTransform: "capitalize" }}>
                    {take.kind} take
                  </p>
                  <p className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
                    Started {formatDate(take.startedAt)} · by {take.byStaffName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {open ? (
                    <StatusBadge variant="info">In progress</StatusBadge>
                  ) : take.variancePct !== null ? (
                    <StatusBadge variant={varianceVariant(varianceBand(take.variancePct))}>
                      {take.variancePct}% variance
                    </StatusBadge>
                  ) : (
                    <StatusBadge variant="neutral">Closed</StatusBadge>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
