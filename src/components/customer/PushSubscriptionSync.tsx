"use client";
// Silent push subscription sync — owner: Nikao (task N5)
// Runs in the customer layout on every page load.
// If the customer has already granted push permission, silently ensures their
// subscription is registered with the server (handles subscription rotation
// after browser updates, cleared storage, etc.).
// No UI — progressive enhancement only.

import { useEffect } from "react";

interface PushSubscriptionSyncProps {
  customerId: string;
}

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export default function PushSubscriptionSync({ customerId }: PushSubscriptionSyncProps) {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !VAPID_KEY ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    // Fire-and-forget — failure is silent; user can re-enable via the dashboard prompt.
    async function sync() {
      try {
        // getRegistration() returns immediately (undefined if SW not yet active).
        // serviceWorker.ready hangs indefinitely before first activation — avoid it.
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        // Only sync an existing browser subscription — never silently re-subscribe,
        // which would undo an explicit user opt-out.
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId, subscription: sub.toJSON() }),
        });
      } catch {
        // Silent — push sync is best-effort.
      }
    }

    sync();
  }, [customerId]);

  return null;
}
