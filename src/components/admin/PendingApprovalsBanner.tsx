"use client";

// Pending emergency-purchase approvals banner — task A10 (L10).
// Rendered in the admin shell so it surfaces on every page. Polls on mount;
// admins can one-tap approve. Renders nothing when there is nothing pending.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listPurchases, approveEmergencyPurchase } from "@/server/actions/purchases";
import { formatZar, formatDate } from "@/lib/format";
import type { Purchase } from "@/lib/types";

export interface PendingApprovalsBannerProps {
  canApprove: boolean;
}

export default function PendingApprovalsBanner({ canApprove }: PendingApprovalsBannerProps) {
  const [pending, setPending] = useState<Purchase[]>([]);
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(() => {
    listPurchases({ status: "pending_admin_approval" })
      .then((res) => {
        if (res.ok) setPending(res.data.purchases);
      })
      .catch(() => {
        /* non-fatal — banner just stays hidden */
      });
  }, []);

  useEffect(() => {
    load();
    // Refresh every 30s while the layout stays mounted across navigations.
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function approve(id: string) {
    setApproving(id);
    try {
      const res = await approveEmergencyPurchase(id);
      if (res.ok) {
        toast.success("Emergency purchase approved.");
        setPending((prev) => prev.filter((p) => p.id !== id));
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Failed to approve emergency purchase.");
    } finally {
      setApproving(null);
    }
  }

  if (pending.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-4 rounded-[var(--radius-card)] border p-3"
      style={{
        background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--color-warning) 40%, transparent)",
      }}
    >
      <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
        ⚠ {pending.length} emergency purchase{pending.length === 1 ? "" : "s"} awaiting approval
      </p>
      <ul className="mt-2 space-y-1.5">
        {pending.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3">
            <span className="favo-caption" style={{ color: "var(--color-text-muted)", textTransform: "none", letterSpacing: 0 }}>
              {p.sourceName} · {formatZar(p.totalZar)} · {formatDate(p.receivedAt)}
            </span>
            {canApprove && (
              <button
                type="button"
                onClick={() => void approve(p.id)}
                disabled={approving === p.id}
                className="min-h-9 rounded-[var(--radius-btn)] px-3 favo-cta disabled:opacity-50"
                style={{ background: "var(--color-warning)", color: "var(--color-text-inverse)" }}
              >
                {approving === p.id ? "…" : "Approve"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
