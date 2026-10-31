/**
 * WeeklySummary — AT-206, PRD §7.3 (the weekly ops summary, split by mode).
 * A server-rendered read. Three render states, never conflated (REQ-129):
 * a genuine zero prints as R0,00 / 0; an absent cost input prints
 * UNAVAILABLE with the item named; an estimated cost is labelled provisional
 * and never green (REQ-110, REQ-131).
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import { formatZar } from "@/lib/format";
import { NET_TONE_COLOR, PROVISIONAL, unavailableText, type CostState, type NetTone } from "@/lib/cost-state";
import { WALK_IN_NOT_RECORDED, type ModeSection } from "@/lib/weekly-summary";
import type { WeeklySummaryForViewer } from "@/server/reports/weekly-summary";
import { formatWeekEnding } from "@/lib/week-ending";

function cogsText(cogsZar: number | null, state: CostState, absent: readonly string[], ordersWithoutCost: number): string {
  if (cogsZar === null) return unavailableText(absent, ordersWithoutCost);
  return state === "provisional" ? `${formatZar(cogsZar)} · ${PROVISIONAL}` : formatZar(cogsZar);
}

function Row({ label, value, tone }: { label: string; value: string; tone?: NetTone }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-cool-steel/10 py-2">
      <span className="favo-small text-cool-steel">{label}</span>
      <span className="favo-body text-porcelain text-right" style={tone ? { color: NET_TONE_COLOR[tone] } : undefined}>
        {value}
      </span>
    </div>
  );
}

function consumptionRows(s: ModeSection) {
  const of = (kind: string) => s.consumption.filter((c) => c.kind === kind);
  const text = (kind: string) => {
    const rows = of(kind);
    return rows.length === 0 ? "0" : rows.map((c) => `${c.quantity} ${c.unit}`).join(" · ");
  };
  return (
    <>
      <Row label="Milk used" value={text("milk")} />
      <Row label="Beans used" value={text("bean")} />
    </>
  );
}

function marginText(s: ModeSection): string {
  if (s.grossMarginZar === null) return unavailableText(s.absentItemNames, s.ordersWithoutCost);
  return `${formatZar(s.grossMarginZar)} · ${s.label}`;
}

export default function WeeklySummaryView({ summary, weeks }: { summary: WeeklySummaryForViewer | null; weeks: string[] }) {
  return (
    <main className="min-h-screen bg-dark-teal">
      <div className="flex items-center gap-3 border-b border-cool-steel/20 px-4 py-3">
        <Link
          href={"/pos/queue" as Route}
          aria-label="Back to POS"
          className="flex h-11 w-11 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain"
        >
          <ArrowLeft size={18} strokeWidth={2} />
        </Link>
        <h1 className="favo-h3 text-porcelain">Weekly ops summary</h1>
      </div>

      <div className="mx-auto w-full max-w-[640px] p-6 flex flex-col gap-8">
        {summary === null ? (
          <p className="favo-small text-cool-steel">No weekly summary has been generated yet.</p>
        ) : (
          <>
            <p className="favo-small text-cool-steel">
              For week ending {formatWeekEnding(summary.weekEnding)} · Africa/Johannesburg
            </p>

            {/* Admin only: summaryForRole strips headline server-side for any other role. */}
            {summary.headline !== null && (
            <section>
              <h2 className="favo-label text-cool-steel mb-2">Week</h2>
              <Row label="Revenue" value={formatZar(summary.headline.revenueZar)} />
              <Row
                label="COGS"
                value={cogsText(summary.headline.cogsZar, summary.headline.costState, summary.headline.cogs.absentItemNames, summary.headline.cogs.ordersWithoutCost)}
              />
              <Row label="Expenses" value={formatZar(summary.headline.expensesZar)} />
              <Row
                label="Net"
                value={
                  summary.headline.netZar === null
                    ? unavailableText(summary.headline.cogs.absentItemNames, summary.headline.cogs.ordersWithoutCost)
                    : `${formatZar(summary.headline.netZar)} · ${summary.headline.label}`
                }
                tone={summary.headline.tone}
              />
            </section>
            )}

            <section>
              <h2 className="favo-label text-cool-steel mb-2">Weekday</h2>
              <Row label="Staff coffees" value={String(summary.sections.weekday.staffCoffees)} />
              {/* No walk_ins table exists yet (§6.5): say so — never print 0 for a count nobody records. */}
              <Row label="Walk-in count" value={WALK_IN_NOT_RECORDED} />
              <Row label="Drinks made" value={String(summary.sections.weekday.drinks)} />
              {consumptionRows(summary.sections.weekday)}
              <Row
                label="Cost"
                value={cogsText(summary.sections.weekday.cogsZar, summary.sections.weekday.costState, summary.sections.weekday.absentItemNames, summary.sections.weekday.ordersWithoutCost)}
              />
            </section>

            <section>
              <h2 className="favo-label text-cool-steel mb-2">Sunday</h2>
              <Row label="Revenue" value={formatZar(summary.sections.sunday.revenueZar)} />
              <Row
                label="COGS"
                value={cogsText(summary.sections.sunday.cogsZar, summary.sections.sunday.costState, summary.sections.sunday.absentItemNames, summary.sections.sunday.ordersWithoutCost)}
              />
              <Row label="Profit or loss" value={marginText(summary.sections.sunday)} tone={summary.sections.sunday.tone} />
            </section>

            <section>
              <h2 className="favo-label text-cool-steel mb-2">Events</h2>
              <Row label="Drinks made" value={String(summary.sections.event.drinks)} />
              {consumptionRows(summary.sections.event)}
              <Row
                label="Cost"
                value={cogsText(summary.sections.event.cogsZar, summary.sections.event.costState, summary.sections.event.absentItemNames, summary.sections.event.ordersWithoutCost)}
              />
              <Row label="Revenue" value={formatZar(summary.sections.event.revenueZar)} />
            </section>

            {summary.sections.unassigned.orderCount > 0 && (
              <section>
                <h2 className="favo-label text-cool-steel mb-2">No mode recorded</h2>
                <Row label="Orders" value={String(summary.sections.unassigned.orderCount)} />
                <Row label="Days" value={summary.sections.unassigned.days.join(", ")} />
              </section>
            )}
          </>
        )}

        {weeks.length > 1 && (
          <nav className="flex flex-wrap gap-2">
            {weeks.map((w) => (
              <Link key={w} href={`/pos/weekly?week=${w}` as Route} className="favo-small text-cool-steel underline">
                {w}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </main>
  );
}
