"use client";

/**
 * StuckChargesSection — admin recovery surface for BUG-O2.
 *
 * Lists pending wallet-top-up / coffee-pack charges whose Yoco webhook never
 * arrived (via listStuckCharges) and lets an admin manually activate each one
 * (via resolveStuckCharge). Idempotent server-side: resolving an
 * already-settled charge is a no-op. Lives on the Sync Conflicts page — the
 * home for "payment succeeded but the system didn't catch up" recovery.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listStuckCharges, resolveStuckCharge, type StuckChargeRow } from "@/server/actions/loyalty";
import { formatZar } from "@/lib/format";

const KIND_LABEL: Record<StuckChargeRow["kind"], string> = {
  wallet_topup: "Wallet top-up",
  coffee_pack: "Coffee pack",
};

export default function StuckChargesSection() {
  const [rows, setRows] = useState<StuckChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listStuckCharges();
    if (res.ok) setRows(res.data.rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = useCallback(async (id: string) => {
    setResolvingId(id);
    const res = await resolveStuckCharge(id).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not resolve charge.",
    }));
    setResolvingId(null);
    if (res.ok) {
      toast.success(res.data.status === "already_resolved" ? "Charge was already settled." : "Charge resolved.");
      setRows((prev) => prev.filter((r) => r.id !== id));
    } else {
      toast.error(res.message);
    }
  }, []);

  if (loading) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-muted">
        Stuck charges ({rows.length})
      </h2>
      <p className="mb-3 favo-small text-text-muted">
        Payments whose Yoco webhook never arrived (pending &gt; 5 min). Only resolve one after
        confirming the payment actually succeeded in Yoco — resolving credits the customer.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No stuck charges. All payments settled.</p>
      ) : (
        <div className="space-y-3" data-testid="stuck-list">
          {rows.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="favo-small font-semibold text-text">
                  {c.customerName} · {formatZar(c.amountZar)}
                </p>
                <p className="favo-caption text-text-muted truncate">
                  {KIND_LABEL[c.kind]} · {new Date(c.createdAt).toLocaleString("en-ZA")} · {c.yocoCheckoutId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => resolve(c.id)}
                disabled={resolvingId === c.id}
                className="shrink-0 rounded-[var(--radius-btn)] bg-crimson-carrot px-4 py-2 min-h-[40px] favo-small font-semibold text-porcelain transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
              >
                {resolvingId === c.id ? "Resolving…" : "Resolve"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
