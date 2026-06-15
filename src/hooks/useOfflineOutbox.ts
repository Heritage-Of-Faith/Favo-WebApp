"use client";

// Offline order outbox — queues orders in IndexedDB when offline and replays
// them against /api/sync/orders the moment the connection returns.
// Exposes: queueOrder (write), sync (manual trigger), pendingCount, syncing.
//
// currentStaffId scopes all reads/writes to the active session.
// On shared POS devices, orders belonging to other staff members are left
// untouched — they would generate a permanent 403 (staffId mismatch) if replayed
// under the current session.

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  putOrder,
  getAllOrders,
  deleteOrder,
  type OfflineOrder,
} from "@/lib/offline/outbox-db";

export type { OfflineOrder };

export function useOfflineOutbox(currentStaffId: string) {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const myOrders = useCallback(
    async () => (await getAllOrders()).filter((o) => o.staffId === currentStaffId),
    [currentStaffId]
  );

  // Read queue depth for this staff member on mount.
  useEffect(() => {
    myOrders().then((orders) => setPendingCount(orders.length)).catch(() => {});
  }, [myOrders]);

  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);

    try {
      const pending = await myOrders();
      if (pending.length === 0) return;

      let applied = 0;
      let conflicts = 0;

      for (const order of pending) {
        try {
          const res = await fetch("/api/sync/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(order),
          });

          if (res.ok) {
            const data = (await res.json()) as { outcome: string };
            if (data.outcome === "applied" || data.outcome === "duplicate") {
              await deleteOrder(order.clientUuid);
              applied++;
            }
          } else if (res.status === 409) {
            // Conflict — remove from outbox so it doesn't retry forever.
            // Server has written a sync_conflicts row for admin review.
            await deleteOrder(order.clientUuid);
            conflicts++;
          }
          // 401/403/5xx — leave in outbox; try again on next online event.
        } catch {
          // Still unreliable — leave in outbox.
        }
      }

      const remaining = await myOrders();
      setPendingCount(remaining.length);

      if (applied > 0) {
        toast.success(`${applied} offline order${applied > 1 ? "s" : ""} synced`);
      }
      if (conflicts > 0) {
        toast.warning(
          `${conflicts} order${conflicts > 1 ? "s" : ""} flagged for admin review`
        );
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [myOrders]);

  // Trigger sync automatically whenever the device reconnects.
  useEffect(() => {
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [sync]);

  const queueOrder = useCallback(
    async (order: OfflineOrder) => {
      await putOrder(order);
      setPendingCount((c) => c + 1);
    },
    []
  );

  return { pendingCount, syncing, queueOrder, sync };
}
