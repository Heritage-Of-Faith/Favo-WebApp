// StatusBadge — task N8.
// A small pill with domain-specific variants mapped to FAVO semantic tokens.
// Server-safe. Variants cover inventory stock, bean freshness, and stock-take
// variance bands so Mia/Mine render consistent colours everywhere.

import type { VarianceBand } from "@/lib/status/variance-band";
import type { Freshness } from "@/lib/status/freshness";

export type StatusVariant =
  // inventory stock (T04)
  | "ok"
  | "low"
  | "out"
  // bean freshness (T02)
  | "fresh"
  | "ageing"
  | "stale"
  // stock-take variance (T01)
  | "variance-ok"
  | "variance-investigate"
  | "variance-critical"
  // generic semantic
  | "neutral"
  | "positive"
  | "warning"
  | "negative"
  | "info";

type Tone = "positive" | "warning" | "negative" | "neutral" | "info";

const VARIANT_TONE: Record<StatusVariant, Tone> = {
  ok: "positive",
  low: "warning",
  out: "negative",
  fresh: "positive",
  ageing: "warning",
  stale: "negative",
  "variance-ok": "positive",
  "variance-investigate": "warning",
  "variance-critical": "negative",
  neutral: "neutral",
  positive: "positive",
  warning: "warning",
  negative: "negative",
  info: "info",
};

const DEFAULT_LABEL: Partial<Record<StatusVariant, string>> = {
  ok: "OK",
  low: "Low",
  out: "Out",
  fresh: "Fresh",
  ageing: "Ageing",
  stale: "Past peak",
  "variance-ok": "Within tolerance",
  "variance-investigate": "Investigate",
  "variance-critical": "Critical",
};

const TONE_STYLE: Record<Tone, { fg: string; bg: string }> = {
  positive: { fg: "var(--color-success)", bg: "color-mix(in srgb, var(--color-success) 14%, transparent)" },
  warning: { fg: "var(--color-warning)", bg: "color-mix(in srgb, var(--color-warning) 16%, transparent)" },
  negative: { fg: "var(--color-error)", bg: "color-mix(in srgb, var(--color-error) 14%, transparent)" },
  neutral: { fg: "var(--color-text-muted)", bg: "color-mix(in srgb, var(--color-cool-steel) 16%, transparent)" },
  info: { fg: "var(--color-info)", bg: "color-mix(in srgb, var(--color-info) 14%, transparent)" },
};

export interface StatusBadgeProps {
  variant: StatusVariant;
  /** Override the default label text for the variant. */
  children?: React.ReactNode;
  /** Show a leading dot indicator. */
  dot?: boolean;
  className?: string;
}

export default function StatusBadge({ variant, children, dot = true, className }: StatusBadgeProps) {
  const tone = VARIANT_TONE[variant];
  const style = TONE_STYLE[tone];
  const label = children ?? DEFAULT_LABEL[variant] ?? variant;

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        background: style.bg,
        color: style.fg,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-caption)",
        fontWeight: 600,
        letterSpacing: "var(--tracking-label)",
        textTransform: "uppercase",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: style.fg,
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  );
}

// ─── Convenience mappers ─────────────────────────────────────────────────────

/** Map an inventory status string to a badge variant. */
export function stockVariant(status: "ok" | "low" | "out"): StatusVariant {
  return status;
}

/** Map a variance band to a badge variant. */
export function varianceVariant(band: VarianceBand): StatusVariant {
  return `variance-${band}` as StatusVariant;
}

/** Map a freshness band to a badge variant. */
export function freshnessVariant(f: Freshness): StatusVariant {
  return f;
}
