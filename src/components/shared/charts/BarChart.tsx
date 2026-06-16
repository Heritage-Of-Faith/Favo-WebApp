"use client";

// BarChart — task N7.
// Responsive single-series vertical bar chart, bespoke SVG. Bars are coloured
// by sign (positive vs negative) so it reads as a profit/loss view out of the
// box; override with a fixed colour via `barColor`. Hover shows a tooltip.

import { useRef, useState, useLayoutEffect } from "react";
import { chartColor, chartGeometry } from "@/lib/charts/tokens";

export interface BarDatum {
  label: string;
  value: number;
}

export interface BarChartProps {
  data: BarDatum[];
  height?: number;
  formatValue?: (v: number) => string;
  /** Fixed bar colour; when omitted, bars colour by sign. */
  barColor?: string;
  ariaLabel?: string;
  className?: string;
}

const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

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

export default function BarChart({
  data,
  height = 220,
  formatValue = (v) => String(v),
  barColor,
  ariaLabel,
  className,
}: BarChartProps) {
  const [ref, width] = useContainerWidth();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div ref={ref} className={className}>
        <div
          className="flex items-center justify-center rounded-[var(--radius-card)] border border-dashed"
          style={{ height, borderColor: "var(--color-border-subtle)" }}
        >
          <span className="favo-small" style={{ color: "var(--color-text-muted)" }}>
            No data to chart yet
          </span>
        </div>
      </div>
    );
  }

  const innerW = Math.max(width - PAD_LEFT - PAD_RIGHT, 10);
  const innerH = height - PAD_TOP - PAD_BOTTOM;

  const values = data.map((d) => d.value);
  const rawMax = Math.max(...values, 0);
  const rawMin = Math.min(...values, 0);
  const yMax = rawMax === 0 && rawMin === 0 ? 1 : rawMax * 1.08;
  const yMin = rawMin < 0 ? rawMin * 1.08 : 0;
  const yRange = yMax - yMin || 1;

  const yAt = (v: number) => PAD_TOP + innerH - ((v - yMin) / yRange) * innerH;
  const zeroY = yAt(0);

  const slot = innerW / data.length;
  const barW = Math.min(slot * 0.62, 48);
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div ref={ref} className={className} style={{ position: "relative" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel ?? `Bar chart of ${data.length} values`}
      >
        {/* Zero baseline */}
        <line
          x1={PAD_LEFT}
          y1={zeroY}
          x2={width - PAD_RIGHT}
          y2={zeroY}
          stroke={chartColor.grid}
          strokeWidth={1}
        />
        {data.map((d, i) => {
          const cx = PAD_LEFT + slot * i + slot / 2;
          const x = cx - barW / 2;
          const top = d.value >= 0 ? yAt(d.value) : zeroY;
          const h = Math.abs(yAt(d.value) - zeroY);
          const color = barColor ?? (d.value < 0 ? chartColor.negative : chartColor.positive);
          return (
            <g
              key={i}
              onPointerEnter={() => setHoverIdx(i)}
              onPointerLeave={() => setHoverIdx(null)}
            >
              <rect
                x={x}
                y={top}
                width={barW}
                height={Math.max(h, 1)}
                rx={chartGeometry.barRadius}
                fill={color}
                opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.55}
              />
              {(i % labelStep === 0 || i === data.length - 1) && (
                <text
                  x={cx}
                  y={height - 8}
                  fontSize={10}
                  fill={chartColor.label}
                  fontFamily="var(--font-sans)"
                  textAnchor="middle"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-[var(--radius-card)] border px-2 py-1.5 shadow-[var(--shadow-2)]"
          style={{
            left: `min(max(${PAD_LEFT + slot * hoverIdx + slot / 2}px, 70px), ${width - 70}px)`,
            top: PAD_TOP,
            transform: "translateX(-50%)",
            background: "var(--color-elevated)",
            borderColor: "var(--color-border-subtle)",
          }}
        >
          <p className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            {data[hoverIdx].label}
          </p>
          <p className="favo-small" style={{ color: "var(--color-text-strong)" }}>
            {formatValue(data[hoverIdx].value)}
          </p>
        </div>
      )}
    </div>
  );
}
