"use client";

// REQ-036's in-app alert — AT-207. A blocked daily close (reconciliation
// mismatch) shows on every admin page, naming the revenue day and the reason,
// for as long as its daily_closes row stays blocked. The PRD defines no
// resolve action, so there is no button here. Ordering is unaffected.

import { useCallback, useEffect, useState } from "react";
import { listBlockedCloses } from "@/server/actions/write-offs";
import type { BlockedClose } from "@/server/close/write-offs";

export default function BlockedClosesBanner() {
  const [blocked, setBlocked] = useState<BlockedClose[]>([]);

  const load = useCallback(() => {
    listBlockedCloses()
      .then((res) => {
        if (res.ok) setBlocked(res.data);
      })
      .catch(() => {
        /* non-fatal — banner just stays as it was */
      });
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (blocked.length === 0) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-[var(--radius-card)] border p-3"
      style={{
        background: "color-mix(in srgb, var(--color-error) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--color-error) 40%, transparent)",
      }}
    >
      <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
        Daily close blocked — {blocked.length} day{blocked.length === 1 ? "" : "s"}. Ordering is not affected.
      </p>
      <ul className="mt-1 space-y-1">
        {blocked.map((b) => (
          <li key={b.revenueDay} className="favo-caption" style={{ color: "var(--color-text-muted)", textTransform: "none", letterSpacing: 0 }}>
            {b.revenueDay}: {b.blockedReason}
          </li>
        ))}
      </ul>
    </div>
  );
}
