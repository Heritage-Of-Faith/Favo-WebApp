// DonutChart — task N7.
// Dependency-free SVG donut for composition (e.g. COGS breakdown). Server-safe.
// Renders an empty-state ring when all values are zero.

import { chartSeries, chartColor } from "@/lib/charts/tokens";

export interface DonutSlice {
  label: string;
  value: number;
  /** Optional explicit colour; falls back to the ordered chartSeries palette. */
  color?: string;
}

export interface DonutChartProps {
  data: DonutSlice[];
  size?: number;
  /** Ring thickness as a fraction of radius (0–1). */
  thickness?: number;
  /** Text shown in the centre (e.g. a total). */
  centerLabel?: string;
  centerSub?: string;
  formatValue?: (v: number) => string;
  ariaLabel?: string;
  className?: string;
}

const TAU = Math.PI * 2;

function polar(cx: number, cy: number, r: number, angle: number) {
  // angle measured clockwise from 12 o'clock
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  };
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = polar(cx, cy, rOuter, a0);
  const o1 = polar(cx, cy, rOuter, a1);
  const i1 = polar(cx, cy, rInner, a1);
  const i0 = polar(cx, cy, rInner, a0);
  return [
    `M${o0.x.toFixed(2)},${o0.y.toFixed(2)}`,
    `A${rOuter},${rOuter} 0 ${large} 1 ${o1.x.toFixed(2)},${o1.y.toFixed(2)}`,
    `L${i1.x.toFixed(2)},${i1.y.toFixed(2)}`,
    `A${rInner},${rInner} 0 ${large} 0 ${i0.x.toFixed(2)},${i0.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export default function DonutChart({
  data,
  size = 180,
  thickness = 0.36,
  centerLabel,
  centerSub,
  formatValue = (v) => String(v),
  ariaLabel,
  className,
}: DonutChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter * (1 - thickness);

  const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0);

  const summary =
    ariaLabel ??
    (total === 0
      ? "No data"
      : data
          .filter((d) => d.value > 0)
          .map((d) => `${d.label} ${Math.round((d.value / total) * 100)}%`)
          .join(", "));

  return (
    <div
      className={className}
      style={{ display: "flex", alignItems: "center", gap: "var(--spacing-l)" }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={summary}
        style={{ flexShrink: 0 }}
      >
        {total === 0 ? (
          <circle
            cx={cx}
            cy={cy}
            r={(rOuter + rInner) / 2}
            fill="none"
            stroke={chartColor.grid}
            strokeWidth={rOuter - rInner}
            strokeDasharray="4 4"
          />
        ) : (
          (() => {
            let acc = 0;
            return data
              .filter((d) => d.value > 0)
              .map((d, i) => {
                const a0 = (acc / total) * TAU;
                acc += d.value;
                const a1 = (acc / total) * TAU;
                const color = d.color ?? chartSeries[i % chartSeries.length];
                return (
                  <path
                    key={d.label}
                    d={arcPath(cx, cy, rOuter, rInner, a0, a1)}
                    fill={color}
                    stroke="var(--color-surface)"
                    strokeWidth={1}
                  />
                );
              });
          })()
        )}
        {centerLabel && (
          <text
            x={cx}
            y={centerSub ? cy - 2 : cy + 4}
            textAnchor="middle"
            fontSize={16}
            fontWeight={700}
            fill="var(--color-text-strong)"
            fontFamily="var(--font-display)"
          >
            {centerLabel}
          </text>
        )}
        {centerSub && (
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            fontSize={10}
            fill={chartColor.label}
            fontFamily="var(--font-sans)"
          >
            {centerSub}
          </text>
        )}
      </svg>

      {/* Legend with values */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, minWidth: 0 }}>
        {data.map((d, i) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          const color = d.color ?? chartSeries[i % chartSeries.length];
          return (
            <li
              key={d.label}
              className="favo-small"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--spacing-s)",
                color: "var(--color-text-strong)",
                padding: "2px 0",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, whiteSpace: "nowrap" }}>{d.label}</span>
              <span style={{ color: "var(--color-text-muted)" }}>
                {formatValue(d.value)} · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
