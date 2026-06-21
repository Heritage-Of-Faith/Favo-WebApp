"use client";

// Loyalty audit table — AT-120 / AT-123
// Paginated, filterable list of loyalty_transactions.
// Follows the same pattern as AuditViewer.tsx.

import { useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import { listLoyaltyAudit } from "@/server/actions/loyalty";
import type { LoyaltyAuditRow } from "@/server/actions/loyalty";
import AdjustLoyaltyDialog from "./AdjustLoyaltyDialog";

const PAGE_SIZE = 50;

const KIND_OPTIONS = ["earn", "redeem", "adjustment", "expiry"] as const;
type Kind = typeof KIND_OPTIONS[number];

type Props = {
  initialRows: LoyaltyAuditRow[];
  total: number;
};

export default function LoyaltyAuditTable({ initialRows, total: initialTotal }: Props) {
  const [rows, setRows] = useState<LoyaltyAuditRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);

  const [kind, setKind] = useState<Kind | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function fetchPage(
    targetPage: number,
    filters?: { kind: Kind | ""; dateFrom: string; dateTo: string }
  ) {
    const f = filters ?? { kind, dateFrom, dateTo };
    const result = await listLoyaltyAudit({
      page: targetPage,
      kind: f.kind || undefined,
      dateFrom: f.dateFrom || undefined,
      dateTo: f.dateTo || undefined,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRows(result.data.rows);
    setTotal(result.data.total);
    setPage(result.data.page);
    setError(null);
  }

  function handleApply() {
    startTransition(() => { void fetchPage(0); });
  }

  function handleClear() {
    setKind("");
    setDateFrom("");
    setDateTo("");
    startTransition(() => {
      void fetchPage(0, { kind: "", dateFrom: "", dateTo: "" });
    });
  }

  function handleAdjustSuccess() {
    startTransition(() => { void fetchPage(page); });
  }

  const hasFilter = kind || dateFrom || dateTo;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {/* Filter bar + Adjust Balance button */}
      <div className="flex flex-wrap gap-3 items-end justify-between p-4 bg-elevated border border-border-subtle rounded-[var(--radius-card)]">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="favo-caption">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind | "")}
              className="h-9 px-2 text-sm bg-surface border border-border-subtle rounded-[var(--radius-btn)] text-text-strong focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">All kinds</option>
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="favo-caption">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 px-2 text-sm bg-surface border border-border-subtle rounded-[var(--radius-btn)] text-text-strong focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="favo-caption">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 px-2 text-sm bg-surface border border-border-subtle rounded-[var(--radius-btn)] text-text-strong focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <button
            type="button"
            onClick={handleApply}
            disabled={isPending}
            className="h-9 px-4 text-sm font-semibold bg-accent text-text-inverse rounded-[var(--radius-btn)] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isPending ? "Loading…" : "Apply"}
          </button>

          {hasFilter && (
            <button
              type="button"
              onClick={handleClear}
              disabled={isPending}
              className="h-9 px-3 text-sm text-text-muted hover:text-text-strong disabled:opacity-50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="h-9 px-4 text-sm font-semibold bg-accent text-text-inverse rounded-[var(--radius-btn)] hover:opacity-90 transition-opacity"
        >
          Adjust Balance
        </button>
      </div>

      {error && <p className="text-sm text-error px-1">{error}</p>}

      {/* Table */}
      <div className="border border-border-subtle rounded-[var(--radius-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-elevated">
              <th className="text-left px-3 py-2.5 favo-caption font-semibold whitespace-nowrap">At (SAST)</th>
              <th className="text-left px-3 py-2.5 favo-caption font-semibold">Customer</th>
              <th className="text-left px-3 py-2.5 favo-caption font-semibold">Kind</th>
              <th className="text-right px-3 py-2.5 favo-caption font-semibold">Points</th>
              <th className="text-left px-3 py-2.5 favo-caption font-semibold">Order</th>
              <th className="text-left px-3 py-2.5 favo-caption font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-text-muted favo-small">
                  {isPending ? "Loading…" : "No loyalty transactions found."}
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr
                key={row.id}
                className={[
                  "border-b border-border-subtle last:border-0",
                  i % 2 === 0 ? "bg-surface" : "bg-elevated",
                  isPending ? "opacity-50" : "",
                ].join(" ")}
              >
                <td className="px-3 py-2.5 text-text-muted whitespace-nowrap tabular-nums">
                  {formatDate(row.at)}
                </td>
                <td className="px-3 py-2.5 text-text-strong">{row.customerName}</td>
                <td className="px-3 py-2.5">
                  <KindBadge kind={row.kind} />
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${row.delta > 0 ? "text-[var(--color-success)]" : "text-error"}`}>
                  {row.delta > 0 ? `+${row.delta}` : String(row.delta)}
                </td>
                <td className="px-3 py-2.5 text-text-muted font-mono text-xs">
                  {row.orderId ? `${row.orderId.slice(0, 8)}…` : "—"}
                </td>
                <td className="px-3 py-2.5 text-text-muted favo-small max-w-[200px] truncate">
                  {row.reason ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-text-muted px-1">
        <span className="favo-small">
          {total === 0
            ? "No entries"
            : `Showing ${from}–${to} of ${total.toLocaleString()}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => startTransition(() => { void fetchPage(page - 1); })}
            disabled={page === 0 || isPending}
            className="h-8 px-3 border border-border-subtle rounded-[var(--radius-btn)] text-sm hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => startTransition(() => { void fetchPage(page + 1); })}
            disabled={(page + 1) * PAGE_SIZE >= total || isPending}
            className="h-8 px-3 border border-border-subtle rounded-[var(--radius-btn)] text-sm hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      </div>

      <AdjustLoyaltyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={handleAdjustSuccess}
      />
    </div>
  );
}

function KindBadge({ kind }: { kind: LoyaltyAuditRow["kind"] }) {
  const color =
    kind === "earn"
      ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
      : kind === "redeem"
        ? "bg-accent/10 text-accent"
        : kind === "expiry"
          ? "bg-error/10 text-error"
          : "bg-elevated text-text-muted";

  return (
    <span className={`inline-block px-2 py-0.5 rounded-[var(--radius-btn)] text-xs font-semibold ${color}`}>
      {kind}
    </span>
  );
}
