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

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array(rawData.split("").map((c) => c.charCodeAt(0)));
}

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
        // Reuse the existing subscription if present; subscribe() creates one otherwise.
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
          }));
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
