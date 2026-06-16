"use client";

/**
 * OfflineBanner — task M19.
 *
 * Calm, full-width yellow banner shown at the top of the POS while the device
 * is offline:  "Working offline · {n} pending · Sync resumes when WAN returns."
 *
 * Dismissible per session (sessionStorage) so it doesn't nag once acknowledged —
 * but it reappears on the next offline transition (the dismiss is cleared when
 * the device comes back online). Connectivity is tracked internally; the queue
 * depth is passed in from useOfflineOutbox.
 */

import { useState, useEffect } from "react";
import { WifiOff, X } from "lucide-react";

const DISMISS_KEY = "favo-pos-offline-dismissed";

export type Props = {
  pendingCount: number;
};

export default function OfflineBanner({ pendingCount }: Props) {
  const [online, setOnline] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch { /* sessionStorage unavailable — treat as not dismissed */ }

    const goOnline = () => {
      setOnline(true);
      // Coming back online resets the dismiss so the next outage shows again.
      try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
      setDismissed(false);
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online || dismissed) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 flex items-center gap-2 px-4 py-2 border-b"
      style={{
        background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
        color: "var(--color-warning)",
        borderColor: "color-mix(in srgb, var(--color-warning) 35%, transparent)",
      }}
    >
      <WifiOff size={14} strokeWidth={2.25} aria-hidden className="shrink-0" />
      <p className="favo-small flex-1">
        Working offline
        {pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
        {" · "}Sync resumes when WAN returns.
      </p>
      <button type="button" onClick={dismiss} aria-label="Dismiss offline banner"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-btn)] hover:bg-coffee-bean/10">
        <X size={14} strokeWidth={2.25} />
      </button>
    </div>
  );
}
