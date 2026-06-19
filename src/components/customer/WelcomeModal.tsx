"use client";

// First-login push notification prompt — shown once after signup/login.
// Uses the same favo_push_asked_<id> localStorage key as PushOptIn so both
// components stay in sync: after the modal fires, PushOptIn won't re-prompt.

import { useState, useEffect } from "react";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function askedKey(id: string) {
  return `favo_push_asked_${id}`;
}

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return new Uint8Array(raw.split("").map((c) => c.charCodeAt(0)));
}

export type Props = {
  customerId: string;
  firstName: string;
};

export default function WelcomeModal({ customerId, firstName }: Props) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(askedKey(customerId))) return;
    setVisible(true);
  }, [customerId]);

  function dismiss() {
    localStorage.setItem(askedKey(customerId), "1");
    setVisible(false);
  }

  async function handleEnable() {
    if (!VAPID_KEY) { dismiss(); return; }
    setLoading(true);
    try {
      const result = await Notification.requestPermission();
      if (result !== "granted") { dismiss(); return; }
      localStorage.setItem(askedKey(customerId), "granted");

      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) reg = await navigator.serviceWorker.register("/sw.js");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, subscription: sub.toJSON() }),
      });
      setSuccess(true);
      setTimeout(() => setVisible(false), 1800);
    } catch {
      dismiss();
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(15,3,1,0.72)",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      zIndex: 50,
      padding: 0,
    }}>
      <div style={{
        backgroundColor: "var(--color-dark-teal)",
        width: "100%",
        maxWidth: 480,
        padding: "40px 40px calc(40px + env(safe-area-inset-bottom, 0px))",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>
        {success ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 300,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              color: "var(--color-crimson-carrot)",
            }}>
              You&rsquo;re set
            </span>
            <p style={{
              fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
              fontWeight: 900,
              fontSize: "clamp(1.8rem, 6vw, 2.8rem)",
              lineHeight: 1,
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
              color: "var(--color-porcelain)",
              margin: 0,
            }}>
              We&rsquo;ll let you know.
            </p>
          </div>
        ) : (
          <>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 300,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              color: "var(--color-crimson-carrot)",
              margin: 0,
            }}>
              Hey, {firstName}
            </p>
            <h2 style={{
              fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
              fontWeight: 900,
              fontSize: "clamp(2.4rem, 9vw, 3.8rem)",
              lineHeight: 0.95,
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
              color: "var(--color-porcelain)",
              margin: 0,
            }}>
              Know the<br />moment<br />it&rsquo;s ready
            </h2>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 400,
              fontSize: 15,
              lineHeight: 1.7,
              color: "var(--color-porcelain)",
              opacity: 0.85,
              margin: 0,
            }}>
              When the barista marks your order done, we&rsquo;ll ping you
              instantly — no hovering at the counter.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={handleEnable}
                disabled={loading}
                aria-busy={loading}
                style={{
                  backgroundColor: loading
                    ? "rgba(245,86,12,0.5)"
                    : "var(--color-crimson-carrot)",
                  color: "var(--color-porcelain)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase" as const,
                  border: "none",
                  padding: "16px 28px",
                  borderRadius: 2,
                  cursor: loading ? "not-allowed" : "pointer",
                  width: "100%",
                  minHeight: 52,
                }}
              >
                {loading ? "Setting up…" : "Enable notifications"}
              </button>
              <button
                onClick={dismiss}
                disabled={loading}
                style={{
                  backgroundColor: "transparent",
                  color: "rgba(247,246,242,0.5)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 400,
                  fontSize: 12,
                  letterSpacing: "0.10em",
                  textTransform: "uppercase" as const,
                  border: "none",
                  padding: "12px 28px",
                  cursor: loading ? "not-allowed" : "pointer",
                  width: "100%",
                }}
              >
                Skip for now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
