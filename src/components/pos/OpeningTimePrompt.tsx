"use client";

/**
 * OpeningTimePrompt — AT-134 (wireframe screen 2 / 1b), now the POS opening
 * step (AT-204 prerequisite; PRD §6.0 flow row 1, L18, §6.6, §6.11.1, REQ-057).
 *
 * - No session open (NO_SESSION): blocking — "Open the session first". The
 *   barista sets the opening time and sees the mode it resolves to: the date
 *   mode, or the named event with its six switches as confirmed state. One
 *   Confirm opens the session in that mode.
 * - Saturday with no event: no mode picker and no Confirm — only Start an event.
 * - An event replacing a Sunday needs one extra confirm (§6.6 precedence 2).
 * - Start an event (§6.6 Path C): pick a profile and give it an end time; the
 *   end time is mandatory.
 * - A session open: shows it, can close it; "Remind me later" dismisses for
 *   this browser session + date and never clears the cart (sibling of
 *   POSWorkspace).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getOpeningStep, openSession, closeSession, openEventWindow,
  type CurrentSession, type OpeningSession,
} from "@/server/actions/opening";
import {
  resolveSessionMode, describeEvent, switchLines, dateModeLabel, postureIsInTill, sastClock, sastInstant,
  type EventProfileView, type EventWindowView, type ModeResolution,
} from "@/lib/session-mode";
import { SESSION_CHANGED_EVENT } from "@/lib/pos-vouchers";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function snoozeKey(date: string) {
  return `favo-opening-snoozed:${date}`;
}

/** After a session opens or closes, the POS re-reads what depends on it (the voucher chip). */
function announceSessionChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

const COUNT_RE = /^\d+$/;

type Step = {
  date: string;
  current: CurrentSession | null;
  sessions: OpeningSession[];
  windows: EventWindowView[];
  profiles: EventProfileView[];
};

