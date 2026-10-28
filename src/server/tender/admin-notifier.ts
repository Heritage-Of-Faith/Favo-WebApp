// AT-201 part 2b: the Admin pushes the tender chain owes (PRD v7.0 S4a,
// REQ-011, REQ-012), sent through src/server/push/admin-alert.ts.
//
//   paymentUnresolved → S4a / REQ-012: pushed the moment a payment enters
//     `unresolved`, naming the order, the amount, the barista and the session,
//     with S4a's one action. A second unresolved payment in the same session
//     also sends an escalation push ("two in one session escalate", S2a's
//     channel — the Admin push).
//   duplicateCharge   → REQ-011 / §6.8.4: both Yoco ids and the amount.
//
// The chain calls these after its transaction commits; a failed push never
// undoes a recorded payment (tender.ts runPost). Amounts are integer cents,
// formatted only for display.
//
// `daily_seq` does not exist yet (PRD §10.3 commissions it; no migration has
// added it), so the order is named by the first 8 characters of its id until
// it does.

import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, openingSessions, orders, staff } from "@db/schema";
import { formatZar, startOfDaySast } from "@/lib/format";
import { alertAdmins } from "@/server/push/admin-alert";
import type { TenderNotifier } from "./types";

/** S4a's one action, verbatim. */
export const S4A_ACTION =
  "Ask the customer whether their card was charged before they leave — the slip from the machine settles it.";

export type UnresolvedContext = {
  orderRef: string;
  amountZar: number;
  baristaName: string | null;
  /** The session the payment was in: its date and opening time. */
  session: { date: string; opensAt: string } | null;
  /** Payments that ENTERED unresolved in that session (audit rows), this one included. */
  unresolvedInSession: number;
};

export type AdminAlert = { title: string; body: string; data: Record<string, unknown> };

/** REQ-012's push, plus the escalation when this is the second (or later) in the session. */
export function unresolvedAlerts(ctx: UnresolvedContext, info: { orderId: string; attempt: number; cause: string }): AdminAlert[] {
  const session = ctx.session ? `session ${ctx.session.date} ${ctx.session.opensAt}` : "no session recorded";
  const barista = ctx.baristaName ?? "unknown barista";
  const data = {
    orderId: info.orderId,
    attempt: info.attempt,
    amountZar: ctx.amountZar,
    cause: info.cause,
    session: ctx.session,
    unresolvedInSession: ctx.unresolvedInSession,
  };
  const alerts: AdminAlert[] = [
    {
      title: `Payment unresolved — order ${ctx.orderRef}`,
      body: `${formatZar(ctx.amountZar)} · ${barista} · ${session}. ${S4A_ACTION}`,
      data,
    },
  ];
  if (ctx.unresolvedInSession >= 2) {
    alerts.push({
      title: `${ctx.unresolvedInSession} unresolved payments this session`,
      body: `Two or more unresolved payments in one session is the signature of a failing card machine (${session}, ${barista}).`,
      data: { ...data, escalation: true },
    });
  }
  return alerts;
}

export function duplicateChargeAlert(orderRef: string, info: { orderId: string; yocoPaymentIds: string[]; amountZar: number }): AdminAlert {
  return {
    title: `Duplicate charge — order ${orderRef}`,
    body: `Charged twice: Yoco ${info.yocoPaymentIds.join(" and ")} · ${formatZar(info.amountZar)}.`,
    data: { ...info },
  };
}

function orderRef(orderId: string): string {
  return orderId.slice(0, 8);
}

/** SAST is UTC+2 all year (no DST). */
function sessionStart(date: string, opensAt: string): Date {
  return new Date(`${date}T${opensAt}:00+02:00`);
}

async function loadUnresolvedContext(orderId: string, amountZar: number, now: Date): Promise<UnresolvedContext> {
  const [o] = await db
    .select({ revenueDay: orders.revenueDay, baristaName: staff.name })
    .from(orders)
    .leftJoin(staff, eq(orders.staffId, staff.id))
    .where(eq(orders.id, orderId));
  const base = { orderRef: orderRef(orderId), amountZar, baristaName: o?.baristaName ?? null };
  if (!o) return { ...base, session: null, unresolvedInSession: 1 };

  const sessions = await db
    .select({ opensAt: openingSessions.opensAt })
    .from(openingSessions)
    .where(eq(openingSessions.sessionDate, o.revenueDay))
    .orderBy(asc(openingSessions.opensAt));
  // Sessions are sequential (§6.11.1): the current one is the last to have opened.
  const starts = sessions.map((s) => ({ opensAt: s.opensAt, at: sessionStart(o.revenueDay, s.opensAt) }));
  let idx = -1;
  starts.forEach((s, i) => { if (s.at.getTime() <= now.getTime()) idx = i; });
  if (idx === -1 && starts.length > 0) idx = 0;
  if (idx === -1) return { ...base, session: null, unresolvedInSession: 1 };
  // The session runs from its opening to the next session's (the first runs
  // from the start of the revenue day, the last to its end).
  const from = idx === 0 ? startOfDaySast(o.revenueDay) : starts[idx].at;
  const to = starts[idx + 1]?.at ?? new Date(startOfDaySast(o.revenueDay).getTime() + 86_400_000);

  // "Two in one session escalate" counts payments that ENTERED unresolved in
  // the session — the audit row recordTenderResult / resolveTenderByLookup
  // write at that moment — whether or not a later lookup resolved them. Only
  // the causes that push (ceiling, send_timeout); a duplicate_charge is
  // pushed on its own.
  const entered = await db
    .select({ entityId: auditLog.entityId, at: auditLog.at, reason: auditLog.reason })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityKind, "payment"),
      eq(auditLog.action, "payment.unresolved"),
      gte(auditLog.at, from),
      lt(auditLog.at, to),
    ));
  const inSession = new Set(
    entered
      .filter((r) => (r.reason === "ceiling" || r.reason === "send_timeout")
        && r.at.getTime() >= from.getTime() && r.at.getTime() < to.getTime())
      .map((r) => r.entityId)
  ).size;

  return {
    ...base,
    session: { date: o.revenueDay, opensAt: starts[idx].opensAt },
    unresolvedInSession: Math.max(inSession, 1),
  };
}

export function createAdminTenderNotifier(now: () => Date = () => new Date()): TenderNotifier {
  return {
    async paymentUnresolved(info) {
      const ctx = await loadUnresolvedContext(info.orderId, info.amountZar, now());
      for (const a of unresolvedAlerts(ctx, info)) await alertAdmins(a.title, a.body, a.data);
    },
    async duplicateCharge(info) {
      const a = duplicateChargeAlert(orderRef(info.orderId), info);
      await alertAdmins(a.title, a.body, a.data);
    },
  };
}
