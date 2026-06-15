"use client";

// Offline order outbox — queues orders in IndexedDB when offline and replays
// them against /api/sync/orders the moment the connection returns.
// Exposes: queueOrder (write), sync (replay all), syncOne (replay one),
// pendingOrders (queued list for this staff), pendingCount, syncing, refresh.
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

/** Replay a single queued order. Returns the server outcome for the caller. */
type SyncOutcome = "applied" | "duplicate" | "conflict" | "retry";

export function useOfflineOutbox(currentStaffId: string) {
  // Newest-last list of this staff member's queued orders.
  const [pendingOrders, setPendingOrders] = useState<OfflineOrder[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const myOrders = useCallback(
    async () =>
      (await getAllOrders())
        .filter((o) => o.staffId === currentStaffId)
        .sort((a, b) => a.clientTimestamp.localeCompare(b.clientTimestamp)),
    [currentStaffId]
  );

  /** Reload the queued-orders list for this staff member from IndexedDB. */
  const refresh = useCallback(async () => {
    try {
      setPendingOrders(await myOrders());
    } catch {
      /* IndexedDB unavailable — leave the last-known list in place. */
    }
  }, [myOrders]);

  // Read the queue for this staff member on mount.
  useEffect(() => {
    refresh();
  }, [refresh]);

  /** POST one order; translate the HTTP result into a SyncOutcome. */
  const postOne = useCallback(async (order: OfflineOrder): Promise<SyncOutcome> => {
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
          return data.outcome;
        }
        return "retry";
      }
      if (res.status === 409) {
        // Conflict — remove from outbox so it doesn't retry forever; the server
        // has written a sync_conflicts row for admin review (A18).
        await deleteOrder(order.clientUuid);
        return "conflict";
      }
      // 401/403/5xx — leave in outbox; try again on next online event.
      return "retry";
    } catch {
      // Still unreliable — leave in outbox.
      return "retry";
    }
  }, []);

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
        const outcome = await postOne(order);
        if (outcome === "applied" || outcome === "duplicate") applied++;
        else if (outcome === "conflict") conflicts++;
      }

      await refresh();
      if (applied > 0) {
        toast.success(`${applied} offline order${applied > 1 ? "s" : ""} synced`);
      }
      if (conflicts > 0) {
        toast.warning(
          `${conflicts} order${conflicts > 1 ? "s" : ""} flagged for admin review`
        );
      }
    } catch {
      // IndexedDB or unexpected error — will retry on next online event
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [myOrders, postOne, refresh]);

  /** Retry one queued order (per-item button in the sync drawer). */
  const syncOne = useCallback(
    async (clientUuid: string) => {
      const order = (await myOrders()).find((o) => o.clientUuid === clientUuid);
      if (!order) return;
      const outcome = await postOne(order);
      await refresh();
      if (outcome === "applied" || outcome === "duplicate") toast.success("Order synced");
      else if (outcome === "conflict") toast.warning("Order flagged for admin review");
      else toast.error("Still can't reach the server — will retry automatically.");
    },
    [myOrders, postOne, refresh]
  );

  // Trigger sync automatically whenever the device reconnects.
  useEffect(() => {
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [sync]);

  const queueOrder = useCallback(
    async (order: OfflineOrder) => {
      await putOrder(order);
      await refresh();
    },
    [refresh]
  );

  return {
    pendingOrders,
    pendingCount: pendingOrders.length,
    syncing,
    queueOrder,
    sync,
    syncOne,
    refresh,
  };
}
