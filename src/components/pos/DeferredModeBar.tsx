"use client";

/**
 * DeferredModeBar — PRD v7.0 §6.0.4 T3 steps 1, 3 and 4.
 *
 *  • While the open session is deferred: the persistent banner, verbatim —
 *    "Card machine unavailable — orders are being taken unpaid." It has no
 *    dismiss control ("It does not go away and cannot be dismissed").
 *  • Entering: the barista types a short reason (at least 3 characters, owner
 *    decision) and confirms; the server audits it and pushes the Admin (S2a).
 *  • Leaving: the same control ("A manually-entered mode never clears itself —
 *    it needs the same tap that set it"). A check-triggered entry refuses a
 *    barista: "Needs an admin" (REQ-006), shown as the server returns it.
 *  • A link to /pos/settle, where unpaid deferred orders are settled.
 *  • While a session is open, the §6.7 device check every 60 s
 *    (runDeviceHealthCheck). The server looks the machine up and decides.
 *
 * Not shown on a weekday session: the server refuses deferred mode where
 * nobody pays (S7a). Labels not in the PRD (invented): "Switch to deferred",
 * "Leave deferred", "Reason", "Confirm", "Cancel", "Unpaid orders".
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle } from "lucide-react";
import { getDeferredState, runDeviceHealthCheck, setDeferredMode } from "@/server/actions/deferred";
import { DEFERRED_BANNER } from "@/lib/deferred-copy";
import { SESSION_CHANGED_EVENT } from "@/lib/pos-vouchers";

type State = { sessionId: string; mode: string | null; deferred: boolean } | null;

const MIN_REASON_CHARS = 3;
/** §6.7: "A background device check every 60 s" (the server's DEVICE_CHECK_INTERVAL_MS). */
const DEVICE_CHECK_EVERY_MS = 60_000;

export default function DeferredModeBar() {
  const [state, setState] = useState<State>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  const read = useCallback(async () => {
    const r = await getDeferredState().catch(() => null);
    if (r && r.ok) setState(r.data ? { sessionId: r.data.sessionId, mode: r.data.mode, deferred: r.data.deferred } : null);
  }, []);

  useEffect(() => {
    void read();
    window.addEventListener(SESSION_CHANGED_EVENT, read);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, read);
  }, [read]);

  // §6.7 / §6.8.2: the device check, every 60 s while a session is open. The
  // server looks the machine up and decides; nothing here is a result. The
  // next check is scheduled only after the last one answered, so two never
  // overlap. Off on the server unless the live Web POS port is selected.
  const sessionId = state?.sessionId ?? null;
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = () => {
      timer = setTimeout(async () => {
        const r = await runDeviceHealthCheck().catch(() => null);
        if (stopped) return;
        if (r && r.ok && r.data.action !== "none") await read();
        loop();
      }, DEVICE_CHECK_EVERY_MS);
    };
    loop();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, read]);

  if (!state) return null;
  if (!state.deferred && state.mode === "weekday") return null;

  async function submit(on: boolean, why: string) {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    const r = await setDeferredMode(state.sessionId, on, why).catch(() => null);
    if (!r) setError("Couldn't reach FAVO — try again.");
    else if (!r.ok) setError(r.message);
    else { setAsking(false); setReason(""); }
    await read();
    setBusy(false);
  }

  const reasonOk = reason.replace(/\s/g, "").length >= MIN_REASON_CHARS;

  return (
    <div
      role={state.deferred ? "alert" : undefined}
      className={
        state.deferred
          ? "flex flex-wrap items-center gap-2 border-b border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-4 py-1 min-h-[44px]"
          : "flex flex-wrap items-center justify-end gap-2 border-b border-cool-steel/20 px-4 py-1 min-h-[44px]"
      }
    >
      {state.deferred && (
        <>
          <AlertTriangle size={14} strokeWidth={2} className="text-[var(--color-error)] shrink-0" />
          <span className="favo-small text-coffee-bean flex-1">
            <strong>{DEFERRED_BANNER}</strong>
          </span>
        </>
      )}
      {error && <span className="favo-small text-[var(--color-error)]">{error}</span>}
      <Link
        href={"/pos/settle" as Route}
        className="favo-small rounded-[4px] border border-cool-steel/30 px-3 min-h-[44px] flex items-center text-coffee-bean hover:bg-coffee-bean/8"
      >
        Unpaid orders
      </Link>
      {state.deferred ? (
        <button
          type="button"
          onClick={() => submit(false, "")}
          disabled={busy}
          className="favo-small rounded-[4px] border border-cool-steel/30 px-3 min-h-[44px] text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-50"
        >
          Leave deferred
        </button>
      ) : asking ? (
        <>
          <label className="favo-small text-cool-steel flex items-center gap-2">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              autoFocus
              className="rounded-[4px] border border-cool-steel/30 bg-transparent px-2 min-h-[44px] text-coffee-bean"
            />
          </label>
          <button
            type="button"
            onClick={() => submit(true, reason)}
            disabled={busy || !reasonOk}
            className="favo-small rounded-[4px] border border-cool-steel/30 px-3 min-h-[44px] text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => { setAsking(false); setReason(""); setError(null); }}
            className="favo-small rounded-[4px] px-3 min-h-[44px] text-cool-steel"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          disabled={busy}
          className="favo-small rounded-[4px] border border-cool-steel/30 px-3 min-h-[44px] text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-50"
        >
          Switch to deferred
        </button>
      )}
    </div>
  );
}
