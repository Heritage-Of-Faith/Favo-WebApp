// settleDeferredOrder(orderId, ref?) — PRD v7.0 §6.0.4 T3 steps 3a/3b, §6.7
// paths A and B, §11.2 catalogue row, §11.3 matrix (barista ✔, admin ✔,
// system ✖), S1 ALREADY_RESOLVED.
//
//   1. Refuse an order that is not deferred, cancelled, already settled or
//      written off (S1: ALREADY_RESOLVED "The order is already settled or
//      written off").
//   2. "Query before sending. Fetches the status of every payment this order
//      has already created" — resolveTenderByLookup, the chain's WRITER 2. Any
//      `successful` → refused ALREADY_RESOLVED, that payment attached (the
//      attach stamps settled_at, tender.ts). An attempt still open (sent and
//      not resolved by S4's two negatives) → TENDER_IN_PROGRESS; nothing new.
//   3a. No ref → a NEW attempt through beginTender. The screen then runs the
//       existing sendToTerminal · pollTenderResult chain; a `successful` read
//       stamps settled_at inside recordTenderResult's attach.
//   3b. A ref → the standalone machine was used: settled_at + settlement_ref on
//       the ORDER, audited. No payments row is written and payments.status is
//       never touched — §10.2.1 allows exactly two writers of `successful`.
//
// The guard is the query, not FAVO's own rows ("the entire reason a deferred
// order exists is that FAVO's record may be wrong"). Every refusal is audited
// and returned, never thrown (CLAUDE.md §5). Not authenticated here.

import {
  DEFERRED_SETTLED_ACTION,
  beginTender,
  isAttemptOpen,
  resolveTenderByLookup,
} from "@/server/tender/tender";
import type { TenderActor, TenderDeps, TenderErrorCode, TenderFailure } from "@/server/tender/types";

/** S1 ALREADY_RESOLVED, verbatim. */
export const ALREADY_PAID = "Already paid — do not charge again";
/** P4 / S1 TENDER_IN_PROGRESS, verbatim. */
export const AT_THE_MACHINE = "This order is at the card machine — finish or cancel the payment first";
/** VALIDATION, field-level. Not PRD copy: the PRD gives none. */
export const NOT_DEFERRED = "Only an order taken in deferred mode is settled here.";
/** VALIDATION, field-level. Not PRD copy: the PRD gives none. */
export const REF_REQUIRED = "Enter the slip's reference — at least 4 characters.";
/** VALIDATION, field-level. Not PRD copy: the PRD gives none. */
export const REF_IN_USE = "This reference is already on another order — check the slip.";

/** Path B's reference must carry at least this many non-space characters (owner decision). */
export const MIN_REF_CHARS = 4;

/** Trim and collapse inner whitespace; null for no reference (path A). */
export function normaliseSettlementRef(ref: string | null | undefined): string | null {
  if (ref === undefined || ref === null) return null;
  return ref.trim().replace(/\s+/g, " ");
}

function refLongEnough(ref: string): boolean {
  return ref.replace(/\s/g, "").length >= MIN_REF_CHARS;
}

function isRefUniqueViolation(err: unknown): boolean {
  const text = (e: unknown): string =>
    e && typeof e === "object" ? `${(e as { message?: unknown }).message ?? ""} ${(e as { constraint_name?: unknown }).constraint_name ?? ""} ${(e as { constraint?: unknown }).constraint ?? ""}` : String(e);
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return /orders_settlement_ref_unique/.test(text(err) + " " + text(cause));
}

export type SettleStandaloneOk = { ok: true; path: "standalone"; settledAt: Date; settlementRef: string };
export type SettleCardOk = { ok: true; path: "card"; attempt: number; amountZar: number };
export type SettleFailure = TenderFailure & { settledAt?: Date | null };

function actorFields(actor: TenderActor): { actorId?: string; actorRole: string } {
  return actor.kind === "staff" ? { actorId: actor.staffId, actorRole: actor.role } : { actorRole: "system" };
}

