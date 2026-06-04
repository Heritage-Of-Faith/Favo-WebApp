"use client";

// Audit log viewer — task A6 (Gian, taken over from Mia)
// Paginated, filterable, read-only.
// Uses FAVO design tokens only — no shadcn/ui dependency.

import { useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import { listAudit } from "@/server/actions/audit";
const PAGE_SIZE = 50;
import type { AuditLog } from "@/lib/types";

const ENTITY_KINDS = [
  "order",
  "staff",
  "customer",
  "menu_item",
  "loyalty",
  "refund",
  "inventory",
] as const;

const ACTOR_ROLES = [
  "barista",
  "roaster",
  "manager",
  "finance",
  "admin",
  "owner",
] as const;

type Props = {
  initialRows: AuditLog[];
  total: number;
};

export default function AuditViewer({ initialRows, total: initialTotal }: Props) {
  const [rows, setRows] = useState<AuditLog[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);

  // Filters
  const [entityKind, setEntityKind] = useState("");
  const [actorRole, setActorRole] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Diff modal
  const [diffRow, setDiffRow] = useState<AuditLog | null>(null);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function fetchPage(
    targetPage: number,
    filters?: {
      entityKind: string;
      actorRole: string;
      dateFrom: string;
      dateTo: string;
    }
  ) {
    const f = filters ?? { entityKind, actorRole, dateFrom, dateTo };
    const result = await listAudit({
      page: targetPage,
      entityKind: f.entityKind || undefined,
      actorRole: f.actorRole || undefined,
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
    startTransition(() => {
      void fetchPage(0);
    });
  }

  function handleClear() {
    setEntityKind("");
    setActorRole("");
    setDateFrom("");
    setDateTo("");
    startTransition(() => {
      void fetchPage(0, { entityKind: "", actorRole: "", dateFrom: "", dateTo: "" });
    });
  }

  function handlePrev() {
    if (page === 0) return;
    startTransition(() => { void fetchPage(page - 1); });
  }

  function handleNext() {
    if ((page + 1) * PAGE_SIZE >= total) return;
    startTransition(() => { void fetchPage(page + 1); });
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const hasDiff = (row: AuditLog) => row.before !== null || row.after !== null;
  const hasActiveFilter = entityKind || actorRole || dateFrom || dateTo;

  return (
    <div className="space-y-4">
      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-end p-4 bg-elevated border border-border-subtle rounded-[var(--radius-card)]">
        <div className="flex flex-col gap-1">
          <label className="favo-caption">Entity</label>
          <select
            value={entityKind}
            onChange={(e) => setEntityKind(e.target.value)}
            className="h-9 px-2 text-sm bg-surface border border-border-subtle rounded-[var(--radius-btn)] text-text-strong focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All entities</option>
            {ENTITY_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="favo-caption">Role</label>
          <select
            value={actorRole}
            onChange={(e) => setActorRole(e.target.value)}
            className="h-9 px-2 text-sm bg-surface border border-border-subtle rounded-[var(--radius-btn)] text-text-strong focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All roles</option>
            {ACTOR_ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
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
          onClick={handleApply}
          disabled={isPending}
          className="h-9 px-4 text-sm font-semibold bg-accent text-text-inverse rounded-[var(--radius-btn)] hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending ? "Loading…" : "Apply"}
        </button>

        {hasActiveFilter && (
          <button
            onClick={handleClear}
            disabled={isPending}
            className="h-9 px-3 text-sm text-text-muted hover:text-text-strong disabled:opacity-50 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Error state ─────────────────────────────────────────────────── */}
      {error && (
        <p className="text-sm text-error px-1">{error}</p>
      )}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="border border-border-subtle rounded-[var(--radius-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-elevated">
              <th className="text-left px-3 py-2.5 favo-caption font-semibold whitespace-nowrap">At (SAST)</th>
              <th className="text-left px-3 py-2.5 favo-caption font-semibold">Entity</th>
              <th className="text-left px-3 py-2.5 favo-caption font-semibold">Action</th>
              <th className="text-left px-3 py-2.5 favo-caption font-semibold">Actor role</th>
              <th className="text-left px-3 py-2.5 favo-caption font-semibold">Reason</th>
              <th className="px-3 py-2.5 favo-caption font-semibold w-16 text-center">Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-text-muted favo-small">
                  {isPending ? "Loading…" : "No audit entries found."}
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
                <td className="px-3 py-2.5">
                  <span className="font-medium text-text-strong">{row.entityKind}</span>
                  <span className="text-text-muted ml-1.5 font-mono text-xs">
                    {row.entityId.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <ActionBadge action={row.action} />
                </td>
                <td className="px-3 py-2.5 text-text-muted">
                  {row.actorRole ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-text-muted max-w-[200px] truncate">
                  {row.reason ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {hasDiff(row) ? (
                    <button
                      onClick={() => setDiffRow(row)}
                      className="text-xs px-2 py-1 border border-border-subtle rounded-[var(--radius-btn)] text-text-muted hover:text-text-strong hover:border-accent transition-colors"
                    >
                      View
                    </button>
                  ) : (
                    <span className="text-text-faint text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-sm text-text-muted px-1">
        <span className="favo-small">
          {total === 0
            ? "No entries"
            : `Showing ${from}–${to} of ${total.toLocaleString()}`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={handlePrev}
            disabled={page === 0 || isPending}
            className="h-8 px-3 border border-border-subtle rounded-[var(--radius-btn)] text-sm hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <button
            onClick={handleNext}
            disabled={(page + 1) * PAGE_SIZE >= total || isPending}
            className="h-8 px-3 border border-border-subtle rounded-[var(--radius-btn)] text-sm hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      </div>

      {/* ── Diff modal ──────────────────────────────────────────────────── */}
      {diffRow !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDiffRow(null);
          }}
        >
          <div className="bg-surface border border-border-subtle rounded-[var(--radius-card)] shadow-2 w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col mx-4">
            {/* Modal header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-border-subtle shrink-0">
              <div>
                <h2 className="admin-section-title">
                  {diffRow.entityKind} · {diffRow.action}
                </h2>
                <p className="favo-small text-text-muted mt-0.5">
                  {formatDate(diffRow.at)}
                  {diffRow.actorRole ? ` · ${diffRow.actorRole}` : ""}
                  {diffRow.reason ? ` · ${diffRow.reason}` : ""}
                </p>
              </div>
              <button
                onClick={() => setDiffRow(null)}
                className="text-text-muted hover:text-text-strong text-xl leading-none transition-colors shrink-0 ml-4 mt-0.5"
                aria-label="Close diff"
              >
                ✕
              </button>
            </div>

            {/* Modal body — before / after JSON */}
            <div className="flex-1 overflow-auto p-5">
              <div className={`grid gap-4 ${diffRow.before !== null && diffRow.after !== null ? "grid-cols-2" : "grid-cols-1"}`}>
                {diffRow.before !== null && (
                  <div>
                    <p className="favo-caption text-text-muted mb-2">Before</p>
                    <pre className="text-xs bg-elevated border border-border-subtle rounded-[var(--radius-card)] p-3 overflow-auto whitespace-pre-wrap font-mono text-text-strong">
                      {JSON.stringify(diffRow.before, null, 2)}
                    </pre>
                  </div>
                )}
                {diffRow.after !== null && (
                  <div>
                    <p className="favo-caption text-text-muted mb-2">After</p>
                    <pre className="text-xs bg-elevated border border-border-subtle rounded-[var(--radius-card)] p-3 overflow-auto whitespace-pre-wrap font-mono text-text-strong">
                      {JSON.stringify(diffRow.after, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const color =
    action === "create"
      ? "bg-success/10 text-success"
      : action === "cancel" || action === "delete"
        ? "bg-error/10 text-error"
        : action === "transition"
          ? "bg-info/10 text-info"
          : "bg-elevated text-text-muted";

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-[var(--radius-btn)] text-xs font-semibold ${color}`}
    >
      {action}
    </span>
  );
}
