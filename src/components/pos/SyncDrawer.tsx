"use client";

/**
 * SyncDrawer — task M15.
 *
 * Side drawer listing this staff member's queued offline orders in
 * chronological order (oldest first), each with its captured timestamp, total,
 * item count, and a per-item retry button. A "Sync now" CTA replays the whole
 * queue. Driven entirely by useOfflineOutbox state passed in by the parent.
 */

import { X, RefreshCw, Loader2, CloudOff, CheckCircle } from "lucide-react";
import { formatZar, formatDate } from "@/lib/format";
import type { OfflineOrder } from "@/hooks/useOfflineOutbox";

export type Props = {
  open: boolean;
  orders: OfflineOrder[];
  syncing: boolean;
  onSyncAll: () => void;
  onRetry: (clientUuid: string) => void;
  onClose: () => void;
};

function itemCount(o: OfflineOrder): number {
  return o.items.reduce((n, i) => n + i.quantity, 0);
}

export default function SyncDrawer({ open, orders, syncing, onSyncAll, onRetry, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Offline sync queue">
      {/* Scrim */}
      <div className="absolute inset-0 bg-coffee-bean/50" onClick={onClose} aria-hidden />

      <div className="relative flex h-full w-full max-w-[380px] flex-col bg-dark-teal shadow-[var(--shadow-2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-5 py-3 shrink-0">
          <h2 className="favo-h3 text-porcelain">Sync queue</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain">
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CheckCircle size={36} strokeWidth={1.75} className="text-[var(--color-success)]" />
              <p className="favo-small text-cool-steel">Nothing queued — everything is synced.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {orders.map((o) => (
                <li key={o.clientUuid}
                  className="flex items-center gap-3 rounded-[var(--radius-btn)] border border-cool-steel/20 bg-porcelain/5 px-3 py-2.5">
                  <CloudOff size={16} strokeWidth={2} className="text-[var(--color-warning)] shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="favo-small text-porcelain">
                      {itemCount(o)} item{itemCount(o) === 1 ? "" : "s"} · {formatZar(o.clientTotalZar)}
                    </p>
                    <p className="favo-caption text-cool-steel truncate">
                      {formatDate(new Date(o.clientTimestamp))} · {o.paymentMode.replace("_", " ")}
                    </p>
                  </div>
                  <button type="button" onClick={() => onRetry(o.clientUuid)} disabled={syncing}
                    aria-label="Retry this order"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-cool-steel hover:bg-porcelain/10 hover:text-porcelain disabled:opacity-40">
                    <RefreshCw size={14} strokeWidth={2.25} className={syncing ? "animate-spin" : undefined} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer CTA */}
        {orders.length > 0 && (
          <div className="border-t border-cool-steel/20 px-5 py-4 shrink-0">
            <button type="button" onClick={onSyncAll} disabled={syncing}
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-crimson-carrot py-3 min-h-[48px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
              style={{ color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
              {syncing
                ? <><Loader2 size={16} strokeWidth={2.25} className="animate-spin" /> Syncing…</>
                : <><RefreshCw size={16} strokeWidth={2.25} /> Sync now ({orders.length})</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
