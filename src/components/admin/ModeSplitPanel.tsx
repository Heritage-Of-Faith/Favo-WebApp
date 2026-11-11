"use client";

// REQ-121 · PRD §7.1 — the live COGS dashboard, split per mode: "the
// dashboard reports by mode rather than as one blended figure". Revenue,
// COGS, gross margin and the profit flag per mode come from getModeSplit
// (Σ frozen order_cogs integers through periodFigures); nothing is computed
// here but the rendering. Three states, never conflated (REQ-129): a mode
// with no orders → its zeroes and "No sales"; UNAVAILABLE → the word and the
// item named (REQ-109); provisional → --status-warn, never green (REQ-110).
// Expenses carry no mode, so they are shown once for the period.

import { useEffect, useState, useTransition } from "react";
import { getModeSplit } from "@/server/actions/cogs";
import { formatZar } from "@/lib/format";
import { NET_TONE_COLOR, PROVISIONAL, unavailableText } from "@/lib/cost-state";
import type { ModeFigures, ModeSplit } from "@/lib/mode-split";
import type { ModeKey } from "@/lib/weekly-summary";

const MODE_LABEL: Record<ModeKey, string> = {
  weekday: "Weekday",
  sunday: "Sunday",
  event: "Event",
  unassigned: "No mode recorded",
};

function cogsText(m: ModeFigures): string {
  if (m.cogsZar === null) return unavailableText(m.absentItemNames, m.ordersWithoutCost);
  return m.costState === "provisional" ? `${formatZar(m.cogsZar)} · ${PROVISIONAL}` : formatZar(m.cogsZar);
}

function marginText(m: ModeFigures): string {
  if (m.grossMarginZar === null) return unavailableText(m.absentItemNames, m.ordersWithoutCost);
  return formatZar(m.grossMarginZar);
}

export function ModeSplitTable({ split }: { split: ModeSplit }) {
  // The three modes always print, zeroes included; a day with no mode only when it holds orders.
  const keys: ModeKey[] = ["weekday", "sunday", "event"];
  if (split.modes.unassigned.orderCount > 0) keys.push("unassigned");
  return (
    <>
      <table className="w-full text-left favo-small">
        <thead>
          <tr style={{ color: "var(--color-text-muted)" }}>
            <th className="py-1">Mode</th>
            <th className="py-1">Revenue</th>
            <th className="py-1">COGS</th>
            <th className="py-1">Gross margin</th>
            <th className="py-1">Profit or loss</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const m = split.modes[k];
            return (
              <tr key={k} data-mode={k} data-cost-state={m.costState}>
                <td className="py-1">{MODE_LABEL[k]}</td>
                <td className="py-1">{formatZar(m.revenueZar)}</td>
                <td className="py-1">{cogsText(m)}</td>
                <td className="py-1">{marginText(m)}</td>
                <td className="py-1" style={{ color: NET_TONE_COLOR[m.tone], fontWeight: 600 }}>
                  {m.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="favo-small mt-2" data-testid="mode-split-expenses">
        Expenses (all modes): {formatZar(split.expensesZar)}
      </p>
    </>
  );
}

export default function ModeSplitPanel({
  from,
  to,
  refreshKey,
  initialSplit,
}: {
  from: string;
  to: string;
  /** Changes whenever the live figures change, to refetch. */
  refreshKey?: string;
  /** A split to show before the first fetch returns (tests, SSR). */
  initialSplit?: ModeSplit;
}) {
  const [split, setSplit] = useState<ModeSplit | null>(initialSplit ?? null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    start(async () => {
      try {
        const res = await getModeSplit({ from, to });
        if (res.ok) {
          setSplit(res.data);
          setError(null);
        } else {
          setError(res.message);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the figures by mode");
      }
    });
  }, [from, to, refreshKey]);

  return (
    <section
      className="rounded-[var(--radius-card)] border p-4"
      style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
    >
      <h2 className="favo-label mb-2">By mode — {from === to ? from : `${from} to ${to}`}</h2>
      {error !== null ? (
        <p role="alert" className="favo-small" style={{ color: "var(--color-error)" }}>
          {error}
        </p>
      ) : split === null ? (
        <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
          loading…
        </p>
      ) : (
        <ModeSplitTable split={split} />
      )}
    </section>
  );
}
