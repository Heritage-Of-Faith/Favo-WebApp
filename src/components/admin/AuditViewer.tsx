// Audit log viewer — owner: Mia (task A6)
// Paginated, read-only. Filter by entity kind + action. View before/after JSON
// diff per row. shadcn Table + Dialog. Docs: docs/DATA_MODEL.md → audit_log.
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import {
  listAudit,
  ENTITY_KINDS,
  ACTIONS,
  type AuditEntry,
} from "@/lib/audit-placeholders";

const PAGE_SIZE = 5;
const ALL_VALUE = "all";

export default function AuditViewer() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entityKind, setEntityKind] = useState<string>(ALL_VALUE);
  const [action, setAction] = useState<string>(ALL_VALUE);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listAudit({
      page,
      pageSize: PAGE_SIZE,
      entityKind: entityKind === ALL_VALUE ? undefined : entityKind,
      action: action === ALL_VALUE ? undefined : action,
    });
    if (res.ok) {
      setRows(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }, [page, entityKind, action]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function onFilterChange(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(1); // reset to first page whenever a filter changes
  }

  return (
    <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="filter-entity">Entity</Label>
          <Select
            value={entityKind}
            onValueChange={(v) => onFilterChange(setEntityKind, v ?? ALL_VALUE)}
          >
            <SelectTrigger id="filter-entity" className="min-h-10 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All entities</SelectItem>
              {ENTITY_KINDS.map((k) => (
                <SelectItem key={k} value={k} className="capitalize">
                  {k.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="filter-action">Action</Label>
          <Select
            value={action}
            onValueChange={(v) => onFilterChange(setAction, v ?? ALL_VALUE)}
          >
            <SelectTrigger id="filter-action" className="min-h-10 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All actions</SelectItem>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a} className="capitalize">
                  {a.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-border-subtle bg-elevated p-6 text-sm text-text-muted">
          No audit entries match these filters.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead className="text-right">Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">
                  {formatDate(row.at)}
                </TableCell>
                <TableCell>
                  <span className="font-medium text-text-strong capitalize">
                    {row.entityKind.replace("_", " ")}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {row.entityId}
                  </span>
                </TableCell>
                <TableCell className="capitalize">
                  {row.action.replace("_", " ")}
                </TableCell>
                <TableCell>
                  <span className="capitalize">{row.actorRole ?? "system"}</span>
                  {row.actorId && (
                    <span className="block text-xs text-text-muted">
                      {row.actorId}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    onClick={() => setSelected(row)}
                  >
                    View diff
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {total} {total === 1 ? "entry" : "entries"} · page {page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-h-10"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-10"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      {selected && (
        <DiffDialog entry={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function DiffDialog({
  entry,
  onClose,
}: {
  entry: AuditEntry;
  onClose: () => void;
}) {
  // Union of keys across before + after so added/removed keys both show.
  const keys = Array.from(
    new Set([
      ...Object.keys(entry.before ?? {}),
      ...Object.keys(entry.after ?? {}),
    ])
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="capitalize">
            {entry.action.replace("_", " ")} — {entry.entityKind.replace("_", " ")}
          </DialogTitle>
          <DialogDescription>
            {entry.entityId} · {formatDate(entry.at)}
            {entry.reason ? ` · ${entry.reason}` : ""}
          </DialogDescription>
        </DialogHeader>

        {keys.length === 0 ? (
          <p className="py-4 text-sm text-text-muted">
            No field-level changes recorded for this entry.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => {
                const before = entry.before?.[key];
                const after = entry.after?.[key];
                const changed = JSON.stringify(before) !== JSON.stringify(after);
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium text-text-strong">
                      {key}
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {fmt(before)}
                    </TableCell>
                    <TableCell
                      className={
                        changed
                          ? "font-medium text-[color:var(--color-success)]"
                          : ""
                      }
                    >
                      {fmt(after)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Render a JSON value compactly for the diff cells.
function fmt(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
