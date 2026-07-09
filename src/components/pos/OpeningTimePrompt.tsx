"use client";

/**
 * OpeningTimePrompt — AT-134 (wireframe screen 2 / 1b).
 *
 * Modal over the POS on every login: "What time are you opening today?"
 * - Never blocking: "Remind me later" always available (snoozes for this
 *   browser session + date); it never clears the cart or detaches a customer
 *   (it's a sibling of POSWorkspace, so it can't).
 * - Already set today → pre-filled with the latest session's time; confirming
 *   an unchanged value is a silent no-op server-side (no re-notify).
 * - Changing the value shows the "this will notify customers" note — a changed
 *   time is a new session (reopening) and re-notifies, per the ticket rules.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getTodaySessions, submitOpeningTime, type OpeningSession } from "@/server/actions/opening";

function snoozeKey(date: string) {
  return `favo-opening-snoozed:${date}`;
}

export default function OpeningTimePrompt() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [sessions, setSessions] = useState<OpeningSession[]>([]);
  const [time, setTime] = useState("");
  const [prefill, setPrefill] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let stale = false;
    getTodaySessions().then((r) => {
      if (stale || !r.ok) return;
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(snoozeKey(r.data.date))) return;
      const latest = r.data.sessions[r.data.sessions.length - 1] ?? null;
      const initial = latest?.opensAt ?? "07:30";
      setDate(r.data.date);
      setSessions(r.data.sessions);
      setPrefill(initial);
      setTime(initial);
      setOpen(true);
    }).catch(() => { /* prompt just doesn't show — never blocks the POS */ });
    return () => { stale = true; };
  }, []);

  if (!open) return null;

  const alreadySet = sessions.length > 0;
  const changed = time !== prefill;

  function snooze() {
    try { sessionStorage.setItem(snoozeKey(date), "1"); } catch { /* ignore */ }
    setOpen(false);
  }

  async function confirm() {
    if (!time || submitting) return;
    setSubmitting(true);
    const res = await submitOpeningTime(time).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not record the opening time.",
    }));
    setSubmitting(false);
    if (!res.ok) { toast.error(res.message); return; }
    if (res.data.notified) toast.success(`Opening time set — customers notified (${time}).`);
    else toast.message("Opening time confirmed — already set for today.");
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      role="dialog" aria-modal="true" aria-label="Opening time prompt">
      <div className="w-full max-w-[400px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-porcelain p-5 flex flex-col gap-3">
        <h2 className="favo-h3 text-coffee-bean">What time are you opening today?</h2>
        <p className="favo-small text-cool-steel">
          {alreadySet
            ? "Already set for today — confirming won't notify customers again. Change the time if you're re-opening after a closure."
            : "Submitting notifies every subscribed customer."}
        </p>

        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Opening time"
          className="w-full rounded-[4px] border border-cool-steel/30 bg-coffee-bean/5 px-3 py-2.5 text-coffee-bean text-lg tabular-nums focus:border-crimson-carrot focus:outline-none min-h-[48px]" />

        {alreadySet && changed && (
          <p className="favo-caption text-crimson-carrot">
            Changing this will notify customers — a changed time counts as a new opening.
          </p>
        )}

        <div className="flex items-center justify-between gap-3 mt-1">
          <button type="button" onClick={snooze} disabled={submitting}
            className="favo-small text-cool-steel underline underline-offset-4 hover:text-coffee-bean min-h-[44px]">
            Remind me later
          </button>
          <button type="button" onClick={confirm} disabled={!time || submitting}
            className="flex items-center justify-center gap-2 rounded-[var(--radius-btn)] px-6 py-2.5 min-h-[44px] favo-small font-bold uppercase disabled:opacity-40"
            style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", letterSpacing: "var(--tracking-cta)" }}>
            {submitting && <Loader2 size={14} strokeWidth={2.25} className="animate-spin" />}
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
