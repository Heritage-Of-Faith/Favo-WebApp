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
import MarginByShotPanel from "@/components/admin/MarginByShotPanel";
import type { CogsLive } from "@/lib/types";
import {
  combineCostStates,
  periodFigures,
  UNAVAILABLE,
  unavailableText,
  type NetTone,
} from "@/lib/cost-state";

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

/**
 * Σ of several days' inputs (revenue, COGS, expenses — integer cents), then
 * the derived figures from periodFigures, the same function the CSV and the
 * weekly/monthly reports use. COGS is NULL (UNAVAILABLE) if any day's is.
 */
export function aggregate(days: readonly CogsLive[], date: string): CogsLive {
  const revenueZar = days.reduce((s, d) => s + d.revenueZar, 0);
  const cogsZar = days.some((d) => d.cogsZar === null) ? null : days.reduce((s, d) => s + (d.cogsZar as number), 0);
  const expensesZar = days.reduce((s, d) => s + d.expensesZar, 0);
  const costState = combineCostStates(days.map((d) => d.costState));
  const f = periodFigures({ revenueZar, cogsZar, expensesZar, costState });
  return {
    date,
    revenueZar,
    cogsZar,
    expensesZar,
    grossMarginZar: f.grossMarginZar,
    netZar: f.netZar,
    costState,
    absentItems: [...new Set(days.flatMap((d) => d.absentItems))].sort(),
    ordersWithoutCost: days.reduce((s, d) => s + d.ordersWithoutCost, 0),
  };
}

/**
 * The revenue-allocation donut. When net ≥ 0 the slices are COGS, expenses and
 * net, which add up to revenue — so each slice's % is its share OF REVENUE,
 * the same % the COGS tile shows. On a loss the slices are COGS and expenses
 * (their share of costs) and the centre says so. NULL when COGS is UNAVAILABLE.
 */
export function allocationSlices(kpi: Pick<CogsLive, "revenueZar" | "cogsZar" | "expensesZar" | "netZar">) {
  if (kpi.cogsZar === null || kpi.netZar === null) return null;
  const slices: { label: string; value: number; color: string }[] = [
    { label: "COGS", value: kpi.cogsZar, color: chartColor.warning },
    { label: "Expenses", value: kpi.expensesZar, color: chartColor.brand },
  ];
  // A slice split only — the net's tone/colour comes from periodFigures, never this sign.
  if (kpi.netZar < 0) return { slices, centerZar: kpi.cogsZar + kpi.expensesZar, centerSub: "costs" };
  slices.push({ label: "Net", value: kpi.netZar, color: chartColor.positive });
  return { slices, centerZar: kpi.revenueZar, centerSub: "revenue" };
}

const KPI_TONE: Record<NetTone, "default" | "positive" | "negative" | "warn" | "unavailable"> = {
  neutral: "default",
  positive: "positive",
  negative: "negative",
  warn: "warn",
  unavailable: "unavailable",
};

const STATUS_LABEL: Record<CogsStreamStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  polling: "Polling",
  offline: "Offline",
};

