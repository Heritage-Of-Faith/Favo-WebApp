"use client";
// Push notification opt-in — owner: Nikao (task N5)
// Requests browser push permission, creates a PushSubscription,
// and POSTs it to /api/push/subscribe with the customerId.
// Only renders on browsers that support Push API.

import { useState, useEffect } from "react";

interface PushOptInProps {
  customerId: string;
}

type PermissionState = "default" | "granted" | "denied" | "unsupported";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array(rawData.split("").map((c) => c.charCodeAt(0)));
}

const S = {
  wrap: {
    backgroundColor: "#054D61",
    color: "#F7F6F2",
    padding: "40px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
    maxWidth: 480,
  },
  eyebrow: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "#F5560C",
  },
  heading: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(1.5rem, 3vw, 2.5rem)",
    lineHeight: 1.0,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#F7F6F2",
    margin: 0,
  },
  body: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 15,
    lineHeight: 1.7,
    color: "#F7F6F2",
    opacity: 0.85,
  },
  btn: (disabled: boolean) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    backgroundColor: disabled ? "rgba(245,86,12,0.4)" : "#F5560C",
    color: "#FBFAF6",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    border: "none",
    padding: "14px 28px",
    borderRadius: 2,
    cursor: disabled ? "not-allowed" : "pointer",
  } as React.CSSProperties),
  statusEnabled: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 13,
    color: "#F7F6F2",
    opacity: 0.8,
  },
  dot: (on: boolean) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: on ? "#22c55e" : "#81A4B1",
    flexShrink: 0,
  } as React.CSSProperties),
} as const;

export default function PushOptIn({ customerId }: PushOptInProps) {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check truthiness so tests can simulate absence by setting window.Notification = undefined
    if (!window.Notification || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(window.Notification.permission as PermissionState);
  }, []);

  async function handleEnable() {
    if (!VAPID_KEY) {
      setError("Push not configured — NEXT_PUBLIC_VAPID_PUBLIC_KEY missing.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setPermission(result as PermissionState);
        setLoading(false);
        return;
      }
      setPermission("granted");

      // Phase 1: no service worker registered yet (SW ships in Phase 3).
      // getRegistration() returns undefined instead of hanging forever like .ready would.
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setError(
          "Notifications need the installed app — available when the FAVO app " +
          "is added to your home screen in Phase 3."
        );
        setLoading(false);
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, subscription: sub.toJSON() }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Subscribe failed: ${res.status} ${text}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPermission("default");
    } finally {
      setLoading(false);
    }
  }

  if (permission === "unsupported") return null;

  return (
    <div style={S.wrap}>
      <p style={S.eyebrow}>Order notifications</p>
      <h2 style={S.heading}>Know the moment<br />it&rsquo;s ready</h2>
      <p style={S.body}>
        When the barista marks your order ready, you&rsquo;ll get a push
        notification on this device — no need to watch the queue.
      </p>

      {permission === "granted" ? (
        <div style={S.statusEnabled}>
          <span style={S.dot(true)} />
          Notifications enabled on this device
        </div>
      ) : permission === "denied" ? (
        <div style={S.statusEnabled}>
          <span style={S.dot(false)} />
          Notifications blocked — allow them in your browser settings to enable
        </div>
      ) : (
        <button
          style={S.btn(loading)}
          onClick={handleEnable}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? "Enabling…" : "Enable notifications"}
        </button>
      )}

      {error && (
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: "var(--color-crimson-carrot)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
