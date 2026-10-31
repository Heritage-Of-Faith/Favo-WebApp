"use client";

// AT-208 · REQ-139 — margin broken out by shot count on the §7.1 dashboard.
// The figures come from readMarginByShot (Σ frozen order_cogs integers,
// through periodFigures) — nothing is computed here but the rendering.
// Three states, never conflated (REQ-129): no orders → "No sales";
// UNAVAILABLE → the word and the item named (REQ-109); provisional →
// --status-warn with a link to the recosting screen, never green (REQ-110, L39).

import { useEffect, useState, useTransition } from "react";
import { getMarginByShot } from "@/server/actions/cogs";
import { formatZar } from "@/lib/format";
import { NET_TONE_COLOR, PROVISIONAL, UNAVAILABLE, unavailableText } from "@/lib/cost-state";
import { dayModeLabel, shotBucketLabel, type DayMode } from "@/lib/margin-by-shot";
import type { ShotMarginRow } from "@/server/cogs/period-cogs";

export interface MarginByShotPanelProps {
  from: string;
  to: string;
  /** Changes whenever the live figures change, to refetch. */
  refreshKey?: string;
  /** Rows to show before the first fetch returns (tests, SSR). */
  initialRows?: ShotMarginRow[];
}

export function MarginByShotTable({ rows }: { rows: readonly ShotMarginRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
        No sales
      </p>
    );
  }
  const provisional = rows.some((r) => r.costState === "provisional");
  const modes = [...new Set(rows.map((r) => r.mode))];
  return (
    <>
      {modes.map((mode) => (
        <ModeTable key={mode} mode={mode} rows={rows.filter((r) => r.mode === mode)} />
      ))}
      {provisional && (
        <p className="favo-caption mt-2" style={{ color: "var(--status-warn)", textTransform: "none", letterSpacing: 0 }}>
          Provisional — rests on estimated lot costs.{" "}
          <a href="/admin/yield" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
            Recost
          </a>
        </p>
      )}
    </>
  );
}

/** One mode's buckets — §7.1 reports by mode, never one blended figure. */
function ModeTable({ mode, rows }: { mode: DayMode; rows: readonly ShotMarginRow[] }) {
  return (
    <>
      <h3 className="favo-caption mt-3 mb-1" style={{ color: "var(--color-text-strong)" }}>
        {dayModeLabel(mode)}
      </h3>
      <table className="w-full text-left favo-small" data-mode={mode}>
        <thead>
          <tr style={{ color: "var(--color-text-muted)" }}>
            <th className="py-1">Shots</th>
            <th className="py-1">Orders</th>
            <th className="py-1">Revenue</th>
            <th className="py-1">COGS</th>
            <th className="py-1">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const unavailable = r.costState === "unavailable" || r.grossMarginZar === null;
            const color = NET_TONE_COLOR[r.tone];
            return (
              <tr key={String(r.bucket)} data-cost-state={r.costState}>
                <td className="py-1">{shotBucketLabel(r.bucket)}</td>
                <td className="py-1">{r.orderCount}</td>
                <td className="py-1">{formatZar(r.revenueZar)}</td>
                <td className="py-1">{r.cogsZar === null ? UNAVAILABLE : formatZar(r.cogsZar)}</td>
                <td className="py-1" style={{ color, fontWeight: 600 }}>
                  {unavailable
                    ? unavailableText(r.absentItemNames, r.ordersWithoutCost)
                    : `${formatZar(r.grossMarginZar as number)}${r.grossMarginPct !== null ? ` · ${r.grossMarginPct}%` : ""}${
                        r.costState === "provisional" ? ` · ${PROVISIONAL}` : ""
                      }`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export default function MarginByShotPanel({ from, to, refreshKey, initialRows }: MarginByShotPanelProps) {
  const [rows, setRows] = useState<ShotMarginRow[] | null>(initialRows ?? null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    start(async () => {
      try {
        const res = await getMarginByShot({ from, to });
        if (res.ok) {
          setRows(res.data.rows);
          setError(null);
        } else {
          setError(res.message);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load margin by shot count");
      }
    });
  }, [from, to, refreshKey]);

  return (
    <section
      className="rounded-[var(--radius-card)] border p-4"
      style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
    >
      <h2 className="favo-label mb-2">
        Margin by shot count — {from === to ? from : `${from} to ${to}`}
      </h2>
      {error !== null ? (
        <p role="alert" className="favo-small" style={{ color: "var(--color-error)" }}>
          {error}
        </p>
      ) : rows === null ? (
        <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
          loading…
        </p>
      ) : (
        <MarginByShotTable rows={rows} />
      )}
    </section>
  );
}
