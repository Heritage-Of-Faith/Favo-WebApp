"use client";

// Online/offline indicator — owner: Mine (M7)
// Uses navigator.onLine + online/offline events. Mounts as a small sticky chip.

import { useState, useEffect } from "react";
import { Wifi, WifiOff } from "lucide-react";

export default function OnlineIndicator() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Read current state on mount (SSR-safe — navigator not available server-side)
    setOnline(navigator.onLine);

    const handleOnline  = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (online) return null; // Don't show anything when online — no visual noise

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label="You are offline"
      className={[
        "fixed bottom-[var(--spacing-m)] left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-[var(--spacing-s)]",
        "rounded-[var(--radius-pill)] border border-[var(--color-error)]/40",
        "bg-coffee-bean px-[var(--spacing-m)] py-[var(--spacing-s)]",
        "shadow-[var(--shadow-2)]",
      ].join(" ")}
    >
      <WifiOff size={14} strokeWidth={2.25} className="text-[var(--color-error)]" />
      <span className="favo-small text-porcelain">You're offline</span>
    </div>
  );
}

// Export a compact inline variant for use inside headers/toolbars
export function OnlineIndicatorInline() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  return (
    <span
      role="status"
      aria-label={online ? "Online" : "Offline"}
      className="flex items-center gap-1"
    >
      {online
        ? <Wifi    size={12} strokeWidth={2.25} className="text-[var(--color-success)]" />
        : <WifiOff size={12} strokeWidth={2.25} className="text-[var(--color-error)]" />
      }
      <span className={`favo-caption ${online ? "text-[var(--color-success)]" : "text-[var(--color-error)]"}`}>
        {online ? "Online" : "Offline"}
      </span>
    </span>
  );
}