export async function settleDeferredOrder(
  deps: TenderDeps,
  actor: TenderActor,
  orderId: string,
  ref?: string | null
): Promise<SettleStandaloneOk | SettleCardOk | SettleFailure> {
  const settlementRef = normaliseSettlementRef(ref);

  // A refusal: audited in its own transaction, then returned.
  const refuse = async (
    code: TenderErrorCode,
    message: string,
    reason: string,
    extra: { settledAt?: Date | null } = {}
  ): Promise<SettleFailure> => {
    await deps.store.transaction((tx) =>
      tx.audit({
        entityKind: "order",
        entityId: orderId,
        action: "order.settle_rejected",
        ...actorFields(actor),
        reason,
        after: { code, path: settlementRef === null ? "card" : "standalone", settledAt: extra.settledAt?.toISOString() ?? null },
      })
    );
    return { ok: false, code, message, ...extra };
  };

  if (settlementRef !== null && !refLongEnough(settlementRef)) {
    return refuse("VALIDATION", REF_REQUIRED, "settlement_ref_too_short");
  }

  // 1. The order itself.
  const order = await deps.store.transaction((tx) => tx.lockOrder(orderId));
  if (!order) return refuse("VALIDATION", "Order not found.", "order_not_found");
  if (order.deferred !== true) return refuse("VALIDATION", NOT_DEFERRED, "not_deferred");
  if (order.state === "cancelled") return refuse("VALIDATION", "This order is cancelled.", "order_cancelled");
  if (order.settledAt) return refuse("ALREADY_RESOLVED", ALREADY_PAID, "already_settled", { settledAt: order.settledAt });
  if (order.writtenOff === true) return refuse("ALREADY_RESOLVED", ALREADY_PAID, "order_written_off");
  if (order.fundSettled === true) return refuse("ALREADY_RESOLVED", ALREADY_PAID, "settled_from_fund");

  // 2. Query before sending — every attempt this order has created (T3 3a).
  const looked = await resolveTenderByLookup(deps, actor, orderId);
  if (!looked.ok) return looked;

  // 3. Decide on what is now recorded, under the order lock.
  const now = deps.now();
  type Next = { kind: "card" } | { kind: "done"; settledAt: Date; amountZar: number } | { kind: "refused"; f: SettleFailure };
  let next: Next;
  try {
    next = await decide();
  } catch (err) {
    // Two settles racing on one slip: the partial UNIQUE index refused the second.
    if (!isRefUniqueViolation(err)) throw err;
    return refuse("VALIDATION", REF_IN_USE, "settlement_ref_in_use");
  }

  if (next.kind === "refused") return next.f;
  if (next.kind === "done") {
    // §6.7 path B accountability: every standalone settle is pushed to the Admin,
    // after the commit. A failed push never undoes the settle (the audit row stands).
    try {
      await deps.notify.standaloneSettled?.({
        orderId,
        amountZar: next.amountZar,
        settlementRef: settlementRef as string,
        staffId: actor.kind === "staff" ? actor.staffId : null,
      });
    } catch (err) {
      console.error("[deferred] standalone-settle push failed", err);
    }
    return { ok: true, path: "standalone", settledAt: next.settledAt, settlementRef: settlementRef as string };
  }

  // 3a. Path A: a fresh attempt. beginTender re-checks everything under its own
  // lock — including settled_at, so a path B settle that committed in between
  // is refused ALREADY_RESOLVED rather than charged twice.
  const begun = await beginTender(deps, actor, orderId);
  if (!begun.ok) return begun;
  return { ok: true, path: "card", attempt: begun.attempt, amountZar: begun.amountZar };

  async function decide(): Promise<Next> {
  return deps.store.transaction(async (tx): Promise<Next> => {
    const reject = async (code: TenderErrorCode, message: string, reason: string, settledAt?: Date | null): Promise<Next> => {
      await tx.audit({
        entityKind: "order",
        entityId: orderId,
        action: "order.settle_rejected",
        ...actorFields(actor),
        reason,
        after: { code, path: settlementRef === null ? "card" : "standalone", settledAt: settledAt?.toISOString() ?? null },
      });
      return { kind: "refused", f: { ok: false, code, message, ...(settledAt !== undefined ? { settledAt } : {}) } };
    };
    const o = await tx.lockOrder(orderId);
    if (!o) return reject("VALIDATION", "Order not found.", "order_not_found");
    // Re-checked under the lock: the order may have been cancelled or written
    // off since the first read (the lookup runs between the two).
    if (o.state === "cancelled") return reject("VALIDATION", "This order is cancelled.", "order_cancelled");
    if (o.writtenOff === true) return reject("ALREADY_RESOLVED", ALREADY_PAID, "order_written_off");
    const attempts = await tx.listPayments(orderId);
    if (attempts.some((p) => p.status === "successful")) {
      // The lookup (or an earlier poll) attached it; that attach stamped settled_at.
      return reject("ALREADY_RESOLVED", ALREADY_PAID, "already_paid", o.settledAt ?? null);
    }
    if (o.settledAt) return reject("ALREADY_RESOLVED", ALREADY_PAID, "already_settled", o.settledAt);
    if (attempts.some(isAttemptOpen)) {
      // S4 step 3: no new send — and no standalone settle either — while an
      // attempt that may hold money is unresolved.
      return reject("TENDER_IN_PROGRESS", AT_THE_MACHINE, "attempt_open");
    }
    if (settlementRef === null) return { kind: "card" };

    // 3b. Path B: the standalone machine's reference, on the order. One slip
    // settles one order (the partial UNIQUE index backs this check).
    if (!tx.markOrderSettled) throw new Error("settleDeferredOrder: the store cannot settle an order");
    if (tx.settlementRefTaken && (await tx.settlementRefTaken(settlementRef, orderId))) {
      return reject("VALIDATION", REF_IN_USE, "settlement_ref_in_use");
    }
    await tx.markOrderSettled(orderId, now, settlementRef);
    await tx.audit({
      entityKind: "order",
      entityId: orderId,
      action: DEFERRED_SETTLED_ACTION,
      ...actorFields(actor),
      before: { settledAt: null, settlementRef: null },
      after: { settledAt: now.toISOString(), settlementRef, path: "standalone", amountZar: o.totalZar },
    });
    return { kind: "done", settledAt: now, amountZar: o.totalZar };
  });
  }
}
