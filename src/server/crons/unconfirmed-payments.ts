// Unconfirmed-payment reconciliation — PRD §9.6.2 job 4, S4, DEC-27.
//
// Every 15 min. For every open payment attempt that WAS sent (a never-sent
// attempt cannot hold money), it asks Yoco through the existing
// resolveTenderByLookup — S4's recovery, writer 2 of payments.status
// (§10.2.1). That function attaches a payment Yoco reports `successful` and
// never sends. This file never writes payments, never sends, never creates
// revenue (§9.6.2 rule 2): its only writes are the dedupe audit rows below.
//
// Then it ages every attempt still open — isAttemptOpen's predicate: any
// `pending` row, sent or not, and any `unresolved` row except one closed out
// never-sent — from `payments.at`, not from the last run, so a missed run
// delays the push and never resets the clock. It pushes the Admin ONCE per
// attempt that has reached 30 minutes. "Once" is an audit_log row
// (PAYMENT_AGED_ALERT_ACTION) written before the push and checked on every
// run, so a restart cannot re-push. S4a's immediate push at the moment of
// `unresolved` is a separate path.
//
// DEC-27 (owner decision, Mia, 10 Nov 2026): the job acts only on days we take
// payment — a Sunday (defaultSessionMode, the same date rule the close uses)
// or a day with an event session whose window's payment_posture is `standard`
// or `override` — and on attempts carried over from such a day until they are
// resolved. So the scheduler gate (shouldRunUnconfirmedPayments) is: an open
// attempt exists (asked first, one cheap query), or today (SAST) is a paid
// day. Any other firing does nothing and writes nothing, not even the
// scheduler's run row. An event session with no recorded posture is not a
// paid day.
//
// No device linked: while the till runs on the unlinked Web POS port (DEC-21
// era, selectWebPosPort's fallback) every lookup is a fetch error, so the
// lookups are skipped. The ageing and the 30-minute push still run: they read
// payments.at and do not depend on the lookup.

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, eventWindows, openingSessions, payments } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { formatZar } from "@/lib/format";
import { defaultSessionMode } from "@/lib/session-mode";
import { alertAdmins } from "@/server/push/admin-alert";
import { isAttemptOpen, resolveTenderByLookup } from "@/server/tender/tender";
import { getTenderDeps } from "@/server/tender/runtime";
import { unlinkedWebPosPort } from "@/server/tender/unlinked-port";
import { getTopupTenderDeps } from "@/server/funds/runtime";
import type { PaymentStatus, TenderActor, TenderDeps } from "@/server/tender/types";
import { sastDate } from "@/server/jobs/schedule";

/** §9.6.2 job 4: the unresolved threshold, measured on payment age. */
export const UNRESOLVED_ALERT_AGE_MS = 30 * 60 * 1000;
/** The audit action that marks "the 30-minute push was sent for this payment". */
export const PAYMENT_AGED_ALERT_ACTION = "payment.unresolved_30min_alert";
/** event_windows.payment_posture values under which people pay (§6.6). */
export const PAYING_POSTURES = ["standard", "override"] as const;

const SYSTEM: TenderActor = { kind: "system" };

/** An open attempt (isAttemptOpen): its subject is an order or a fund top-up. */
export type OpenPayment = {
  id: string;
  orderId: string | null;
  fundTopupId: string | null;
  attempt: number;
  amountZar: number;
  status: PaymentStatus;
  sentAt: Date | null;
  yocoPaymentId: string | null;
  at: Date;
};

export type UnconfirmedPaymentsDeps = {
  now(): Date;
  /** True if any open attempt exists, any age, any day. One query. */
  hasOpenPayment(): Promise<boolean>;
  /** True if `day` has an event session whose window's posture is paying. One query. */
  hasPayingEventSession(day: string): Promise<boolean>;
  /** The tender chain's deps for orders and for fund top-ups. */
  orderDeps(): TenderDeps;
  topupDeps(): TenderDeps;
  /** Every open attempt (isAttemptOpen). */
  listOpenPayments(): Promise<OpenPayment[]>;
  alreadyAlerted(paymentId: string): Promise<boolean>;
  recordAlerted(p: OpenPayment, ageMs: number): Promise<void>;
  push(title: string, body: string, data: Record<string, unknown>): Promise<void>;
};

/** SQL form of isAttemptOpen: pending, or unresolved and not closed out never-sent. */
const openWhere = () =>
  or(
    eq(payments.status, "pending"),
    and(eq(payments.status, "unresolved"), or(isNotNull(payments.sentAt), isNotNull(payments.yocoPaymentId))),
  );

