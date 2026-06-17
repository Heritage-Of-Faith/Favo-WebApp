// Sync conflicts — owner: Mia (AT-80, A18)
// Shows open conflicts and conflicts resolved this week.
// Client component so the list updates in-place when a conflict is resolved.
"use client";

import { useCallback, useEffect, useState } from "react";
import ConflictRow from "@/components/admin/ConflictRow";
import {
  listSyncConflicts,
  type SyncConflictRow,
} from "@/server/actions/sync-conflicts";

export default function SyncConflictsPage() {
  const [open, setOpen] = useState<SyncConflictRow[]>([]);
  const [resolved, setResolved] = useState<SyncConflictRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await listSyncConflicts();
    if (res.ok) {
      setOpen(res.data.open);
      setResolved(res.data.resolvedThisWeek);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleResolved = useCallback((id: string, updated: SyncConflictRow) => {
    setOpen((prev) => prev.filter((c) => c.id !== id));
    setResolved((prev) => [updated, ...prev]);
  }, []);

  if (loading) {
    return <p className="text-sm text-text-muted">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="admin-page-title">Sync Conflicts</h1>
        <p className="mt-1 favo-small text-text-muted">
          Offline orders that failed to sync cleanly. Resolve each one by
          reviewing the diff and adding a note.
        </p>
      </header>

      {/* Open conflicts */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-muted">
          Open ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="text-sm text-text-muted">No open conflicts. All clear.</p>
        ) : (
          <div className="space-y-3" data-testid="open-list">
            {open.map((c) => (
              <ConflictRow
                key={c.id}
                conflict={c}
                onResolved={handleResolved}
              />
            ))}
          </div>
        )}
      </section>

      {/* Resolved this week */}
      {resolved.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-muted">
            Resolved this week ({resolved.length})
          </h2>
          <div className="space-y-3" data-testid="resolved-list">
            {resolved.map((c) => (
              <ConflictRow key={c.id} conflict={c} readOnly />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