// FAVO brand palette only.
const STATUS_COLOR: Record<CogsStreamStatus, string> = {
  connecting: "var(--color-text-muted)",
  live: "var(--color-dark-teal)",
  polling: "var(--color-cool-steel)",
  offline: "var(--color-crimson-carrot)",
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

  // Period aggregate: Σ of the days' figures — each day already Σ order_cogs
  // (REQ-106). Any UNAVAILABLE day makes the period's cost figures UNAVAILABLE
  // (REQ-109); any provisional day makes it provisional (REQ-110).
  const periodTotal: CogsLive = inspectDate && snapshot ? snapshot : aggregate(trend, today.date);

  // Half-period comparison for trend arrows (first half vs second half).
  const half = Math.floor(trend.length / 2);
  const periodPrev = aggregate(trend.slice(0, half), today.date);
  const periodCurr = aggregate(trend.slice(half), today.date);

  // KPI source: snapshot when inspecting a date, else the period aggregate.
  const kpi = periodTotal;
  const cur = inspectDate ? view : periodCurr;
  const prev = inspectDate ? prevDay : periodPrev;
  const kpiTrend = {
    revenue: trendOf(cur.revenueZar, prev?.revenueZar),
    cogs: cur.cogsZar === null || prev?.cogsZar === null ? undefined : trendOf(cur.cogsZar, prev?.cogsZar),
    net: cur.netZar === null || prev?.netZar === null ? undefined : trendOf(cur.netZar, prev?.netZar),
  };
  const kpiSub = inspectDate ? undefined : `last ${rangeDays}d`;

  const trendCostKnown = trend.every((t) => t.cogsZar !== null && t.netZar !== null);
  // Every derived figure on screen — tone, label, COGS % — from periodFigures.
  const fig = periodFigures(kpi);
  const tone = fig.tone;
  const unavailable = kpi.costState === "unavailable";
  const unavailableLine = unavailableText(kpi.absentItems, kpi.ordersWithoutCost);
  const netWord = fig.label;

  // Revenue allocation for the viewed day or period (handles loss gracefully).
  // Not drawn while the cost is UNAVAILABLE — a split of an absent number.
  const allocation = allocationSlices(kpi);

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="admin-page-title" style={{ color: "var(--color-text-strong)" }}>
            Live COGS
          </h1>
          <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
            {inspectDate ? `Viewing · ${inspectDate}` : `Last ${rangeDays} days`}
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

      {/* ── UNAVAILABLE: an absent cost input, named (AT-190/AT-192, REQ-109) ── */}
      {unavailable && (
        <AlertTile
          severity="unavailable"
          title={`COGS, gross margin and net: ${unavailableLine}`}
          description="A cost input is missing, so no figure is shown rather than a smaller one. Enter the missing cost to restore these figures."
          action={
            <a href="/admin/yield" className="favo-small" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
              Recost
            </a>
          }
        />
      )}

      {/* ── Provisional: estimated lot costs, never green (AT-191, REQ-110) ─── */}
      {kpi.costState === "provisional" && (
        <AlertTile
          severity="provisional"
          title="Provisional — these figures rest on estimated lot costs"
          description="Margin and net stay provisional until every contributing lot is invoice-backed."
          action={
            <a href="/admin/yield" className="favo-small" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
              Recost
            </a>
          }
        />
      )}

      {/* ── Empty-period notice ─────────────────────────────────────────────── */}
      {kpi.revenueZar === 0 && kpi.costState === "empty" && (
        <AlertTile
          severity="info"
          title={inspectDate ? "No activity recorded for this day" : `No activity recorded in the last ${rangeDays} days`}
          description="Figures populate as orders are placed and ingredients are deducted. Take an order on the POS to see them update live."
        />
      )}

      {/* ── KPI tiles ──────────────────────────────────────────────────────── */}
      <TileGrid minTile={200}>
        <KpiTile
          label="Revenue"
          valueZar={kpi.revenueZar}
          trend={kpiTrend.revenue}
          sub={kpiSub ?? (viewingToday ? "today" : undefined)}
          hint="sales from paid orders"
        />
        <KpiTile
          label="COGS"
          {...(kpi.cogsZar === null ? { valueText: UNAVAILABLE } : { valueZar: kpi.cogsZar })}
          tone={unavailable ? "unavailable" : kpi.costState === "provisional" ? "warn" : "default"}
          trend={kpiTrend.cogs && { ...kpiTrend.cogs, upIsGood: false }}
          sub={
            kpi.cogsZar === null
              ? unavailableLine
              : fig.cogsPctOfRevenue !== null
                ? `${Math.round(fig.cogsPctOfRevenue)}% of revenue`
                : undefined
          }
          hint="ingredient cost of items sold"
        />
        <KpiTile
          label="Gross margin"
          {...(fig.grossMarginZar === null ? { valueText: UNAVAILABLE } : { valueZar: fig.grossMarginZar })}
          tone={unavailable ? "unavailable" : kpi.costState === "provisional" ? "warn" : "default"}
          sub={fig.grossMarginPct !== null ? `${Math.round(fig.grossMarginPct)}% of revenue` : undefined}
          hint="revenue − COGS (the export's margin)"
        />
        <KpiTile label="Expenses" valueZar={kpi.expensesZar} hint="operating expenses logged" />
        <KpiTile
          label="Net"
          {...(kpi.netZar === null ? { valueText: UNAVAILABLE } : { valueZar: kpi.netZar })}
          tone={KPI_TONE[tone]}
          trend={kpiTrend.net}
          sub={kpiSub ? `${kpiSub} · ${netWord}` : netWord}
          hint="revenue − COGS − expenses"
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
              // COGS and net are drawn only when no day in the window is
              // UNAVAILABLE — an absent figure is never plotted as 0 (REQ-109).
              ...(trendCostKnown
                ? [
                    { label: "COGS", data: trend.map((t) => t.cogsZar as number), color: chartColor.warning, fill: false },
                    { label: "Net", data: trend.map((t) => t.netZar as number), color: chartColor.positive, fill: false },
                  ]
                : []),
            ]}
            ariaLabel={`Revenue, COGS and net over the last ${rangeDays} days`}
          />
        </section>

        <section
          className="rounded-[var(--radius-card)] border p-4"
          style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
        >
          <h2 className="favo-label mb-3">Revenue allocation — {inspectDate ?? `last ${rangeDays}d`}</h2>
          {allocation === null || kpi.cogsZar === null || kpi.netZar === null ? (
            <p className="favo-small" style={{ color: "var(--status-unavailable)", fontWeight: 600 }}>
              {unavailableLine}
            </p>
          ) : (
            <DonutChart
              data={allocation.slices}
              size={150}
              formatValue={formatZar}
              centerLabel={formatZar(allocation.centerZar)}
              centerSub={allocation.centerSub}
              ariaLabel={`Revenue allocation: COGS ${formatZar(kpi.cogsZar)}, expenses ${formatZar(kpi.expensesZar)}, net ${formatZar(kpi.netZar)}`}
            />
          )}
          {/* Only a costed period with a real loss says "loss" — never an empty R0 day. */}
          {tone === "negative" && kpi.netZar !== null && (
            <p className="favo-caption mt-2" style={{ color: "var(--color-crimson-carrot)", textTransform: "none", letterSpacing: 0 }}>
              Operating at a loss of {formatZar(Math.abs(kpi.netZar))} — costs exceed revenue.
            </p>
          )}
        </section>
      </div>

      {/* ── Margin by shot count (AT-208, REQ-139) — same window as the tiles ─ */}
      <MarginByShotPanel
        from={inspectDate ?? trend[0]?.date ?? today.date}
        to={inspectDate ?? today.date}
        refreshKey={`${today.revenueZar}:${today.cogsZar}:${today.costState}`}
      />

      {/* ── Daily net ──────────────────────────────────────────────────────── */}
      <section
        className="rounded-[var(--radius-card)] border p-4"
        style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
      >
        <h2 className="favo-label mb-2">Daily net — last {rangeDays} days</h2>
        {trendCostKnown ? (
          <BarChart
            data={trend.map((t) => ({ label: shortDate(t.date), value: t.netZar as number }))}
            formatValue={formatZar}
            ariaLabel={`Daily net profit or loss over the last ${rangeDays} days`}
          />
        ) : (
          <ul className="favo-small space-y-1">
            {trend.map((t) => (
              <li key={t.date} style={{ color: t.netZar === null ? "var(--status-unavailable)" : "var(--color-text-strong)" }}>
                {shortDate(t.date)} ·{" "}
                {t.netZar === null ? unavailableText(t.absentItems, t.ordersWithoutCost) : formatZar(t.netZar)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
