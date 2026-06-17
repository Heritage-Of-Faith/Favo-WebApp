"use client";
// Push notification opt-in / management — owner: Nikao (task N14, AT-66)
// Accurate enabled state: checks both browser permission AND DB subscription.
// Supports enable, disable, and sync-recovery (permission granted but DB missing).

import { useState, useEffect } from "react";

interface PushOptInProps {
  customerId: string;
  /** Whether the server currently has a push subscription saved for this customer. */
  serverHasSubscription: boolean;
}

type PermissionState = "default" | "granted" | "denied" | "unsupported";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function askedKey(customerId: string) {
  return `favo_push_asked_${customerId}`;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array(rawData.split("").map((c) => c.charCodeAt(0)));
}

const S = {
  wrap: {
    backgroundColor: "var(--color-dark-teal)",
    color: "var(--color-porcelain)",
    padding: "40px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
  },
  eyebrow: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
  },
  heading: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(1.5rem, 3vw, 2.5rem)",
    lineHeight: 1.0,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    margin: 0,
  },
  body: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 15,
    lineHeight: 1.7,
    color: "var(--color-porcelain)",
    opacity: 0.85,
  },
  btn: (disabled: boolean, variant: "primary" | "ghost" = "primary") => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    backgroundColor:
      variant === "ghost"
        ? "transparent"
        : disabled
          ? "rgba(245,86,12,0.4)"
          : "var(--color-crimson-carrot)",
    color: variant === "ghost" ? "var(--color-cool-steel)" : "var(--color-paper)",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    border: variant === "ghost" ? "1px solid rgba(160,172,180,0.3)" : "none",
    padding: "14px 28px",
    borderRadius: 2,
    cursor: disabled ? "not-allowed" : "pointer",
  } as React.CSSProperties),
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
  },
  statusLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 13,
    color: "var(--color-porcelain)",
    opacity: 0.8,
  },
  dot: (on: boolean) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: on ? "var(--color-success)" : "var(--color-cool-steel)",
    flexShrink: 0,
  } as React.CSSProperties),
} as const;

export default function PushOptIn({ customerId, serverHasSubscription }: PushOptInProps) {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [dbHasSub, setDbHasSub] = useState(serverHasSubscription);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiddenByFlag, setHiddenByFlag] = useState(false);

  useEffect(() => {
    if (!window.Notification || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    const perm = window.Notification.permission as PermissionState;
    setPermission(perm);

    const stored = localStorage.getItem(askedKey(customerId));
    if (perm === "granted") {
      localStorage.setItem(askedKey(customerId), "granted");
    } else if (perm === "default") {
      if (stored === "1") setHiddenByFlag(true);
    }
  }, [customerId]);

  async function handleEnable() {
    localStorage.setItem(askedKey(customerId), "1");
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
      localStorage.setItem(askedKey(customerId), "granted");

      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setError("Notifications require the app to be installed. Add FAVO to your home screen, then try again.");
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
      setDbHasSub(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPermission("default");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    setLoading(true);
    setError(null);
    try {
      // Unsubscribe from browser push manager first.
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      // Clear from DB.
      const res = await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      if (!res.ok) throw new Error("Failed to disable notifications.");
      setDbHasSub(false);
      localStorage.removeItem(askedKey(customerId));
      // Note: browser Notification.permission stays "granted" at OS level —
      // the user can re-enable without another OS prompt.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  if (permission === "unsupported") return null;
  if (permission === "default" && hiddenByFlag) return null;

  // Fully enabled: browser permission granted AND subscription saved in DB.
  const fullyEnabled = permission === "granted" && dbHasSub;
  // Partial: permission granted but DB subscription missing — needs re-sync.
  const needsSync = permission === "granted" && !dbHasSub;

  return (
    <div style={S.wrap}>
      <p style={S.eyebrow}>Order notifications</p>
      <h2 style={S.heading}>Know the moment<br />it&rsquo;s ready</h2>
      <p style={S.body}>
        When the barista marks your order ready, you&rsquo;ll get a
        notification on this device — no need to watch the queue.
      </p>

      {fullyEnabled ? (
        <div style={S.statusRow}>
          <span style={S.statusLabel}>
            <span style={S.dot(true)} />
            Notifications enabled
          </span>
          <button
            style={S.btn(loading, "ghost")}
            onClick={handleDisable}
            disabled={loading}
          >
            {loading ? "Disabling…" : "Disable"}
          </button>
        </div>
      ) : needsSync ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={S.statusLabel}>
            <span style={S.dot(false)} />
            Permission granted — tap to finish registering
          </span>
          <button style={S.btn(loading)} onClick={handleEnable} disabled={loading}>
            {loading ? "Registering…" : "Register device"}
          </button>
        </div>
      ) : permission === "denied" ? (
        <span style={S.statusLabel}>
          <span style={S.dot(false)} />
          Notifications blocked — allow them in your browser settings to enable
        </span>
      ) : (
        <button style={S.btn(loading)} onClick={handleEnable} disabled={loading} aria-busy={loading}>
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
