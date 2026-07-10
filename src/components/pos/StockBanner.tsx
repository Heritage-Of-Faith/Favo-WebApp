"use client";

/**
 * StockBanner — task M9.
 * Top-of-workspace banner listing inventory items currently out of stock.
 * Dismissible per session; re-appears if the out-of-stock set changes.
 */

import { useState, useEffect } from "react";
import { AlertCircle, X } from "lucide-react";

export type Props = { outOfStockItems: string[] };

export default function StockBanner({ outOfStockItems }: Props) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  // Key the dismissal to the exact OOS set so a new outage re-shows the banner.
  const key = outOfStockItems.slice().sort().join("|");

  useEffect(() => {
    // If the set changes, clear a stale dismissal.
    if (dismissedKey !== null && dismissedKey !== key) setDismissedKey(null);
  }, [key, dismissedKey]);

  if (outOfStockItems.length === 0 || dismissedKey === key) return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-4 py-2"
    >
      <AlertCircle size={14} strokeWidth={2} className="text-[var(--color-error)] shrink-0" />
      <span className="favo-small text-coffee-bean flex-1">
        Out of stock: <strong>{outOfStockItems.join(", ")}</strong>
      </span>
      <button
        type="button"
        onClick={() => setDismissedKey(key)}
        aria-label="Dismiss"
        className="flex h-11 w-11 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}
