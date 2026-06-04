"use client";

// Live COGS dashboard — task A7 (taken over from Mia).
// Centrepiece of the admin surface. Shows today's revenue/COGS/expenses/net as
// KPI tiles, a multi-day trend, a revenue-allocation donut, and a daily-net bar
// chart. Refreshes within ~1s of any COGS-affecting change via useCogsLive.
//
// Filters: trend range (7/14/30/90 days) and a historical date inspector.

import { useCallback, useEffect, useState, useTransition } from "react";
import { getCogsHistory, getCogsLive } from "@/server/actions/cogs";
import { useCogsLive, type CogsStreamStatus } from "@/hooks/useCogsLive";
import { formatZar } from "@/lib/format";
import { chartColor } from "@/lib/charts/tokens";
import TileGrid from "@/components/shared/dashboard/TileGrid";
import KpiTile from "@/components/shared/dashboard/KpiTile";
import AlertTile from "@/components/shared/dashboard/AlertTile";
import AreaChart from "@/components/shared/charts/AreaChart";
import BarChart from "@/components/shared/charts/BarChart";
import DonutChart from "@/components/shared/charts/DonutChart";
import type { CogsLive } from "@/lib/types";

const RANGE_OPTIONS = [7, 14, 30, 90] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

export interface CogsDashboardProps {
  initialToday: CogsLive;
  initialHistory: CogsLive[];
  /** Latest SAST date (YYYY-MM-DD) — used as the date-picker max. */
  todayDate: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** "2026-06-05" → "5 Jun". */
function shortDate(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]}`;
}

function trendOf(current: number, previous: number | undefined) {
  if (previous === undefined || previous === current) {
    return { direction: "flat" as const, label: "no change" };
  }
  const delta = current - previous;
  const pct = previous !== 0 ? Math.round((delta / Math.abs(previous)) * 100) : 100;
  return {
    direction: delta > 0 ? ("up" as const) : ("down" as const),
    label: `${delta > 0 ? "+" : ""}${pct}% vs prev`,
  };
}

const STATUS_LABEL: Record<CogsStreamStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  polling: "Polling",
  offline: "Offline",
};

const STATUS_COLOR: Record<CogsStreamStatus, string> = {
  connecting: "var(--color-text-muted)",
  live: "var(--color-success)",
  polling: "var(--color-warning)",
  offline: "var(--color-error)",
};

// ── component ──────────────────────────────────────────────────────────────────

export default function CogsDashboard({ initialToday, initialHistory, todayDate }: CogsDashboardProps) {
  const [rangeDays, setRangeDays] = useState<RangeDays>(14);
  const [history, setHistory] = useState<CogsLive[]>(
    [...initialHistory].sort((a, b) => a.date.localeCompare(b.date))
  );
  const [, startHistory] = useTransition();

  // Historical date inspector: null = view today (live).
  const [inspectDate, setInspectDate] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CogsLive | null>(null);
  const [snapshotLoading, startSnapshot] = useTransition();

  const refreshHistory = useCallback(
    (days: RangeDays) => {
      startHistory(async () => {
        const res = await getCogsHistory({ days });
        if (res.ok) {
          setHistory([...res.data.history].sort((a, b) => a.date.localeCompare(b.date)));
        }
      });
    },
    []
  );

  const { today, status } = useCogsLive(initialToday, () => refreshHistory(rangeDays));

  // Refetch history when the range changes.
  useEffect(() => {
    refreshHistory(rangeDays);
  }, [rangeDays, refreshHistory]);

  // Fetch a historical day's snapshot when the inspector date changes.
  useEffect(() => {
    if (!inspectDate) {
      setSnapshot(null);
      return;
    }
    startSnapshot(async () => {
      const res = await getCogsLive({ date: inspectDate });
      if (res.ok) setSnapshot(res.data);
    });
  }, [inspectDate]);

  // The figures currently on display: live today, or the inspected snapshot.
  const view: CogsLive = inspectDate && snapshot ? snapshot : today;
  const viewingToday = !inspectDate;

  // Merge live `today` into the trend so the latest point is always current.
  const mergedByDate = new Map(history.map((h) => [h.date, h]));
  mergedByDate.set(today.date, today);
  const trend = Array.from(mergedByDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-rangeDays);

  const labels = trend.map((t) => shortDate(t.date));
  const prevDay = trend.length >= 2 ? trend[trend.length - 2] : undefined;

  // Revenue allocation for the viewed day (handles loss gracefully).
  const allocation = [
    { label: "COGS", value: Math.max(view.cogsZar, 0), color: chartColor.warning },
    { label: "Expenses", value: Math.max(view.expensesZar, 0), color: chartColor.neutral },
    { label: view.netZar >= 0 ? "Net profit" : "Net loss", value: Math.max(view.netZar, 0), color: chartColor.positive },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="admin-page-title" style={{ color: "var(--color-text-strong)" }}>
            Live COGS
          </h1>
          <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
            {viewingToday ? "Today" : "Viewing"} · {view.date}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="favo-caption inline-flex items-center gap-1.5"
            style={{ color: STATUS_COLOR[status] }}
            aria-live="polite"
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: STATUS_COLOR[status],
                boxShadow: status === "live" ? `0 0 0 3px color-mix(in srgb, ${STATUS_COLOR[status]} 25%, transparent)` : "none",
              }}
            />
            {STATUS_LABEL[status]}
          </span>
        </div>
      </header>

      {/* ── Cost-estimate warning (R10) ────────────────────────────────────── */}
      {view.costEstimatedWarning && (
        <AlertTile
          severity="warning"
          title="Some lot costs are best-estimate"
          description="COGS may be inaccurate until lots are recosted. Review costs under Inventory → lot drawer."
        />
      )}

      {/* ── KPI tiles ──────────────────────────────────────────────────────── */}
      <TileGrid minTile={200}>
        <KpiTile
          label="Revenue"
          valueZar={view.revenueZar}
          trend={trendOf(view.revenueZar, prevDay?.revenueZar)}
          sub={viewingToday ? "today" : undefined}
        />
        <KpiTile
          label="COGS"
          valueZar={view.cogsZar}
          trend={{ ...trendOf(view.cogsZar, prevDay?.cogsZar), upIsGood: false }}
          sub={view.revenueZar > 0 ? `${Math.round((view.cogsZar / view.revenueZar) * 100)}% of revenue` : undefined}
        />
        <KpiTile
          label="Expenses"
          valueZar={view.expensesZar}
          trend={{ ...trendOf(view.expensesZar, prevDay?.expensesZar), upIsGood: false }}
        />
        <KpiTile
          label="Net"
          valueZar={view.netZar}
          tone={view.netZar >= 0 ? "positive" : "negative"}
          trend={trendOf(view.netZar, prevDay?.netZar)}
          sub={view.profit ? "profit" : "loss"}
        />
      </TileGrid>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            Range
          </span>
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRangeDays(r)}
              aria-pressed={rangeDays === r}
              className="min-h-10 rounded-[var(--radius-btn)] px-3 favo-small transition-colors"
              style={{
                background: rangeDays === r ? "var(--color-text-strong)" : "var(--color-elevated)",
                color: rangeDays === r ? "var(--color-text-inverse)" : "var(--color-text-muted)",
                border: "1px solid var(--color-border-subtle)",
                fontWeight: rangeDays === r ? 600 : 400,
              }}
            >
              {r}d
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor="cogs-date" className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            Inspect day
          </label>
          <input
            id="cogs-date"
            type="date"
            max={todayDate}
            value={inspectDate ?? ""}
            onChange={(e) => setInspectDate(e.target.value || null)}
            className="min-h-10 rounded-[var(--radius-btn)] px-2 favo-small"
            style={{
              background: "var(--color-surface)",
              color: "var(--color-text-strong)",
              border: "1px solid var(--color-border-subtle)",
            }}
          />
          {inspectDate && (
            <button
              type="button"
              onClick={() => setInspectDate(null)}
              className="min-h-10 px-2 favo-small underline"
              style={{ color: "var(--color-accent)" }}
            >
              Back to live
            </button>
          )}
          {snapshotLoading && (
            <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
              loading…
            </span>
          )}
        </div>
      </div>

      {/* ── Trend + allocation ─────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section
          className="lg:col-span-2 rounded-[var(--radius-card)] border p-4"
          style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
        >
          <h2 className="favo-label mb-2">Revenue · COGS · Net — last {rangeDays} days</h2>
          <AreaChart
            labels={labels}
            formatValue={formatZar}
            series={[
              { label: "Revenue", data: trend.map((t) => t.revenueZar), color: chartColor.brand, fill: true },
              { label: "COGS", data: trend.map((t) => t.cogsZar), color: chartColor.warning, fill: false },
              { label: "Net", data: trend.map((t) => t.netZar), color: chartColor.positive, fill: false },
            ]}
            ariaLabel={`Revenue, COGS and net over the last ${rangeDays} days`}
          />
        </section>

        <section
          className="rounded-[var(--radius-card)] border p-4"
          style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
        >
          <h2 className="favo-label mb-3">Revenue allocation — {viewingToday ? "today" : view.date}</h2>
          <DonutChart
            data={allocation}
            size={150}
            formatValue={formatZar}
            centerLabel={formatZar(view.revenueZar)}
            centerSub="revenue"
            ariaLabel={`Revenue allocation: COGS ${formatZar(view.cogsZar)}, expenses ${formatZar(view.expensesZar)}, net ${formatZar(view.netZar)}`}
          />
          {view.netZar < 0 && (
            <p className="favo-caption mt-2" style={{ color: "var(--color-error)", textTransform: "none", letterSpacing: 0 }}>
              Operating at a loss of {formatZar(Math.abs(view.netZar))} — costs exceed revenue.
            </p>
          )}
        </section>
      </div>

      {/* ── Daily net ──────────────────────────────────────────────────────── */}
      <section
        className="rounded-[var(--radius-card)] border p-4"
        style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
      >
        <h2 className="favo-label mb-2">Daily net — last {rangeDays} days</h2>
        <BarChart
          data={trend.map((t) => ({ label: shortDate(t.date), value: t.netZar }))}
          formatValue={formatZar}
          ariaLabel={`Daily net profit or loss over the last ${rangeDays} days`}
        />
      </section>
    </div>
  );
}
