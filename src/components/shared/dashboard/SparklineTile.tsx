// SparklineTile — task N9.
// A KPI value paired with a Sparkline trend. Server-safe.

import Sparkline from "@/components/shared/charts/Sparkline";
import { chartColor } from "@/lib/charts/tokens";
import { formatZar } from "@/lib/format";

export interface SparklineTileProps {
  label: string;
  valueZar?: number;
  valueText?: string;
  /** Trend series (chronological). */
  data: number[];
  /** Sparkline colour — CSS var reference. */
  color?: string;
  sub?: string;
  className?: string;
}

export default function SparklineTile({
  label,
  valueZar,
  valueText,
  data,
  color = chartColor.brand,
  sub,
  className,
}: SparklineTileProps) {
  const value = valueText ?? (valueZar !== undefined ? formatZar(valueZar) : "—");

  return (
    <div
      className={className}
      style={{
        background: "var(--color-elevated)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-card)",
        padding: "var(--spacing-m)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <span className="favo-label">{label}</span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--spacing-s)" }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "var(--text-h3)",
            lineHeight: 1.1,
            color: "var(--color-text-strong)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        <Sparkline data={data} color={color} width={96} height={32} ariaLabel={`${label} trend`} />
      </div>
      {sub && (
        <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
          {sub}
        </span>
      )}
    </div>
  );
}
