"use client";

// Notification enable/disable toggle for the settings page.
// Unlike PushOptIn (which hides after dismissal), this is always visible
// so the customer can manage their preference at any time.

import { useState, useEffect } from "react";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return new Uint8Array(raw.split("").map((c) => c.charCodeAt(0)));
}

function askedKey(id: string) {
  return `favo_push_asked_${id}`;
}

export type Props = {
  customerId: string;
  serverHasSubscription: boolean;
};

type PermissionState = "default" | "granted" | "denied" | "unsupported";

export default function NotificationToggle({ customerId, serverHasSubscription }: Props) {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [dbHasSub, setDbHasSub] = useState(serverHasSubscription);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(window.Notification.permission as PermissionState);
  }, []);

  async function handleEnable() {
    if (!VAPID_KEY) {
      setError("Push notifications are not configured on this device.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
      if (result !== "granted") return;
      localStorage.setItem(askedKey(customerId), "granted");

      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) reg = await navigator.serviceWorker.register("/sw.js");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error(`Failed to save subscription (${res.status})`);
      setDbHasSub(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      const res = await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      if (!res.ok) throw new Error("Failed to disable notifications.");
      setDbHasSub(false);
      localStorage.removeItem(askedKey(customerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const fullyEnabled = permission === "granted" && dbHasSub;

  return (
    <div style={{
      backgroundColor: "var(--color-dark-teal)",
      padding: "28px 32px",
      display: "flex",
      flexDirection: "column",
      gap: 16,
    }}>
      <p style={{
        fontFamily: "'DM Sans', sans-serif",
        fontWeight: 300,
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase" as const,
        color: "var(--color-crimson-carrot)",
        margin: 0,
      }}>
        Order notifications
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" as const }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 8, height: 8,
            borderRadius: "50%",
            backgroundColor: fullyEnabled ? "var(--color-crimson-carrot)" : "rgba(247,246,242,0.25)",
            flexShrink: 0,
            display: "block",
          }} />
          <span style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 500,
            fontSize: 14,
            color: "var(--color-porcelain)",
          }}>
            {permission === "unsupported"
              ? "Not supported on this device"
              : permission === "denied"
                ? "Blocked in browser settings"
                : fullyEnabled
                  ? "Enabled on this device"
                  : "Not enabled"}
          </span>
        </div>

        {permission !== "unsupported" && permission !== "denied" && (
          <button
            onClick={fullyEnabled ? handleDisable : handleEnable}
            disabled={loading}
            aria-busy={loading}
            style={{
              backgroundColor: fullyEnabled ? "transparent" : "var(--color-crimson-carrot)",
              color: fullyEnabled ? "rgba(247,246,242,0.6)" : "var(--color-porcelain)",
              border: fullyEnabled ? "1px solid rgba(247,246,242,0.2)" : "none",
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase" as const,
              padding: "10px 20px",
              borderRadius: 2,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              flexShrink: 0,
              minHeight: 40,
            }}
          >
            {loading ? "…" : fullyEnabled ? "Disable" : "Enable"}
          </button>
        )}
      </div>

      {permission === "denied" && (
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          color: "rgba(247,246,242,0.55)",
          margin: 0,
          lineHeight: 1.6,
        }}>
          To enable, allow notifications for this site in your browser or device settings.
        </p>
      )}

      {error && (
        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 13,
          color: "var(--color-crimson-carrot)",
          margin: 0,
        }}>
          {error}
        </p>
      )}
    </div>
  );
}
