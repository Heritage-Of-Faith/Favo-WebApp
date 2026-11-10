// REQ-122 · PRD §7.2 — the ministry rollup, one view: weekday cost, Sunday
// revenue and cost, and event columns, netted over a selected week or month.
// No CSV and no spreadsheet needed. Server-safe (no client state).
//
// Three render states, never conflated (REQ-110, REQ-129, CLAUDE.md §5):
//   zeroes       — a genuinely empty period prints R0,00;
//   UNAVAILABLE  — an absent input, named, in --status-unavailable;
//   provisional  — an estimated lot cost, in --status-warn, never green.
// cogs_zar prints whole with outreach_cogs beneath it (REQ-158).

import AlertTile from "@/components/shared/dashboard/AlertTile";
import { NET_TONE_COLOR, UNAVAILABLE, type CostState } from "@/lib/cost-state";
import { formatZar } from "@/lib/format";
import type { MinistryDayRow, MinistryRollup } from "@/lib/ministry-rollup";
import { DAY_CLASS_LABEL, unavailableReason } from "@/lib/ministry-rollup-text";
import type { RollupPeriodKind } from "@/lib/ministry-period";

export type Props = MinistryRollup & {
  from: string;
  to: string;
  periodKind: RollupPeriodKind;
  date: string;
};

const cardStyle = { borderColor: "var(--color-border-subtle)" };
const headRow = "border-b favo-caption";
const headStyle = { borderColor: "var(--color-border-subtle)", color: "var(--color-text-muted)" };
const bodyRow = "border-b last:border-0 favo-small align-top";
const num = { fontVariantNumeric: "tabular-nums" as const };

/** A money figure, or UNAVAILABLE in its own colour — never a silent zero. */
function Zar({ v, state }: { v: number | null; state?: CostState }) {
  if (v === null) return <span style={{ color: "var(--status-unavailable)", fontWeight: 600 }}>{UNAVAILABLE}</span>;
  return <span style={state === "provisional" ? { color: "var(--status-warn)" } : undefined}>{formatZar(v)}</span>;
}

function dayLabel(d: MinistryDayRow): string {
  if (d.dayClass !== "paid") return DAY_CLASS_LABEL[d.dayClass];
  const sunday = d.modes.includes("sunday");
  const event = d.modes.includes("event");
  if (sunday && event) return "Sunday + paid event";
  return sunday ? "Sunday" : "Event — paid";
}

const recostLink = (
  <a href="/admin/yield" className="favo-small inline-flex min-h-11 min-w-11 items-center justify-center" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
    Recost
  </a>
);

