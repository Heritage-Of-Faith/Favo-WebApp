"use client";

/**
 * staff-subscribe — task M10.
 * Browser-side helper: requests notification permission, creates a
 * PushSubscription via the service worker, and persists it through the
 * subscribeStaffPush server action.
 */

import { subscribeStaffPush } from "@/server/actions/staff-push";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return new Uint8Array(raw.split("").map((c) => c.charCodeAt(0)));
}

export type StaffSubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "denied" | "no-sw" | "not-configured" | "error"; message: string };

export async function enableStaffPush(): Promise<StaffSubscribeResult> {
  if (!VAPID_KEY) {
    return { ok: false, reason: "not-configured", message: "Push not configured (NEXT_PUBLIC_VAPID_PUBLIC_KEY missing)." };
  }
  if (typeof window === "undefined" || !window.Notification || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "unsupported", message: "This device doesn't support push notifications." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "denied", message: "Notifications were not enabled." };
  }

  // Service worker ships in Phase 3; getRegistration() returns undefined
  // instead of hanging like .ready would.
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    return { ok: false, reason: "no-sw", message: "Notifications will activate once the app is installed." };
  }

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    });
    const res = await subscribeStaffPush(sub.toJSON());
    if (!res.ok) return { ok: false, reason: "error", message: res.message };
    return { ok: true };
  } catch {
    return { ok: false, reason: "error", message: "Could not register for notifications." };
  }
}