export const defaultUnconfirmedPaymentsDeps: UnconfirmedPaymentsDeps = {
  now: () => new Date(),
  async hasOpenPayment() {
    const rows = await db.select({ id: payments.id }).from(payments).where(openWhere()).limit(1);
    return rows.length > 0;
  },
  async hasPayingEventSession(day) {
    const rows = await db
      .select({ id: openingSessions.id })
      .from(openingSessions)
      .innerJoin(eventWindows, eq(openingSessions.eventWindowId, eventWindows.id))
      .where(
        and(
          eq(openingSessions.sessionDate, day),
          eq(openingSessions.mode, "event"),
          inArray(eventWindows.paymentPosture, [...PAYING_POSTURES]),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },
  orderDeps: getTenderDeps,
  topupDeps: getTopupTenderDeps,
  async listOpenPayments() {
    return db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        fundTopupId: payments.fundTopupId,
        attempt: payments.attempt,
        amountZar: payments.amountZar,
        status: payments.status,
        sentAt: payments.sentAt,
        yocoPaymentId: payments.yocoPaymentId,
        at: payments.at,
      })
      .from(payments)
      .where(openWhere());
  },
  async alreadyAlerted(paymentId) {
    const [row] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityKind, "payment"),
          eq(auditLog.entityId, paymentId),
          eq(auditLog.action, PAYMENT_AGED_ALERT_ACTION),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
  async recordAlerted(p, ageMs) {
    await writeAudit({
      entityKind: "payment",
      entityId: p.id,
      action: PAYMENT_AGED_ALERT_ACTION,
      actorRole: "system",
      reason: "unresolved_30min",
      after: { orderId: p.orderId, fundTopupId: p.fundTopupId, attempt: p.attempt, amountZar: p.amountZar, status: p.status, ageMinutes: Math.floor(ageMs / 60_000) },
    });
  },
  push: alertAdmins,
};

/**
 * A day we take payment: TODAY (SAST) is a Sunday, or has an event session
 * with a paying posture. A Sunday is told by the date alone; any other day
 * asks the database once.
 */
export async function isPaidDay(
  firedAt: Date,
  deps: Pick<UnconfirmedPaymentsDeps, "hasPayingEventSession"> = defaultUnconfirmedPaymentsDeps,
): Promise<boolean> {
  const day = sastDate(firedAt);
  if (defaultSessionMode(day) === "sunday") return true;
  return deps.hasPayingEventSession(day);
}

/** DEC-27's gate: an open attempt exists (checked first), or today is a paid day. */
export async function shouldRunUnconfirmedPayments(
  firedAt: Date,
  deps: Pick<UnconfirmedPaymentsDeps, "hasOpenPayment" | "hasPayingEventSession"> = defaultUnconfirmedPaymentsDeps,
): Promise<boolean> {
  if (await deps.hasOpenPayment()) return true;
  return isPaidDay(firedAt, deps);
}

// Owner check pending: the PRD gives no copy for this push.
export function buildAgedUnresolvedAlert(p: OpenPayment, ageMs: number) {
  const subject = p.orderId ? `order ${p.orderId.slice(0, 8)}` : `fund top-up ${(p.fundTopupId ?? "").slice(0, 8)}`;
  return {
    title: `Payment unconfirmed for 30 minutes — ${subject}`,
    body: `${formatZar(p.amountZar)} · attempt ${p.attempt} · ${Math.floor(ageMs / 60_000)} min old. Yoco has not confirmed it. FAVO keeps asking Yoco every 15 minutes and never charges again.`,
    data: { paymentId: p.id, orderId: p.orderId, fundTopupId: p.fundTopupId, attempt: p.attempt, amountZar: p.amountZar, url: "/admin" },
  };
}

export type UnconfirmedPaymentsResult = {
  due: number;
  lookedUp: number;
  alerted: number;
  /** True while no Web POS device is linked: lookups skipped, ageing still runs. */
  lookupsSkipped?: "no_device_linked";
};

export async function reconcileUnconfirmedPayments(
  deps: UnconfirmedPaymentsDeps = defaultUnconfirmedPaymentsDeps,
): Promise<UnconfirmedPaymentsResult> {
  const open = (await deps.listOpenPayments()).filter(isAttemptOpen);
  if (open.length === 0) return { due: 0, lookedUp: 0, alerted: 0 };

  const orderDeps = deps.orderDeps();
  const unlinked = orderDeps.port === unlinkedWebPosPort;

  // One lookup per subject with a SENT open attempt: resolveTenderByLookup
  // covers every attempt on it and never looks up a never-sent one.
  const subjects = new Map<string, { id: string; topup: boolean }>();
  if (!unlinked) {
    for (const p of open) {
      if (p.sentAt === null) continue;
      if (p.orderId) subjects.set(`o:${p.orderId}`, { id: p.orderId, topup: false });
      else if (p.fundTopupId) subjects.set(`t:${p.fundTopupId}`, { id: p.fundTopupId, topup: true });
    }
  }
  const errors: string[] = [];
  let topupDeps: TenderDeps | null = null;
  for (const s of subjects.values()) {
    const label = `${s.topup ? "fund top-up" : "order"} ${s.id}`;
    try {
      const d = s.topup ? (topupDeps ??= deps.topupDeps()) : orderDeps;
      const r = await resolveTenderByLookup(d, SYSTEM, s.id);
      if (!r.ok) errors.push(`${label}: ${r.code}`);
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Age what is still open after the lookups, from payments.at.
  const now = deps.now();
  let alerted = 0;
  const still = subjects.size > 0 ? (await deps.listOpenPayments()).filter(isAttemptOpen) : open;
  for (const p of still) {
    const ageMs = now.getTime() - p.at.getTime();
    if (ageMs < UNRESOLVED_ALERT_AGE_MS) continue;
    if (await deps.alreadyAlerted(p.id)) continue;
    await deps.recordAlerted(p, ageMs);
    const a = buildAgedUnresolvedAlert(p, ageMs);
    await deps.push(a.title, a.body, a.data);
    alerted++;
  }

  // §9.6.2 rule 3: a failed lookup raises (one Admin push from the scheduler).
  if (errors.length > 0) throw new Error(`lookup failed for ${errors.length} subject(s): ${errors.join("; ")}`);
  return { due: open.length, lookedUp: subjects.size, alerted, ...(unlinked ? { lookupsSkipped: "no_device_linked" as const } : {}) };
}
