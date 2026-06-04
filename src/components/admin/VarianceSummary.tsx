// Variance summary — task A9 (T01 bands).
// Read-only roll-up of a stock take's per-line and overall variance, coloured
// by the shared T01 bands. Server-safe.

import { varianceBand } from "@/lib/status/variance-band";
import StatusBadge, { varianceVariant } from "@/components/shared/StatusBadge";
import type { StockTake } from "@/lib/types";

export interface VarianceSummaryProps {
  take: StockTake;
}

export default function VarianceSummary({ take }: VarianceSummaryProps) {
  const overallPct = take.variancePct;

  return (
    <div className="space-y-4">
      <div
        className="flex items-center justify-between rounded-[var(--radius-card)] border p-4"
        style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
      >
        <div>
          <p className="favo-label">Overall variance</p>
          <p
            className="favo-h3"
            style={{ color: "var(--color-text-strong)", fontVariantNumeric: "tabular-nums" }}
          >
            {overallPct === null ? "—" : `${overallPct}%`}
          </p>
        </div>
        {overallPct !== null && <StatusBadge variant={varianceVariant(varianceBand(overallPct))} />}
      </div>

      <ul className="space-y-2">
        {take.lines.map((line) => {
          const counted = line.counted;
          const pct = line.variancePct;
          return (
            <li
              key={line.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border p-3"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              <div className="min-w-0">
                <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
                  {line.inventoryItemName}
                </p>
                <p className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
                  expected {line.expected} · counted {counted ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="favo-small"
                  style={{ color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}
                >
                  {pct === null ? "—" : `${pct.toFixed(1)}%`}
                </span>
                {pct !== null && (
                  <StatusBadge variant={varianceVariant(varianceBand(pct))} dot={false} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
