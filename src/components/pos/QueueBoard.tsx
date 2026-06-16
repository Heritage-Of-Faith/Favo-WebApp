"use client";

// Live POS queue board — owner: Mine (M5)
// SSE consumer via useOrderStream hook. Shows live order cards by state.
// Docs: docs/API.md → QueueEvent · docs/DESIGN.md → POS Rules

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Wifi, WifiOff, Loader2, RefreshCw, Coffee, LogOut } from "lucide-react";
import { useOrderStream } from "@/hooks/useOrderStream";
import { formatDate } from "@/lib/format";
import { signOut } from "@/server/actions/auth";
import type { OrderState } from "@/lib/types";

const STATE_LABEL: Record<OrderState, string> = {
  ordered:     "Waiting",
  in_progress: "In Progress",
  ready:       "Ready",
  collected:   "Collected",
  cancelled:   "Cancelled",
};

const STATE_COLOURS: Record<OrderState, string> = {
  ordered:     "border-cool-steel/40 bg-porcelain/5",
  in_progress: "border-[var(--color-warning)]/60 bg-[var(--color-warning)]/10",
  ready:       "border-[var(--color-success)]/60 bg-[var(--color-success)]/10",
  collected:   "border-cool-steel/20 bg-transparent opacity-50",
  cancelled:   "border-[var(--color-error)]/30 bg-transparent opacity-40",
};

const STATE_DOT: Record<OrderState, string> = {
  ordered:     "bg-cool-steel",
  in_progress: "bg-[var(--color-warning)] animate-pulse",
  ready:       "bg-[var(--color-success)]",
  collected:   "bg-cool-steel/40",
  cancelled:   "bg-[var(--color-error)]/40",
};

export default function QueueBoard() {
  const router = useRouter();
  const { activeOrders, status } = useOrderStream();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    await signOut();
    router.push("/pos");
  }, [router]);

  return (
    <div className="flex h-full flex-col gap-[var(--spacing-m)]">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <h1 className="favo-h3 text-porcelain">Queue</h1>
        <div className="flex items-center gap-[var(--spacing-s)]">
          <StatusChip status={status} />
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            className={[
              "flex items-center justify-center rounded-[var(--radius-btn)]",
              "h-7 w-7 text-cool-steel",
              "transition-colors hover:bg-porcelain/10 hover:text-porcelain",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            ].join(" ")}
          >
            <LogOut size={15} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      {/* Empty state */}
      {activeOrders.length === 0 && status === "connected" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-[var(--spacing-m)] text-cool-steel">
          <Coffee size={40} strokeWidth={1.5} className="opacity-40" />
          <p className="favo-small text-center">No active orders — queue is clear.</p>
        </div>
      )}

      {/* Connecting / reconnecting placeholder */}
      {activeOrders.length === 0 && status !== "connected" && (
        <div className="flex flex-1 items-center justify-center text-cool-steel">
          <Loader2 size={20} strokeWidth={2.25} className="animate-spin mr-[var(--spacing-s)]" />
          <span className="favo-small">Connecting to queue…</span>
        </div>
      )}

      {/* Order cards */}
      {activeOrders.length > 0 && (
        <ul className="flex-1 overflow-y-auto space-y-[var(--spacing-s)]">
          {activeOrders
            .sort((a, b) => a.lastUpdatedAt.localeCompare(b.lastUpdatedAt))
            .map((order) => (
              <li key={order.orderId}>
                <button
                  type="button"
                  onClick={() => router.push(`/pos/order/${order.orderId}`)}
                  className={[
                    "flex w-full items-center justify-between rounded-[var(--radius-card)] border",
                    "px-[var(--spacing-m)] py-[var(--spacing-m)] min-h-[64px]",
                    "text-left transition-all duration-[var(--dur-fast)]",
                    "hover:brightness-110 active:scale-[0.99]",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot",
                    STATE_COLOURS[order.state],
                  ].join(" ")}
                  aria-label={`Order ${order.orderId.slice(-6).toUpperCase()} — ${STATE_LABEL[order.state]}`}
                >
                  <div className="flex items-center gap-[var(--spacing-m)]">
                    {/* State dot */}
                    <span className={`block h-2.5 w-2.5 rounded-full shrink-0 ${STATE_DOT[order.state]}`} />
                    <div>
                      <p className="favo-subhead text-porcelain leading-tight">
                        #{order.orderId.slice(-6).toUpperCase()}
                      </p>
                      <p className="favo-small text-cool-steel">
                        {formatDate(new Date(order.lastUpdatedAt))}
                      </p>
                    </div>
                  </div>
                  <span className={[
                    "favo-caption rounded-[var(--radius-pill)] px-[var(--spacing-s)] py-px",
                    order.state === "ready"
                      ? "bg-[var(--color-success)]/20 text-[var(--color-success)]"
                      : order.state === "in_progress"
                      ? "bg-[var(--color-warning)]/20 text-[var(--color-warning)]"
                      : "bg-porcelain/10 text-cool-steel",
                  ].join(" ")}>
                    {STATE_LABEL[order.state]}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

// ── Status chip ───────────────────────────────────────────────────────────────
function StatusChip({ status }: { status: ReturnType<typeof useOrderStream>["status"] }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--color-success)]/10 px-[var(--spacing-s)] py-px">
        <Wifi size={12} strokeWidth={2.25} className="text-[var(--color-success)]" />
        <span className="favo-caption text-[var(--color-success)]">Live</span>
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--color-error)]/10 px-[var(--spacing-s)] py-px">
        <WifiOff size={12} strokeWidth={2.25} className="text-[var(--color-error)]" />
        <span className="favo-caption text-[var(--color-error)]">Offline</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-porcelain/10 px-[var(--spacing-s)] py-px">
      <RefreshCw size={12} strokeWidth={2.25} className="text-cool-steel animate-spin" />
      <span className="favo-caption text-cool-steel">Reconnecting</span>
    </span>
  );
}