export default function MinistryRollupView(r: Props) {
  const netColor = NET_TONE_COLOR[r.tone];
  return (
    <div className="space-y-8">
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Period">
        <label className="flex flex-col gap-1 favo-small">
          Period
          <select name="period" defaultValue={r.periodKind} className="h-11 rounded-[var(--radius-btn)] border px-2 text-base bg-[color:var(--color-surface)]">
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 favo-small">
          Containing
          <input type="date" name="date" defaultValue={r.date} className="h-11 rounded-[var(--radius-btn)] border px-2 text-base bg-[color:var(--color-surface)]" />
        </label>
        <button type="submit" className="h-11 rounded-[var(--radius-btn)] border px-4 favo-small transition-colors hover:bg-[color:var(--color-porcelain-soft)]">
          Show
        </button>
      </form>

      {r.unavailable.length > 0 && (
        <AlertTile
          severity="unavailable"
          title={`${UNAVAILABLE} — a figure below is missing an input, so it is not shown rather than shown smaller`}
          description={r.unavailable.map(unavailableReason).join(" · ")}
          action={r.unavailable.some((u) => u.kind === "absent_cost") ? recostLink : undefined}
        />
      )}
      {r.state === "provisional" && (
        <AlertTile
          severity="provisional"
          title="Provisional — these figures rest on estimated lot costs"
          description="The net stays provisional, never green, until every contributing lot is invoice-backed."
          action={recostLink}
        />
      )}

      <section className="space-y-3" aria-labelledby="mr-net">
        <h2 id="mr-net" className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
          What FAVO cost the ministry · {r.from} to {r.to}
        </h2>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={cardStyle}>
          <table className="w-full text-left">
            <tbody>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2">Contribution from paid sessions</th>
                <td className="px-3 py-2 text-right" style={num}>
                  <Zar v={r.ministryIncomeZar === null ? null : r.ministryIncomeZar - r.sweepsZar} />
                </td>
              </tr>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2">Dormant fund balances swept (Admin-confirmed)</th>
                <td className="px-3 py-2 text-right" style={num}><Zar v={r.sweepsZar} /></td>
              </tr>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2" style={{ color: "var(--color-text-strong)" }}>Ministry income</th>
                <td className="px-3 py-2 text-right" style={{ ...num, fontWeight: 600 }}><Zar v={r.ministryIncomeZar} /></td>
              </tr>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2">Weekday COGS</th>
                <td className="px-3 py-2 text-right" style={num}><Zar v={r.weekdayCogsZar} /></td>
              </tr>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2">Free event COGS</th>
                <td className="px-3 py-2 text-right" style={num}><Zar v={r.freeEventCogsZar} /></td>
              </tr>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2">Outreach COGS (voucher drinks)</th>
                <td className="px-3 py-2 text-right" style={num}><Zar v={r.outreachCogsZar} /></td>
              </tr>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2">Expenses (card fees excluded — already in contribution)</th>
                <td className="px-3 py-2 text-right" style={num}><Zar v={r.expensesZar} /></td>
              </tr>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2" style={{ color: "var(--color-text-strong)" }}>Ministry cost</th>
                <td className="px-3 py-2 text-right" style={{ ...num, fontWeight: 600 }}><Zar v={r.ministryCostZar} /></td>
              </tr>
              <tr className={bodyRow} style={cardStyle}>
                <th scope="row" className="px-3 py-2" style={{ color: "var(--color-text-strong)" }}>Ministry net</th>
                <td className="px-3 py-2 text-right" style={{ ...num, fontWeight: 700, color: netColor }} data-tone={r.tone}>
                  {r.ministryNetZar === null ? UNAVAILABLE : formatZar(r.ministryNetZar)}
                  <span className="block favo-caption" style={{ color: netColor, textTransform: "none", letterSpacing: 0 }}>{r.label}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="mr-days">
        <h2 id="mr-days" className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
          By day
        </h2>
        {r.days.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border p-6 text-center favo-small" style={{ ...cardStyle, color: "var(--color-text-muted)" }}>
            No orders this period
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={cardStyle}>
            <table className="w-full text-left">
              <thead>
                <tr className={headRow} style={headStyle}>
                  <th className="px-3 py-2">Revenue day</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Written off</th>
                  <th className="px-3 py-2 text-right">Collected</th>
                  <th className="px-3 py-2 text-right">COGS</th>
                  <th className="px-3 py-2 text-right">Card fees</th>
                  <th className="px-3 py-2 text-right">Contribution</th>
                  <th className="px-3 py-2 text-right">Ministry cost</th>
                </tr>
              </thead>
              <tbody>
                {r.days.map((d) => {
                  const paid = d.dayClass === "paid";
                  const unpaid = d.dayClass === "weekday" || d.dayClass === "free_event";
                  // A day that cannot be classed feeds neither column: UNAVAILABLE in both, never "—".
                  const unclassed = !paid && !unpaid;
                  return (
                    <tr key={d.date} className={bodyRow} style={cardStyle}>
                      <td className="px-3 py-2">{d.date}</td>
                      <td className="px-3 py-2">{dayLabel(d)}</td>
                      <td className="px-3 py-2 text-right" style={num}><Zar v={d.grossZar} /></td>
                      <td className="px-3 py-2 text-right" style={num}><Zar v={d.writtenOffZar} /></td>
                      <td className="px-3 py-2 text-right" style={num}><Zar v={d.collectedZar} /></td>
                      <td className="px-3 py-2 text-right" style={num}>
                        <Zar v={d.cogsZar} state={d.state} />
                        <span className="block favo-caption" style={{ textTransform: "none", letterSpacing: 0, color: "var(--color-text-muted)" }}>
                          of which outreach <Zar v={d.outreachCogsZar} state={d.state} />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right" style={num}><Zar v={d.processingFeeZar} /></td>
                      <td className="px-3 py-2 text-right" style={num}>
                        {paid || unclassed ? <Zar v={d.contributionZar} state={d.state} /> : "—"}
                      </td>
                      <td className="px-3 py-2 text-right" style={num}>
                        {unpaid || unclassed ? <Zar v={d.ministryCogsZar} state={d.state} /> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
