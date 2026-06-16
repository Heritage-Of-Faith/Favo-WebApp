"use client";

// Monthly P&L manager — task A13.
// Lists reports, lets admins generate a draft for a chosen month, and refreshes
// after signatures. Role flags gate the generate + sign controls.

import { useState } from "react";
import { toast } from "sonner";
import { listMonthlyReports, generateMonthlyPnL } from "@/server/actions/monthly-pnl";
import MonthlyReportRow from "@/components/admin/MonthlyReportRow";
import type { MonthlyReport } from "@/lib/types";

export interface MonthlyReportsManagerProps {
  initialReports: MonthlyReport[];
  canGenerate: boolean;
  canSignAdmin: boolean;
  /** Previous month as YYYY-MM (default for the generate picker). */
  defaultMonth: string;
}

export default function MonthlyReportsManager({
  initialReports,
  canGenerate,
  canSignAdmin,
  defaultMonth,
}: MonthlyReportsManagerProps) {
  const [reports, setReports] = useState<MonthlyReport[]>(initialReports);
  const [month, setMonth] = useState(defaultMonth);
  const [generating, setGenerating] = useState(false);

  async function refresh() {
    const res = await listMonthlyReports();
    if (res.ok) setReports(res.data.reports);
  }

  async function generate() {
    setGenerating(true);
    try {
      const res = await generateMonthlyPnL(`${month}-01`);
      if (res.ok) {
        toast.success("Draft report generated.");
        void refresh();
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Failed to generate report. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      {canGenerate && (
        <div
          className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border p-4"
          style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-elevated)" }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="pnl-month" className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
              Month
            </label>
            <input
              id="pnl-month"
              type="month"
              value={month}
              max={defaultMonth}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 rounded-[var(--radius-btn)] border px-2 favo-small focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]"
              style={{ background: "var(--color-surface)", color: "var(--color-text-strong)", borderColor: "var(--color-border-subtle)" }}
            />
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={generating || !month}
            className="min-h-10 rounded-[var(--radius-btn)] px-4 favo-cta disabled:opacity-50"
            style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
          >
            {generating ? "Generating…" : "Generate draft"}
          </button>
        </div>
      )}

      {reports.length === 0 ? (
        <p
          className="rounded-[var(--radius-card)] border p-6 text-center favo-small"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-muted)" }}
        >
          No monthly reports yet.{" "}
          {canGenerate
            ? "Select a month above and generate the first one."
            : "Ask your admin to generate one."}
        </p>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <MonthlyReportRow
              key={r.id}
              report={r}
              canSignAdmin={canSignAdmin}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
