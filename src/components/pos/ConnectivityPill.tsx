"use client";

/**
 * ConnectivityPill — task M15.
 *
 * One-glance connectivity + queue state for the POS top bar, using the N8
 * colour bands:
 *   green  = online, queue empty   (all good)
 *   yellow = online, orders queued (syncing / pending)
 *   red    = offline               (working offline)
 *
 * Tapping opens the SyncDrawer. Tracks online state internally so callers only
 * need to pass the queue depth + syncing flag from useOfflineOutbox.
 */

import { useState, useEffect } from "react";
import { Wifi, WifiOff, RefreshCw, Loader2 } from "lucide-react";

export type Props = {
  pendingCount: number;
  syncing: boolean;
  onClick: () => void;
};

type Band = "online" | "queued" | "offline";

const BAND_STYLE: Record<Band, { color: string; bg: string; border: string }> = {
  online:  { color: "var(--color-success)", bg: "color-mix(in srgb, var(--color-success) 14%, transparent)", border: "color-mix(in srgb, var(--color-success) 40%, transparent)" },
  queued:  { color: "var(--color-warning)", bg: "color-mix(in srgb, var(--color-warning) 16%, transparent)", border: "color-mix(in srgb, var(--color-warning) 45%, transparent)" },
  offline: { color: "var(--color-error)",   bg: "color-mix(in srgb, var(--color-error) 14%, transparent)",   border: "color-mix(in srgb, var(--color-error) 45%, transparent)" },
};

export default function ConnectivityPill({ pendingCount, syncing, onClick }: Props) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const band: Band = !online ? "offline" : pendingCount > 0 ? "queued" : "online";
  const s = BAND_STYLE[band];

  const label = !online
    ? `Offline${pendingCount > 0 ? ` · ${pendingCount} queued` : ""}`
    : syncing
      ? "Syncing…"
      : pendingCount > 0
        ? `${pendingCount} queued`
        : "Online";

  const Icon = !online ? WifiOff : syncing ? Loader2 : pendingCount > 0 ? RefreshCw : Wifi;

  return (
    <button
      type="button"
      onClick={onClick}
      role="status"
      aria-live="polite"
      aria-label={`Connectivity: ${label}. Open sync panel.`}
      data-band={band}
      className="shrink-0 flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 favo-caption min-h-[32px] transition-all hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
      style={{ color: s.color, background: s.bg, borderColor: s.border }}
    >
      <Icon size={12} strokeWidth={2.5} className={syncing ? "animate-spin" : undefined} aria-hidden />
      <span>{label}</span>
    </button>
  );
}
