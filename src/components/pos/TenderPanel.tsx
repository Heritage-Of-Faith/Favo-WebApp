"use client";

/**
 * TenderPanel — the card tender at the counter (PRD v7.0 T2 steps 3–5, §6.8.4).
 *
 *   begin  → beginTender(orderId), unless createOrder already began attempt n
 *   send   → sendToTerminal(orderId, n): the amount is pushed to the machine
 *   poll   → pollTenderResult(orderId, n) every 2 s for the first 30 s after
 *            the send, then every 5 s (S2). The 180 s ceiling is the server's.
 *
 * What the barista sees, per §6.0.1 / §6.8.4 (copy verbatim where the PRD gives it):
 *   successful          → onPaid
 *   PAYMENT_DECLINED    → "Card declined — try again or use another card." The
 *                         order stays `ordered` (S3); Try again begins a NEW attempt.
 *   GATEWAY_UNAVAILABLE → "Couldn't reach the card system — try again." with a
 *                         retry (REQ-010: the one failure where it is safe).
 *   PAYMENT_UNKNOWN     → "We'll confirm this one shortly" and an unresolved
 *                         marker. NEVER a retry and never a re-send (REQ-010, S4):
 *                         the order goes to the queue and the drink is made.
 *   TENDER_NOT_BEGUN    → nothing was written or sent; a retry.
 *   a send that never answered / poll says "not sent" → "Send again", which
 *                         resumes the SAME attempt via beginTender (never a second send).
 *   TERMINAL_UNREACHABLE and everything else → the server's message. When the
 *                         server marks it deferredOffered (a LINKED machine did
 *                         not answer), "Switch to deferred" — setDeferredMode one
 *                         tap away (§6.7), no typed reason. Never a retry. The
 *                         order in hand is not converted: the barista is told
 *                         to cancel it and ring it again (taken unpaid then).
 *
 * No Yoco key, SDK or card form is in the browser (REQ-071): every call is a
 * server action, and the browser never submits a payment result (§10.2.1).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { beginTender, pollTenderResult, sendToTerminal } from "@/server/actions/tender";
import type { TenderActionFailure } from "@/server/actions/tender";
import { enterDeferredAfterUnreachable } from "@/server/actions/deferred";
import { formatZar } from "@/lib/format";
import { SESSION_CHANGED_EVENT } from "@/lib/pos-vouchers";

export const TENDER_COPY = {
  sending: (amountZar: number) => `Sending ${formatZar(amountZar)} to the card machine…`,
  sent: (amountZar: number) => `Amount sent — ${formatZar(amountZar)} on the machine.`,
  waiting: "Waiting on the card machine",
  declined: "Card declined — try again or use another card.",
  unknown: "We'll confirm this one shortly",
  /** The server action did not answer: no attempt was begun, nothing was sent. */
  notBegun: "Couldn't start the card payment — nothing was sent. Try again.",
  /** The send may never have reached the server. Resuming re-sends only if it was never claimed. */
  notSent: "The card machine may not have received this payment.",
  /**
   * After "Switch to deferred": the order in hand is NOT converted to deferred
   * (that would rewrite its payment mode). Not PRD copy: the PRD gives none.
   */
  deferredOn: "Deferred mode is on. This order was not changed — cancel it and ring it again, and it will be taken unpaid.",
} as const;

/** S2: every 2 s for the first 30 s after the send, then every 5 s. */
export function nextPollDelayMs(msSinceSend: number): number {
  return msSinceSend < 30_000 ? 2_000 : 5_000;
}

type Phase =
  | { kind: "starting" }
  | { kind: "waiting"; attempt: number; sentAt: number }
  | { kind: "paid" }
  | { kind: "declined" }
  | { kind: "unknown" }
  | { kind: "failed"; code: string; message: string; retry: boolean; retryLabel?: string; deferredOffered?: boolean };

export type Props = {
  orderId: string;
  amountZar: number;
  /** An attempt createOrder already began (T2 step 3 — "automatic on Place"). */
  attempt?: number;
  /** Why createOrder could not begin one. Shown as is; a retry begins afresh. */
  initialFailure?: { code: string; message: string; retryOffered?: boolean };
  onPaid: () => void;
  /** PAYMENT_UNKNOWN: the order proceeds to the queue (S4). */
  onUnresolved?: () => void;
};

