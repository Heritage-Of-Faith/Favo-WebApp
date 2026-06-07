// AlertTile — task N9.
// A banner-style tile for low-stock, cost-estimate, and approval notices.
// Severity colours bind to the same semantic tokens StatusBadge uses.
// Server-safe; the optional action is a render-prop so callers supply their
// own client button when needed.

export type AlertSeverity = "info" | "warning" | "critical" | "success";

// FAVO brand palette only — info/success use dark teal, warning/critical crimson.
const SEVERITY_STYLE: Record<AlertSeverity, { fg: string; bg: string; border: string }> = {
  info: {
    fg: "var(--color-dark-teal)",
    bg: "color-mix(in srgb, var(--color-dark-teal) 8%, transparent)",
    border: "color-mix(in srgb, var(--color-dark-teal) 35%, transparent)",
  },
  warning: {
    fg: "var(--color-crimson-carrot)",
    bg: "color-mix(in srgb, var(--color-crimson-carrot) 10%, transparent)",
    border: "color-mix(in srgb, var(--color-crimson-carrot) 40%, transparent)",
  },
  critical: {
    fg: "var(--color-crimson-carrot)",
    bg: "color-mix(in srgb, var(--color-crimson-carrot) 12%, transparent)",
    border: "color-mix(in srgb, var(--color-crimson-carrot) 50%, transparent)",
  },
  success: {
    fg: "var(--color-dark-teal)",
    bg: "color-mix(in srgb, var(--color-dark-teal) 8%, transparent)",
    border: "color-mix(in srgb, var(--color-dark-teal) 35%, transparent)",
  },
};

export interface AlertTileProps {
  severity: AlertSeverity;
  title: string;
  description?: string;
  /** Optional trailing action (e.g. a client button or link). */
  action?: React.ReactNode;
  className?: string;
}

export default function AlertTile({ severity, title, description, action, className }: AlertTileProps) {
  const style = SEVERITY_STYLE[severity];
  return (
    <div
      role="status"
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--spacing-m)",
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: "var(--radius-card)",
        padding: "var(--spacing-m)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-s)", minWidth: 0 }}>
        <span aria-hidden style={{ color: style.fg, fontSize: "1.1rem", lineHeight: 1, flexShrink: 0 }}>
          {severity === "success" ? "✓" : severity === "info" ? "ℹ" : "⚠"}
        </span>
        <div style={{ minWidth: 0 }}>
          <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
            {title}
          </p>
          {description && (
            <p className="favo-caption" style={{ color: "var(--color-text-muted)", textTransform: "none", letterSpacing: 0 }}>
              {description}
            </p>
          )}
        </div>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