const ctaStyle = { background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", letterSpacing: "var(--tracking-cta)" };
const ctaClass = "flex items-center justify-center gap-2 rounded-[var(--radius-btn)] px-6 py-2.5 min-h-[44px] favo-small font-bold uppercase disabled:opacity-40";
const linkClass = "favo-small text-cool-steel underline underline-offset-4 hover:text-coffee-bean min-h-[44px]";
const inputClass = "w-full rounded-[4px] border border-cool-steel/30 bg-coffee-bean/5 px-3 py-2.5 text-coffee-bean text-lg tabular-nums focus:border-crimson-carrot focus:outline-none min-h-[48px]";

export default function OpeningTimePrompt() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Step | null>(null);
  const [time, setTime] = useState("");
  const [sundayOk, setSundayOk] = useState(false);
  const [starting, setStarting] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [endTime, setEndTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  // L43: the tin count as typed. "" is "not counted", never zero.
  const [slipCount, setSlipCount] = useState("");

  const load = useCallback(async (opts: { initial: boolean; time?: string; isStale?: () => boolean }) => {
    const r = await getOpeningStep();
    if (opts.isStale?.() || !r.ok) return false;
    const snoozed = typeof sessionStorage !== "undefined" && sessionStorage.getItem(snoozeKey(r.data.date));
    // A snooze only ever hides an open session; NO_SESSION is unskippable.
    if (opts.initial && snoozed && r.data.current) return false;
    setData(r.data);
    setTime(opts.time ?? (r.data.sessions.length === 0 ? "07:30" : sastClock(new Date())));
    setSundayOk(false);
    setStarting(false);
    setError(null);
    setTimeError(null);
    setSlipCount("");
    setOpen(true);
    return true;
  }, []);

  useEffect(() => {
    let stale = false;
    load({ initial: true, isStale: () => stale })
      .catch(() => { /* step just doesn't show — never blocks the POS on an error */ });
    return () => { stale = true; };
  }, [load]);

  const resolution: ModeResolution | null = useMemo(() => {
    if (!data || !TIME_RE.test(time)) return null;
    return resolveSessionMode({
      sessionDate: data.date, opensAt: time, closesAt: null, windows: data.windows, profiles: data.profiles,
    });
  }, [data, time]);

  if (!open || !data) return null;

  function snooze() {
    try { sessionStorage.setItem(snoozeKey(data!.date), "1"); } catch { /* ignore */ }
    setOpen(false);
  }

  async function confirm() {
    if (busy) return;
    // QA round 1 (#279): an empty time shows a message instead of doing nothing.
    if (!TIME_RE.test(time)) { setTimeError("Enter the time you are opening, for example 07:30."); return; }
    setTimeError(null);
    if (!resolution || resolution.kind === "closed") return;
    const c = resolution.kind === "date"
      ? { mode: resolution.mode }
      : resolution.source === "window"
        ? { mode: "event" as const, eventWindowId: resolution.window.id }
        : { mode: "event" as const, eventProfileId: resolution.profile.id };
    setBusy(true);
    setError(null);
    const res = await openSession({ opensAt: time, confirm: c, sundayOverrideConfirmed: sundayOk }).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not open the session.",
    }));
    setBusy(false);
    if (!res.ok) { setError(res.message); toast.error(res.message); return; }
    if (res.data.notified) toast.success(`Session open — customers notified (${time}).`);
    else toast.message("Session confirmed — already open.");
    setOpen(false);
    announceSessionChange();
  }

  /**
   * closeSession, with the slip count only when one was typed (L43, REQ-157):
   * `counted` undefined leaves voucher_slips_counted NULL. Never blocks (REQ-156).
   */
  async function close(id: string, counted?: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const call = counted === undefined ? closeSession(id) : closeSession(id, counted);
    const res = await call.catch(() => ({ ok: false as const, code: "ERR", message: "Could not close the session." }));
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    announceSessionChange();
    await load({ initial: false });
  }

  async function startEvent() {
    if (!profileId || !TIME_RE.test(endTime) || busy) return;
    setBusy(true);
    setError(null);
    const endsAt = sastInstant(data!.date, endTime).toISOString();
    const res = await openEventWindow(profileId, { endsAt }).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not start the event.",
    }));
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    announceSessionChange();
    await load({ initial: false, time: sastClock(res.data.window.startsAt) });
  }

  const startable = data.profiles.filter((p) => postureIsInTill(p.paymentPosture));
  const event = resolution?.kind === "event"
    ? resolution.source === "window"
      ? { name: resolution.window.name, switches: resolution.window, endsAt: resolution.window.endsAt }
      : { name: resolution.profile.name, switches: resolution.profile, endsAt: resolution.endsAt }
    : null;
  const needsSundayOk = resolution?.kind === "event" && resolution.overridesSunday;
  // §6.11.1: closeSession prompts for the slip count when vouchers were in force.
  const countsSlips = (data.current?.voucherKindsActive?.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      role="dialog" aria-modal="true" aria-label="Opening step">
      <div className="w-full max-w-[440px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-porcelain p-5 flex flex-col gap-3">
        {data.current ? (
          <>
            <h2 className="favo-h3 text-coffee-bean">
              {`Session open since ${data.current.opensAt} · ${currentLabel(data.current)}`}
            </h2>
            {countsSlips && (
              <>
                <label className="favo-small text-cool-steel" htmlFor="voucher-slips">Voucher slips counted</label>
                <input id="voucher-slips" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                  value={slipCount} onChange={(e) => setSlipCount(e.target.value.trim())} className={inputClass} />
              </>
            )}
            {error && <p role="alert" className="favo-caption text-crimson-carrot">{error}</p>}
            <div className="flex items-center justify-between gap-3 mt-1">
              <button type="button" onClick={snooze} disabled={busy} className={linkClass}>Remind me later</button>
              <div className="flex items-center gap-3">
                {countsSlips && (
                  <button type="button" onClick={() => close(data.current!.id)} disabled={busy} className={linkClass}>
                    Not counted
                  </button>
                )}
                <button type="button"
                  onClick={() => close(data.current!.id, countsSlips ? Number(slipCount) : undefined)}
                  disabled={busy || (countsSlips && !COUNT_RE.test(slipCount))} className={ctaClass} style={ctaStyle}>
                  {busy && <Loader2 size={14} strokeWidth={2.25} className="animate-spin" />}
                  Close session
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 className="favo-h3 text-coffee-bean">Open the session first</h2>
            <label className="favo-small text-cool-steel" htmlFor="opening-time">What time are you opening?</label>
            <input id="opening-time" type="time" value={time} aria-label="Opening time"
              aria-invalid={timeError ? true : undefined}
              onChange={(e) => { setTime(e.target.value); setSundayOk(false); setTimeError(null); }} className={inputClass} />
            {timeError && <p className="favo-small text-[var(--color-error)]" role="alert">{timeError}</p>}
            <p className="favo-small text-cool-steel">Submitting notifies every subscribed customer.</p>

            {resolution?.kind === "date" && (
              <p className="favo-body font-bold text-coffee-bean">{dateModeLabel(resolution.mode)}</p>
            )}
            {resolution?.kind === "closed" && (
              <p className="favo-body text-coffee-bean">The café is closed on Saturdays unless an event is set up.</p>
            )}
            {event && (
              <div className="flex flex-col gap-1">
                <p className="favo-body font-bold text-coffee-bean">{describeEvent(event.name, event.switches, event.endsAt)}</p>
                <dl className="grid grid-cols-2 gap-x-3 favo-caption text-cool-steel">
                  {switchLines(event.switches).map((l) => (
                    <div key={l.label} className="contents"><dt>{l.label}</dt><dd>{l.value}</dd></div>
                  ))}
                </dl>
              </div>
            )}
            {needsSundayOk && (
              <label className="flex items-center gap-2 favo-small text-coffee-bean min-h-[44px]">
                <input type="checkbox" checked={sundayOk} onChange={(e) => setSundayOk(e.target.checked)} />
                Run this session as the event, not as Sunday
              </label>
            )}

            {starting && (
              <div className="flex flex-col gap-2 rounded-[4px] border border-cool-steel/20 p-3">
                {startable.length === 0 ? (
                  <p className="favo-small text-cool-steel">No event profiles are set up.</p>
                ) : (
                  <>
                    <select aria-label="Event profile" value={profileId} onChange={(e) => setProfileId(e.target.value)} className={inputClass}>
                      <option value="">Choose an event</option>
                      {startable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="time" aria-label="Event end time" value={endTime}
                      onChange={(e) => setEndTime(e.target.value)} className={inputClass} />
                    <button type="button" onClick={startEvent} disabled={!profileId || !TIME_RE.test(endTime) || busy}
                      className={ctaClass} style={ctaStyle}>Start event</button>
                  </>
                )}
              </div>
            )}

            {error && <p role="alert" className="favo-caption text-crimson-carrot">{error}</p>}

            <div className="flex items-center justify-between gap-3 mt-1">
              {!starting && (
                <button type="button" onClick={() => setStarting(true)} disabled={busy} className={linkClass}>
                  Start an event
                </button>
              )}
              {/* Shown for an empty/invalid time too, so Confirm explains itself (#279). */}
              {resolution?.kind !== "closed" && (
                <button type="button" onClick={confirm}
                  disabled={busy || (needsSundayOk && !sundayOk)} className={ctaClass} style={ctaStyle}>
                  {busy && <Loader2 size={14} strokeWidth={2.25} className="animate-spin" />}
                  Confirm
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function currentLabel(c: CurrentSession): string {
  if (c.mode === "event") {
    return c.eventWindow ? describeEvent(c.eventWindow.name, c.eventWindow, c.eventWindow.endsAt) : "Event";
  }
  return dateModeLabel(c.mode);
}

