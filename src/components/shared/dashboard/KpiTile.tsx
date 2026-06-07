// KpiTile — task N9.
// A single KPI: label, big value (money or text), optional sub-label and trend.
// Server-safe. Money values are formatted via formatZar.

import { formatZar } from "@/lib/format";

export type TrendDirection = "up" | "down" | "flat";

export interface KpiTileProps {
  label: string;
  /** Integer cents — rendered via formatZar. Mutually exclusive with valueText. */
  valueZar?: number;
  /** Pre-formatted value text (use when the KPI is not money). */
  valueText?: string;
  sub?: string;
  /** Persistent one-line descriptor of what the metric means (e.g. "ingredient cost of items sold"). */
  hint?: string;
  trend?: {
    direction: TrendDirection;
    label: string;
    /** When true, "up" is good (green); when false, "up" is bad (red). Default true. */
    upIsGood?: boolean;
  };
  /** Accent the value colour (e.g. profit green / loss red). */
  tone?: "default" | "positive" | "negative";
  className?: string;
}

// FAVO brand palette only — positive=dark teal, negative=crimson carrot.
const TONE_COLOR: Record<NonNullable<KpiTileProps["tone"]>, string> = {
  default: "var(--color-text-strong)",
  positive: "var(--color-dark-teal)",
  negative: "var(--color-crimson-carrot)",
};

function trendColor(direction: TrendDirection, upIsGood: boolean): string {
  if (direction === "flat") return "var(--color-text-muted)";
  const good = direction === "up" ? upIsGood : !upIsGood;
  return good ? "var(--color-dark-teal)" : "var(--color-crimson-carrot)";
}

function trendArrow(direction: TrendDirection): string {
  return direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
}

export default function KpiTile({
  label,
  valueZar,
  valueText,
  sub,
  hint,
  trend,
  tone = "default",
  className,
}: KpiTileProps) {
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
        gap: 4,
        minWidth: 0,
      }}
    >
      <span className="favo-label">{label}</span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "var(--text-h3)",
          lineHeight: 1.1,
          color: TONE_COLOR[tone],
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-s)" }}>
        {trend && (
          <span
            className="favo-caption"
            style={{ color: trendColor(trend.direction, trend.upIsGood ?? true), fontWeight: 700 }}
          >
            {trendArrow(trend.direction)} {trend.label}
          </span>
        )}
        {sub && (
          <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            {sub}
          </span>
        )}
      </div>
      {hint && (
        <span
          className="favo-caption"
          style={{ color: "var(--color-text-muted)", textTransform: "none", letterSpacing: 0 }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
