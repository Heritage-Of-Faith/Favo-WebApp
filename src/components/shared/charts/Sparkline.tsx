// Sparkline — task N7.
// Tiny, dependency-free SVG trend line. Server-safe (no hooks, no "use client").
// Renders an empty-state placeholder rather than crashing on no data.

import { chartColor, chartGeometry } from "@/lib/charts/tokens";

export interface SparklineProps {
  /** Y-values in chronological order. */
  data: number[];
  width?: number;
  height?: number;
  /** Stroke colour — a CSS var reference from chartColor by default. */
  color?: string;
  /** Fill the area under the line with a faint tint of the stroke colour. */
  fill?: boolean;
  className?: string;
  /** Accessible summary of the trend. */
  ariaLabel?: string;
}

export default function Sparkline({
  data,
  width = 120,
  height = 32,
  color = chartColor.brand,
  fill = true,
  className,
  ariaLabel,
}: SparklineProps) {
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  // Empty / single-point states: render a flat baseline placeholder.
  if (data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        role="img"
        aria-label={ariaLabel ?? "No trend data"}
      >
        <line
          x1={pad}
          y1={height / 2}
          x2={width - pad}
          y2={height / 2}
          stroke={chartColor.grid}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid divide-by-zero on flat series

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * innerW;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");

  const areaPath =
    `${linePath} L${points[points.length - 1].x.toFixed(2)},${height - pad} ` +
    `L${points[0].x.toFixed(2)},${height - pad} Z`;

  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={
        ariaLabel ??
        `Trend from ${data[0]} to ${data[data.length - 1]} over ${data.length} points`
      }
    >
      {fill && <path d={areaPath} fill={color} opacity={0.1} />}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={chartGeometry.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={chartGeometry.dotRadius} fill={color} />
    </svg>
  );
}
