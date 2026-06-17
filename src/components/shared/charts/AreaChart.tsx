"use client";

// AreaChart — task N7.
// Responsive multi-series line+area chart, bespoke SVG (no charting library).
// Hover shows a crosshair + tooltip with each series' value at that x-index.
// Width tracks the container via ResizeObserver so strokes stay crisp.

import { useRef, useState, useLayoutEffect } from "react";
import { chartColor, chartGeometry } from "@/lib/charts/tokens";

export interface AreaSeries {
  label: string;
  /** Y-values aligned to `labels` by index. */
  data: number[];
  /** Stroke/fill colour — a CSS var reference. */
  color: string;
  /** Render the filled area under the line (default true for the first series). */
  fill?: boolean;
}

export interface AreaChartProps {
  /** X-axis category labels (e.g. dates), one per data index. */
  labels: string[];
  series: AreaSeries[];
  height?: number;
  /** Format a raw value for the tooltip + y-axis (e.g. formatZar). */
  formatValue?: (v: number) => string;
  /** Accessible chart summary. */
  ariaLabel?: string;
  className?: string;
}

const PAD_LEFT = 72;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;
const Y_TICKS = 4;

function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || 640);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export default function AreaChart({
  labels,
  series,
  height = 240,
  formatValue = (v) => String(v),
  ariaLabel,
  className,
}: AreaChartProps) {
  const [ref, width] = useContainerWidth();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = labels.length;
  const hasData = n >= 2 && series.some((s) => s.data.length >= 2);

  if (!hasData) {
    return (
      <div ref={ref} className={className}>
        <div
          className="flex items-center justify-center rounded-[var(--radius-card)] border border-dashed"
          style={{ height, borderColor: "var(--color-border-subtle)" }}
        >
          <span className="favo-small" style={{ color: "var(--color-text-muted)" }}>
            Not enough data to chart yet
          </span>
        </div>
      </div>
    );
  }

  const innerW = Math.max(width - PAD_LEFT - PAD_RIGHT, 10);
  const innerH = height - PAD_TOP - PAD_BOTTOM;

  const allValues = series.flatMap((s) => s.data);
  const rawMax = Math.max(...allValues, 0);
  const rawMin = Math.min(...allValues, 0);
  // Always anchor to zero for money charts; pad the top by 8%.
  const yMax = rawMax === 0 ? 1 : rawMax * 1.08;
  const yMin = Math.min(0, rawMin);
  const yRange = yMax - yMin || 1;

  const xAt = (i: number) => PAD_LEFT + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => PAD_TOP + innerH - ((v - yMin) / yRange) * innerH;

  const yTickValues = Array.from({ length: Y_TICKS + 1 }, (_, i) => yMin + (yRange * i) / Y_TICKS);

  function pathFor(data: number[]): { line: string; area: string } {
    const pts = data.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");
    const area =
      `${line} L${pts[pts.length - 1].x.toFixed(2)},${yAt(yMin).toFixed(2)} ` +
      `L${pts[0].x.toFixed(2)},${yAt(yMin).toFixed(2)} Z`;
    return { line, area };
  }

  // Show roughly six x labels max to avoid crowding.
  const labelStep = Math.max(1, Math.ceil(n / 6));

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = (x - PAD_LEFT) / innerW;
    const idx = Math.round(ratio * (n - 1));
    setHoverIdx(Math.min(Math.max(idx, 0), n - 1));
  }

  return (
    <div ref={ref} className={className} style={{ position: "relative" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel ?? `Trend chart of ${series.map((s) => s.label).join(", ")}`}
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIdx(null)}
        style={{ touchAction: "none" }}
      >
        {/* Y grid + ticks */}
        {yTickValues.map((tv, i) => {
          const y = yAt(tv);
          return (
            <g key={i}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={width - PAD_RIGHT}
                y2={y}
                stroke={chartColor.grid}
                strokeWidth={1}
                opacity={tv === 0 ? 0.9 : 0.4}
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 3}
                fontSize={10}
                fill={chartColor.label}
                fontFamily="var(--font-sans)"
                textAnchor="end"
              >
                {formatValue(Math.round(tv))}
              </text>
            </g>
          );
        })}

        {/* Series: areas first (behind), then lines */}
        {series.map((s, si) => {
          const { area } = pathFor(s.data);
          const showFill = s.fill ?? si === 0;
          return showFill ? (
            <path key={`a-${si}`} d={area} fill={s.color} opacity={0.1} />
          ) : null;
        })}
        {series.map((s, si) => {
          const { line } = pathFor(s.data);
          return (
            <path
              key={`l-${si}`}
              d={line}
              fill="none"
              stroke={s.color}
              strokeWidth={chartGeometry.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* X labels */}
        {labels.map((lab, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={i}
              x={xAt(i)}
              y={height - 8}
              fontSize={10}
              fill={chartColor.label}
              fontFamily="var(--font-sans)"
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            >
              {lab}
            </text>
          ) : null
        )}

        {/* Hover crosshair + points */}
        {hoverIdx !== null && (
          <>
            <line
              x1={xAt(hoverIdx)}
              y1={PAD_TOP}
              x2={xAt(hoverIdx)}
              y2={PAD_TOP + innerH}
              stroke={chartColor.label}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {series.map((s, si) =>
              s.data[hoverIdx] !== undefined ? (
                <circle
                  key={si}
                  cx={xAt(hoverIdx)}
                  cy={yAt(s.data[hoverIdx])}
                  r={chartGeometry.dotRadius}
                  fill={s.color}
                  stroke="var(--color-surface)"
                  strokeWidth={1.5}
                />
              ) : null
            )}
          </>
        )}
      </svg>

      {/* Tooltip */}
      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-[var(--radius-card)] border px-2 py-1.5 shadow-[var(--shadow-2)]"
          style={{
            left: `min(max(${xAt(hoverIdx)}px, 70px), ${width - 70}px)`,
            top: PAD_TOP,
            transform: "translateX(-50%)",
            background: "var(--color-elevated)",
            borderColor: "var(--color-border-subtle)",
          }}
        >
          <p className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            {labels[hoverIdx]}
          </p>
          {series.map((s, si) => (
            <p
              key={si}
              className="favo-small flex items-center gap-1.5"
              style={{ color: "var(--color-text-strong)" }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: s.color,
                }}
              />
              {s.label}: {formatValue(s.data[hoverIdx] ?? 0)}
            </p>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map((s, si) => (
          <span
            key={si}
            className="favo-caption flex items-center gap-1.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 10,
                height: 3,
                borderRadius: 2,
                background: s.color,
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
