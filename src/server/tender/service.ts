// AT-201 part 2b: the tender chain as the POS calls it. Not a server action
// (src/server/actions/tender.ts authenticates and calls these; createOrder
// calls startTender). Adds what the chain does not own:
//
//   - NO_SESSION (S1: "No opening_sessions row for today") before beginTender —
//     §11.2 lists it among beginTender's errors. Refusals are audited.
//   - On TENDER_IN_PROGRESS, which attempt is open, so the screen can resume it
//     (send a begun-but-unsent attempt; poll a sent one) instead of beginning
//     another — a second begin is refused, and a re-send never happens: the
//     chain claims sent_at under the order lock (REQ-029).
//
// recordTenderResult is deliberately NOT here: it is reached only through
// pollTenderResult and resolveTenderByLookup, with what the server itself read
// from Yoco — never with a result a client supplied (§10.2.1).

import {
  beginTender,
  isAttemptOpen,
  pollTenderResult,
  resolveTenderByLookup,
  sendToTerminal,
  type BeginTenderOk,
  type PollOk,
  type ResolveOk,
  type SendToTerminalOk,
} from "./tender";
import { getTenderDeps, hasSessionToday } from "./runtime";
import { unlinkedWebPosPort } from "./unlinked-port";
import type { PaymentStatus, TenderActor, TenderFailure } from "./types";

export const NO_SESSION_COPY = "No session is open today — set the opening time first.";

/**
 * TERMINAL_UNREACHABLE when NO Web POS device is linked to FAVO at all (no
 * app_config.webpos_device_id, or the port is the unlinked one). The PRD's own
 * copy offers "switch to deferred", and deferred mode is not built, so it would
 * point the barista at a switch that does not exist. When a device IS linked,
 * the PRD's copy stands.
 */
export const NO_TERMINAL_LINKED_COPY =
  "No card terminal is linked to FAVO yet. Take this payment on the Yoco app, or cancel the order.";

/**
 * beginTender threw (e.g. the database is unreachable). Its transaction rolled
 * back, so no payments row exists and nothing was sent: safe to try again.
 * Deliberately not STALE_STATE (nothing moved under the caller) and never
 * PAYMENT_UNKNOWN (nothing was sent). NB: not in §6.0.1's closed code set.
 */
export const TENDER_NOT_BEGUN = {
  ok: false as const,
  code: "TENDER_NOT_BEGUN" as const,
  message: "Couldn't start the card payment — nothing was sent. Try again.",
  retryOffered: true,
};

export type OpenAttempt = { attempt: number; status: PaymentStatus; sent: boolean };

export type ServiceFailure =
  | (TenderFailure & { openAttempt?: OpenAttempt })
  | { ok: false; code: "NO_SESSION"; message: string }
  | typeof TENDER_NOT_BEGUN;

export async function startTender(actor: TenderActor, orderId: string): Promise<BeginTenderOk | ServiceFailure> {
  try {
    return await begin(actor, orderId);
  } catch (err) {
    console.error("[tender] beginTender failed", err);
    return TENDER_NOT_BEGUN;
  }
}

async function begin(actor: TenderActor, orderId: string): Promise<BeginTenderOk | ServiceFailure> {
  const deps = getTenderDeps();
  if (!(await hasSessionToday(deps.now()))) {
    await deps.store.transaction((tx) =>
      tx.audit({
        entityKind: "order",
        entityId: orderId,
        action: "payment.tender_rejected",
        ...(actor.kind === "staff" ? { actorId: actor.staffId, actorRole: actor.role } : { actorRole: "system" }),
        reason: "no_session",
        after: { code: "NO_SESSION" },
      })
    );
    return { ok: false, code: "NO_SESSION", message: NO_SESSION_COPY };
  }
  const r = await beginTender(deps, actor, orderId);
  // beginTender's only TERMINAL_UNREACHABLE is "no webpos_device_id configured".
  if (!r.ok && r.code === "TERMINAL_UNREACHABLE") return { ...r, message: NO_TERMINAL_LINKED_COPY };
  if (r.ok || r.code !== "TENDER_IN_PROGRESS") return r;
  const attempts = await deps.store.transaction((tx) => tx.listPayments(orderId)); // ORDER BY attempt
  const open = attempts.filter(isAttemptOpen).pop();
  return open ? { ...r, openAttempt: { attempt: open.attempt, status: open.status, sent: open.sentAt !== null } } : r;
}

export async function sendTender(actor: TenderActor, orderId: string, attempt: number): Promise<SendToTerminalOk | TenderFailure> {
  const deps = getTenderDeps();
  const r = await sendToTerminal(deps, actor, orderId, attempt);
  if (!r.ok && r.code === "TERMINAL_UNREACHABLE" && deps.port === unlinkedWebPosPort) {
    return { ...r, message: NO_TERMINAL_LINKED_COPY };
  }
  return r;
}

export async function pollTender(actor: TenderActor, orderId: string, attempt: number): Promise<PollOk | TenderFailure> {
  return pollTenderResult(getTenderDeps(), actor, orderId, attempt);
}

export async function lookupTender(actor: TenderActor, orderId: string): Promise<ResolveOk | TenderFailure> {
  return resolveTenderByLookup(getTenderDeps(), actor, orderId);
}
