// ConflictRow — owner: Mia (AT-80, A18)
// One row in the sync conflicts list. Kind badge, JSON diff, resolve button.
// Colour bands per N8: payment_mismatch=red, state_collision=yellow, duplicate_order=neutral.
"use client";

import { useCallback, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import JsonDiff from "@/components/admin/JsonDiff";
import { resolveSyncConflict, type SyncConflictRow } from "@/server/actions/sync-conflicts";
import { formatDate } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  payment_mismatch: "Payment mismatch",
  state_collision: "State collision",
  duplicate_order: "Duplicate order",
};

const KIND_COLOR: Record<string, string> = {
  payment_mismatch: "var(--color-error)",
  state_collision: "var(--color-warning, #f59e0b)",
  duplicate_order: "var(--color-cool-steel)",
};

export interface ConflictRowProps {
  conflict: SyncConflictRow;
  onResolved?: (id: string, updated: SyncConflictRow) => void;
  readOnly?: boolean;
}

export default function ConflictRow({ conflict, onResolved, readOnly = false }: ConflictRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const noteId = useId();

  const handleResolve = useCallback(async () => {
    setSaving(true);
    const res = await resolveSyncConflict(conflict.id, note);
    if (res.ok) {
      toast.success("Conflict marked resolved.");
      onResolved?.(conflict.id, res.data);
    } else {
      toast.error(res.message);
    }
    setSaving(false);
  }, [conflict.id, note, onResolved]);

  const isOpen = conflict.status === "open";

  return (
    <article
      className="rounded-md border border-border-subtle bg-elevated"
      aria-label={`Sync conflict ${conflict.id}`}
      data-testid="conflict-row"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse conflict" : "Open conflict"}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: KIND_COLOR[conflict.kind] ?? "var(--color-cool-steel)" }}
            data-testid="kind-badge"
          >
            {KIND_LABEL[conflict.kind] ?? conflict.kind}
          </span>
          <span className="truncate text-sm text-text-muted">
            {conflict.orderId ? `Order ${conflict.orderId.slice(0, 8)}…` : "No order"} ·{" "}
            {formatDate(conflict.openedAt)}
          </span>
        </div>
        <span className="text-xs text-text-muted shrink-0">{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border-subtle px-4 py-4 space-y-4">
          <JsonDiff
            clientPayload={conflict.clientPayload}
            serverState={conflict.serverState}
          />

          {isOpen && !readOnly && (
            <div className="space-y-2">
              <label
                htmlFor={noteId}
                className="block text-xs font-medium text-text-muted"
              >
                Resolution note (optional)
              </label>
              <textarea
                id={noteId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Describe how this was resolved…"
                className="w-full rounded border border-border-subtle bg-surface px-3 py-2 text-sm text-text-strong focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
              <Button
                onClick={handleResolve}
                disabled={saving}
                size="sm"
                aria-label="Mark resolved"
              >
                {saving ? "Saving…" : "Mark resolved"}
              </Button>
            </div>
          )}

          {!isOpen && (
            <div className="rounded-md bg-surface px-3 py-2 text-sm text-text-muted">
              <span className="font-medium text-text-strong">Resolved</span>{" "}
              {conflict.resolvedAt && formatDate(conflict.resolvedAt)}
              {conflict.resolutionNote && ` — ${conflict.resolutionNote}`}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