export default function TenderPanel({ orderId, amountZar, attempt, initialFailure, onPaid, onUnresolved }: Props) {
  const [phase, setPhase] = useState<Phase>(
    initialFailure
      ? {
          kind: "failed", code: initialFailure.code, message: initialFailure.message,
          retry: initialFailure.retryOffered === true || initialFailure.code === "GATEWAY_UNAVAILABLE",
        }
      : { kind: "starting" }
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onFailure = useCallback((f: TenderActionFailure) => {
    if (!alive.current) return;
    if (f.code === "PAYMENT_DECLINED") setPhase({ kind: "declined" });
    else if (f.code === "PAYMENT_UNKNOWN") {
      setPhase({ kind: "unknown" });
      onUnresolved?.();
    } else {
      setPhase({
        kind: "failed", code: f.code, message: f.message, retry: f.retryOffered === true,
        deferredOffered: f.code === "TERMINAL_UNREACHABLE" && f.deferredOffered === true,
      });
    }
  }, [onUnresolved]);

  // §6.7: the one tap into deferred mode after TERMINAL_UNREACHABLE.
  const [deferredNote, setDeferredNote] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const switchToDeferred = useCallback(async () => {
    setSwitching(true);
    const r = await enterDeferredAfterUnreachable().catch(() => null);
    if (!alive.current) return;
    setSwitching(false);
    if (!r) setDeferredNote("Couldn't reach FAVO — try again.");
    else if (!r.ok) setDeferredNote(r.message);
    else {
      setDeferredNote(TENDER_COPY.deferredOn);
      window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
    }
  }, []);

  // The send may never have reached the server. "Send again" goes through
  // beginTender, which names the open attempt: if the server never claimed it
  // (sent_at empty) it is sent — the first time; if it did, it is polled.
  // A claimed attempt is never sent twice (REQ-029).
  const notSent = useCallback(() => {
    if (!alive.current) return;
    setPhase({ kind: "failed", code: "NOT_SENT", message: TENDER_COPY.notSent, retry: true, retryLabel: "Send again" });
  }, []);

  const poll = useCallback((n: number, sentAt: number) => {
    if (!alive.current) return;
    setPhase({ kind: "waiting", attempt: n, sentAt });
    timer.current = setTimeout(async () => {
      const r = await pollTenderResult(orderId, n).catch(() => null);
      if (!alive.current) return;
      if (r === null) return poll(n, sentAt); // a network blip is not a status (§6.8.4)
      // VALIDATION here is "this attempt has not been sent" (or no such attempt).
      if (!r.ok && r.code === "VALIDATION") return notSent();
      if (!r.ok) return onFailure(r);
      if (r.data.status === "successful") {
        setPhase({ kind: "paid" });
        onPaid();
        return;
      }
      poll(n, sentAt);
    }, nextPollDelayMs(Date.now() - sentAt));
  }, [orderId, onFailure, onPaid, notSent]);

  const send = useCallback(async (n: number) => {
    const r = await sendToTerminal(orderId, n).catch(() => null);
    if (!alive.current) return;
    // The action did not answer: whether the server claimed the send is
    // unknown. Offer "Send again", which resumes through beginTender.
    if (r === null) return notSent();
    if (!r.ok) return onFailure(r);
    poll(n, new Date(r.data.sentAt).getTime());
  }, [orderId, onFailure, poll, notSent]);

  const begin = useCallback(async () => {
    setPhase({ kind: "starting" });
    const r = await beginTender(orderId).catch(() => null);
    if (!alive.current) return;
    if (r === null) {
      setPhase({ kind: "failed", code: "TENDER_NOT_BEGUN", message: TENDER_COPY.notBegun, retry: true });
      return;
    }
    if (r.ok) return send(r.data.attempt);
    // An attempt is already open (another tap, or a reload): resume it rather
    // than begin another. A begun-but-unsent attempt is sent; a sent one polled.
    const open = r.openAttempt;
    if (r.code === "TENDER_IN_PROGRESS" && open) {
      if (open.status === "pending" && !open.sent) return send(open.attempt);
      if (open.status === "pending") return poll(open.attempt, Date.now());
      setPhase({ kind: "unknown" });
      onUnresolved?.();
      return;
    }
    onFailure(r);
  }, [orderId, send, poll, onFailure, onUnresolved]);

  useEffect(() => {
    if (started.current || initialFailure) return;
    started.current = true;
    if (attempt !== undefined) void send(attempt);
    else void begin();
  }, [attempt, initialFailure, send, begin]);

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {phase.kind === "starting" && (
        <p className="favo-small text-center text-cool-steel">{TENDER_COPY.sending(amountZar)}</p>
      )}
      {phase.kind === "waiting" && (
        <div className="flex flex-col items-center gap-1 py-2">
          <p className="favo-h3 text-coffee-bean">{TENDER_COPY.sent(amountZar)}</p>
          <p className="favo-small text-cool-steel">{TENDER_COPY.waiting}</p>
        </div>
      )}
      {phase.kind === "paid" && <p className="favo-small text-center text-coffee-bean">Paid</p>}
      {phase.kind === "unknown" && (
        <p className="favo-small text-center text-cool-steel">
          {TENDER_COPY.unknown} <span className="favo-caption rounded border border-cool-steel/30 px-1">unresolved</span>
        </p>
      )}
      {phase.kind === "declined" && (
        <>
          <p className="favo-small text-center" style={{ color: "var(--color-warning)" }}>{TENDER_COPY.declined}</p>
          <button type="button" onClick={() => void begin()}
            className="w-full rounded-[var(--radius-btn)] border border-cool-steel/30 px-4 py-3 favo-label text-coffee-bean hover:bg-coffee-bean/8">
            Try again
          </button>
        </>
      )}
      {phase.kind === "failed" && (
        <>
          <p className="favo-small text-center" style={{ color: "var(--color-warning)" }}>{phase.message}</p>
          {phase.retry && (
            <button type="button" onClick={() => void begin()}
              className="w-full rounded-[var(--radius-btn)] border border-cool-steel/30 px-4 py-3 favo-label text-coffee-bean hover:bg-coffee-bean/8">
              {phase.retryLabel ?? "Try again"}
            </button>
          )}
          {phase.deferredOffered && deferredNote !== TENDER_COPY.deferredOn && (
            <button type="button" onClick={() => void switchToDeferred()} disabled={switching}
              className="w-full rounded-[var(--radius-btn)] border border-cool-steel/30 px-4 py-3 favo-label text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-50">
              Switch to deferred
            </button>
          )}
          {phase.deferredOffered && deferredNote && (
            <p className="favo-small text-center text-coffee-bean">{deferredNote}</p>
          )}
        </>
      )}
    </div>
  );
}
