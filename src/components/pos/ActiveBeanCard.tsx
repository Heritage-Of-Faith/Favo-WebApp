"use client";

/**
 * ActiveBeanCard — task M11.
 *
 * Small POS top-bar tile showing the currently-active espresso bean lot:
 * origin, batch number, and days since roast. A freshness warning (N8)
 * fires when the lot passes its peak (>14 days post-roast, T02).
 *
 * FAVO is specialty-coffee-focused — the barista should always know which
 * beans are in the hopper. Refreshes on demand (e.g. after lot promotion).
 */

import { useState, useEffect, useCallback } from "react";
import { Coffee } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";
import { getActiveBeanLot } from "@/server/actions/inventory";
import { freshness, daysSinceRoast, freshnessLabel } from "@/lib/status/freshness";
import { freshnessVariant } from "@/components/shared/StatusBadge";
import type { InventoryLot } from "@/lib/types";

export type Props = {
  /** Bump this to force a refresh (e.g. after a lot promotion). */
  refreshKey?: number;
};

export default function ActiveBeanCard({ refreshKey = 0 }: Props) {
  const [lot, setLot] = useState<InventoryLot | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await getActiveBeanLot();
    if (r.ok) setLot(r.data.lot);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Nothing to show until we have a lot
  if (!loaded || !lot) return null;

  const roast = lot.roastDate;
  const fresh = roast ? freshness(roast) : null;
  const days = roast ? daysSinceRoast(roast) : null;
  const origin = lot.origin ?? lot.sourceName ?? "Espresso";
  const batch = lot.batchNumber;

  return (
    <div
      className="flex items-center gap-2 rounded-[2px] border border-cool-steel/20 bg-porcelain/5 px-2.5 py-1.5"
      title="Active espresso bean lot"
    >
      <Coffee size={16} strokeWidth={2.25} className="text-cool-steel shrink-0" />
      <div className="min-w-0">
        <p className="text-porcelain font-semibold leading-tight truncate" style={{ fontSize: 12 }}>
          {origin}
        </p>
        <p className="text-cool-steel leading-tight truncate" style={{ fontSize: 10 }}>
          {batch ? `${batch} · ` : ""}
          {days !== null ? `${days}d post-roast` : "roast date n/a"}
        </p>
      </div>
      {fresh && fresh !== "fresh" && (
        <StatusBadge variant={freshnessVariant(fresh)} dot={false}>
          {freshnessLabel(fresh)}
        </StatusBadge>
      )}
    </div>
  );
}
