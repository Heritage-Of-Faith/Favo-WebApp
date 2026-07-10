"use client";

/**
 * StaffPushOptIn — task M10.
 *
 * One-time card shown after PIN login when notifications aren't yet granted.
 * Offers to enable low-stock / order push alerts on this device. Persists an
 * "asked once" flag in localStorage so it doesn't nag every shift — but
 * re-shows if permission is later revoked (permission !== 'granted').
 */

import { useState, useEffect } from "react";
import { Bell, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { enableStaffPush } from "@/lib/push/staff-subscribe";

const ASKED_KEY = "favo_pos_push_asked";

export default function StaffPushOptIn() {
  const [visible, setVisible] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.Notification || !("serviceWorker" in navigator)) return;

    const permission = window.Notification.permission;
    if (permission === "granted") return;
    const asked = localStorage.getItem(ASKED_KEY) === "1";
    if (permission === "denied") {
      setDenied(true);
      setVisible(true);
    } else if (!asked) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    try { localStorage.setItem(ASKED_KEY, "1"); } catch { /* ignore */ }
    setVisible(false);
  }

  async function handleEnable() {
    setLoading(true);
    const res = await enableStaffPush();
    setLoading(false);
    if (res.ok) {
      toast.success("Notifications enabled for this device.");
    } else {
      toast.message(res.message);
    }
    dismiss();
  }

  if (!visible) return null;

  return (
    // AT-138: anchored bottom-right rather than bottom-center — centered would
    // sit directly over Zone B's Charge button and overlap its hit area.
    <div className="fixed bottom-4 right-4 z-40 w-[calc(100%-2rem)] max-w-[420px] rounded-[2px] border border-cool-steel/25 bg-dark-teal-deep p-4 shadow-[var(--shadow-2)]">
      <div className="flex items-start gap-3">
        <Bell size={18} strokeWidth={2} className="text-crimson-carrot shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="favo-subhead text-porcelain">Get stock & order alerts</p>
          <p className="favo-small text-cool-steel mt-0.5">
            Get pinged on this device when stock runs low or an order needs attention.
          </p>
          {denied ? (
            <div className="mt-3 flex gap-2">
              <p className="favo-small text-cool-steel">
                Notifications are blocked. Allow them in your browser settings, then refresh.
              </p>
              <button type="button" onClick={dismiss} className="ml-auto shrink-0 min-h-[44px] rounded-[4px] border border-cool-steel/30 px-4 favo-small text-cool-steel hover:bg-porcelain/10">
                Dismiss
              </button>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleEnable}
                disabled={loading}
                className="flex min-h-[44px] items-center gap-2 rounded-[4px] bg-crimson-carrot px-4 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
                style={{ color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}
              >
                {loading ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : "Enable"}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 px-4 favo-small text-cool-steel hover:bg-porcelain/10"
              >
                Not now
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-11 w-11 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
