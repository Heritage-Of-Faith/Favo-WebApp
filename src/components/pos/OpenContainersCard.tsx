"use client";

/**
 * OpenContainersCard — Phase 3 (container stock model).
 *
 * POS control for the physical milk & bean containers. Shows which bottle/bag is
 * currently open for each container item and lets the barista open the next one
 * or close the current one — all on the POS so making coffee never stalls.
 *
 * Cup tallies live in the admin page (per the owner's request); this card stays
 * deliberately minimal: which container is open + how many sealed remain.
 */

import { useState, useEffect, useCallback } from "react";
import { Milk, Package, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  listOpenContainers,
  openContainer,
  closeContainer,
  type OpenContainerView,
} from "@/server/actions/containers";

export default function OpenContainersCard() {
  const [rows, setRows] = useState<OpenContainerView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listOpenContainers();
    if (r.ok) setRows(r.data.containers);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleOpen(itemId: string) {
    setBusy(itemId);
    const r = await openContainer(itemId);
    setBusy(null);
    // Always resync with the server, success or failure — a CONFLICT here means
    // our local `rows` is stale (e.g. an earlier attempt on this device already
    // succeeded), so trust the server's view over whatever we're showing.
    load();
    if (r.ok) {
      toast.success("Container opened");
    } else {
      toast.error(r.message ?? "Could not open container.");
    }
  }

  async function handleClose(itemId: string, lotId: string) {
    setBusy(itemId);
    const r = await closeContainer(lotId);
    setBusy(null);
    load();
    if (r.ok) {
      toast.success("Container closed");
    } else {
      toast.error(r.message ?? "Could not close container.");
    }
  }

  if (!loaded || rows.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      {rows.map((row) => {
        const isMilk = row.inventoryItemName.toLowerCase().includes("milk");
        const Icon = isMilk ? Milk : Package;
        const isBusy = busy === row.inventoryItemId;
        const open = row.openLotId !== null;
        return (
          <div
            key={row.inventoryItemId}
            className="flex items-center gap-2 rounded-[2px] border border-cool-steel/20 bg-porcelain/5 px-2.5 py-1.5"
            title={`${row.inventoryItemName} — ${row.sealedCount} sealed`}
          >
            <Icon size={16} strokeWidth={2.25} className="text-cool-steel shrink-0" />
            <div className="min-w-0">
              <p
                className="text-coffee-bean font-semibold leading-tight truncate"
                style={{ fontSize: 12 }}
              >
                {open ? row.openLabel ?? "Open" : "None open"}
              </p>
              <p
                className="text-cool-steel leading-tight truncate"
                style={{ fontSize: 10 }}
              >
                {row.sealedCount} sealed
              </p>
            </div>
            {isBusy ? (
              <Loader2 size={14} className="animate-spin text-cool-steel" />
            ) : open ? (
              <button
                type="button"
                onClick={() => handleClose(row.inventoryItemId, row.openLotId!)}
                className="rounded-[var(--radius-btn)] border border-cool-steel/30 px-2 py-1 text-cool-steel hover:bg-porcelain/10 hover:text-porcelain focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
                style={{ fontSize: 10 }}
              >
                Close
              </button>
            ) : (
              <button
                type="button"
                disabled={row.sealedCount === 0}
                onClick={() => handleOpen(row.inventoryItemId)}
                className="rounded-[var(--radius-btn)] border border-cool-steel/30 px-2 py-1 text-cool-steel hover:bg-porcelain/10 hover:text-porcelain disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
                style={{ fontSize: 10 }}
              >
                Open
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
