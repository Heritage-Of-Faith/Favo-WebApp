"use client";
// Push notification opt-in — owner: Nikao (task N14, AT-66)
// Requests browser push permission, creates a PushSubscription,
// and POSTs it to /api/push/subscribe with the authenticated customerId.
// Only renders on browsers that support Push API.
// Persists a per-device "asked once" flag to avoid re-prompting on every visit.

import { useState, useEffect } from "react";

interface PushOptInProps {
  customerId: string;
}

type PermissionState = "default" | "granted" | "denied" | "unsupported";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// localStorage key tracks whether the user has been shown the prompt on this device.
// Value "granted" means we stored confirmation that push was once granted (detects revocation).
// Value "1" means asked but not yet granted.
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
    maxWidth: 480,
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
  btn: (disabled: boolean) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    backgroundColor: disabled ? "rgba(245,86,12,0.4)" : "var(--color-crimson-carrot)",
    color: "var(--color-paper)",
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

export default function PushOptIn({ customerId }: PushOptInProps) {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // true when user has been prompted before and dismissed without granting (hides the card).
  // Reset to false when permission is "granted" so we can detect subsequent revocation.
  const [hiddenByFlag, setHiddenByFlag] = useState(false);

  useEffect(() => {
    // Check truthiness so tests can simulate absence by setting window.Notification = undefined
    if (!window.Notification || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    const perm = window.Notification.permission as PermissionState;
    setPermission(perm);

    const stored = localStorage.getItem(askedKey(customerId));
    if (perm === "granted") {
      // Record that we once had grant — lets us detect future revocation.
      localStorage.setItem(askedKey(customerId), "granted");
    } else if (perm === "default") {
      // Hide if asked before, UNLESS permission was previously granted and then revoked.
      // Revocation: stored was "granted" but perm is now "default" → show again.
      if (stored === "1") setHiddenByFlag(true);
    }
  }, [customerId]);

  async function handleEnable() {
    // Always record "asked" on first click — even if VAPID isn't configured — so the card
    // doesn't re-appear on every visit after the user interacts with it once.
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
  // Hide after user has been prompted once and hasn't granted (dismissal without action).
  if (permission === "default" && hiddenByFlag) return null;

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
