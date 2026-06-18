"use client";

// Monthly report row — task A13.
// Summary line (month, figures, status) that expands to the dual-sign block.

import { useState } from "react";
import { formatZar } from "@/lib/format";
import StatusBadge from "@/components/shared/StatusBadge";
import DualSignBlock from "@/components/admin/DualSignBlock";
import type { MonthlyReport } from "@/lib/types";

export interface MonthlyReportRowProps {
  report: MonthlyReport;
  canSignAdmin: boolean;
  onChanged: () => void;
}

const STATUS_VARIANT = {
  draft: "neutral",
  awaiting_signatures: "warning",
  closed: "ok",
} as const;

const STATUS_LABEL = {
  draft: "Draft",
  awaiting_signatures: "Awaiting signatures",
  closed: "Closed",
} as const;

function monthLabel(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  if (!y || !m) return monthIso;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[m - 1]} ${y}`;
}

export default function MonthlyReportRow({ report, canSignAdmin, onChanged }: MonthlyReportRowProps) {
  const [open, setOpen] = useState(report.status !== "closed");

  return (
    <li className="rounded-[var(--radius-card)] border" style={{ borderColor: "var(--color-border-subtle)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0">
          <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
            {monthLabel(report.month)}
          </p>
          <p className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            Rev {formatZar(report.revenueZar)} · COGS {formatZar(report.cogsZar)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="favo-small"
            style={{
              color: report.netZar >= 0 ? "var(--color-success)" : "var(--color-error)",
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatZar(report.netZar)}
          </span>
          <StatusBadge variant={STATUS_VARIANT[report.status]}>{STATUS_LABEL[report.status]}</StatusBadge>
          <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
            {open ? "▾" : "▸"}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t p-4" style={{ borderColor: "var(--color-border-subtle)" }}>
          <DualSignBlock
            report={report}
            canSignAdmin={canSignAdmin}
            onSigned={onChanged}
          />
        </div>
      )}
    </li>
  );
}
