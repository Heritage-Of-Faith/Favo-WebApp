// AT-201 part 2a: the card-tender chain (PRD v7.0 §6.8, §11.2, S2–S4, T2).
//
//   beginTender            allocate the attempt; the pending row exists BEFORE any send (P1, REQ-026/027)
//   sendToTerminal         send it once; persist Yoco's id at once (REQ-029); four outcomes, never conflated (REQ-010)
//   pollTenderResult       one status fetch per call, on S2's schedule; 180 s ceiling → unresolved (REQ-003)
//   recordTenderResult     WRITER 1 of payments.status (§10.2.1)
//   resolveTenderByLookup  WRITER 2 of payments.status (§10.2.1) — S4's recovery; never sends (REQ-008)
//
// payments.status is written ONLY through TenderTx.setPaymentStatus, and that
// is called only from recordTenderResult and resolveTenderByLookup (directly,
// or through attachSuccessful / flagDuplicate, which only they call).
// sendToTerminal and pollTenderResult reach a status change only by calling
// recordTenderResult. Nothing outside this module writes payments.status:
// AT-201 part 2b removed the two legacy writers (confirmManualPayment and the
// Yoco Online webhook, §11.1).
//
// Every state change writes an audit row in the same transaction, and every
// refusal is audited too — the functions RETURN their refusals rather than
// throwing, so the audit row commits (CLAUDE.md §5).
//
// None of this is a server action and none of it authenticates. The caller
// (part 2b) authorises the barista, or is job 4, and passes the actor.

import type { WebPosPayment, WebPosSendResult, YocoWebPosPort } from "@/server/yoco/webpos-port";
import {
  FETCH_RETRIES,
  MIN_SINCE_SEND_FOR_DECLINE_MS,
  SECOND_NEGATIVE_GAP_MS,
  TENDER_CEILING_MS,
  type LookupRead,
  type PaymentStatus,
  type TenderActor,
  type TenderDeps,
  type TenderErrorCode,
  type TenderFailure,
  type TenderOrder,
  type TenderPayment,
  type TenderResult,
  type TenderTx,
} from "./types";

// ─── copy (PRD §6.0 error table, verbatim where it gives copy) ────────────────

const COPY = {
  TENDER_IN_PROGRESS: "This order is at the card machine — finish or cancel the payment first",
  ALREADY_RESOLVED: "Already paid — do not charge again",
  TERMINAL_UNREACHABLE: "Card machine not responding — check it's on and on the wifi, or switch to deferred",
  GATEWAY_UNAVAILABLE: "Couldn't reach the card system — try again.",
  PAYMENT_DECLINED: "Card declined — try again or use another card.",
  PAYMENT_UNKNOWN: "We'll confirm this one shortly",
} as const;

// ─── small helpers ────────────────────────────────────────────────────────────

type Post = Array<() => Promise<void>>;

function actorFields(actor: TenderActor): { actorId?: string; actorRole: string } {
  return actor.kind === "staff" ? { actorId: actor.staffId, actorRole: actor.role } : { actorRole: "system" };
}

function fail(code: TenderErrorCode, message: string, retryOffered?: boolean): TenderFailure {
  return retryOffered === undefined ? { ok: false, code, message } : { ok: false, code, message, retryOffered };
}

/**
 * An attempt closed out without anything being sent (GATEWAY_UNAVAILABLE or
 * TERMINAL_UNREACHABLE): `unresolved`, with no sent_at and no Yoco id. It no
 * longer holds the order — §6.8.4: "the attempt is closed out and the order
 * stays unpaid and re-tenderable". Audited `payment.closed_never_sent`; no S4a
 * push, and resolveTenderByLookup does not look it up (sent_at is NULL).
 */
export function isClosedOutUnsent(p: Pick<TenderPayment, "status" | "sentAt" | "yocoPaymentId">): boolean {
  return p.status === "unresolved" && p.sentAt === null && p.yocoPaymentId === null;
}

/**
 * P4 / REQ-028: an attempt is open while it is `pending` or `unresolved`
 * (bar a closed-out unsent one). While one is open the order's total is frozen,
 * and beginTender answers TENDER_IN_PROGRESS. Part 2b's createOrder,
 * compOrderLine, applyFreeCoffee and cancelOrder use this same predicate.
 */
export function isAttemptOpen(p: Pick<TenderPayment, "status" | "sentAt" | "yocoPaymentId">): boolean {
  return p.status === "pending" || (p.status === "unresolved" && !isClosedOutUnsent(p));
}

/**
 * An `unresolved` payment that may hold money: something WAS sent (sent_at set).
 * This is the predicate for S4a's push, REQ-012's escalation, job 4's ageing
 * and S3a's `unresolved_at_close`. A closed-out never-sent attempt is excluded.
 */
export function isUnresolvedNeedingAttention(p: Pick<TenderPayment, "status" | "sentAt">): boolean {
  return p.status === "unresolved" && p.sentAt !== null;
}

async function runPost(post: Post): Promise<void> {
  for (const fn of post) {
    try {
      await fn();
    } catch (err) {
      // A failed push never undoes a recorded payment. Logged, not swallowed silently.
      console.error("[tender] admin notification failed", err);
    }
  }
}

async function lockAttempt(
  tx: TenderTx,
  orderId: string,
  attempt: number
): Promise<{ order: TenderOrder; payment: TenderPayment } | null> {
  const order = await tx.lockOrder(orderId);
  if (!order) return null;
  const payment = await tx.lockPayment(orderId, attempt);
  return payment ? { order, payment } : null;
}

// ─── (1) beginTender ──────────────────────────────────────────────────────────

export type BeginTenderOk = {
  ok: true;
  paymentId: string;
  attempt: number;
  clientReference: string;
  amountZar: number;
};

/**
 * T2 step 3. Serialised per order (SELECT … FOR UPDATE). Refuses an R0 order
 * (L42 / REQ-153: no payments row, nothing sent). attempt = MAX + 1;
 * client_reference = client_uuid:attempt; webpos_device_id read once, here.
 * The pending row it writes is what every later step needs before a send.
 */
export async function beginTender(
  deps: TenderDeps,
  actor: TenderActor,
  orderId: string
): Promise<BeginTenderOk | TenderFailure> {
  const at = deps.now();
  return deps.store.transaction(async (tx) => {
    const reject = async (code: TenderErrorCode, message: string, reason: string, after?: unknown) => {
      await tx.audit({
        entityKind: "order",
        entityId: orderId,
        action: "payment.tender_rejected",
        ...actorFields(actor),
        reason,
        after: after ?? { code },
      });
      return fail(code, message);
    };

    const order = await tx.lockOrder(orderId);
    if (!order) return reject("VALIDATION", "Order not found.", "order_not_found");
    if (order.state === "cancelled") return reject("VALIDATION", "This order is cancelled.", "order_cancelled");
    // AT-203 / §11.2: beginTender "rejects an order already settled from a fund".
    if (order.fundSettled === true) return reject("ALREADY_RESOLVED", COPY.ALREADY_RESOLVED, "settled_from_fund");
    if (!Number.isInteger(order.totalZar) || order.totalZar < 0) {
      return reject("VALIDATION", "The order total is not whole cents.", "total_not_integer_cents");
    }
    if (order.totalZar === 0) {
      return reject("VALIDATION", "Nothing to charge — the order's net charge is R0 (L42).", "no_net_charge");
    }

    const attempts = await tx.listPayments(orderId);
    if (attempts.some((p) => p.status === "successful")) {
      return reject("ALREADY_RESOLVED", COPY.ALREADY_RESOLVED, "already_paid");
    }
    const open = attempts.find(isAttemptOpen);
    if (open) {
      return reject("TENDER_IN_PROGRESS", COPY.TENDER_IN_PROGRESS, "tender_in_progress", {
        code: "TENDER_IN_PROGRESS",
        openAttempt: open.attempt,
        openStatus: open.status,
      });
    }

    // REQ-065: read once, here, and never again for this attempt.
    const deviceId = (await deps.readDeviceId())?.trim() ?? "";
    if (deviceId === "") {
      return reject("TERMINAL_UNREACHABLE", COPY.TERMINAL_UNREACHABLE, "no_webpos_device_configured");
    }

    const attempt = attempts.reduce((max, p) => Math.max(max, p.attempt), 0) + 1;
    const clientReference = `${order.clientUuid}:${attempt}`;
    const row = await tx.insertPayment({
      orderId,
      attempt,
      clientReference,
      webposDeviceId: deviceId,
      amountZar: order.totalZar,
      at,
    });
    await tx.audit({
      entityKind: "payment",
      entityId: row.id,
      action: "payment.tender_begun",
      ...actorFields(actor),
      after: { orderId, attempt, clientReference, amountZar: order.totalZar, webposDeviceId: deviceId, status: "pending" },
    });
    return { ok: true, paymentId: row.id, attempt, clientReference, amountZar: order.totalZar };
  });
}

// ─── (2) sendToTerminal ───────────────────────────────────────────────────────

export type SendToTerminalOk = { ok: true; yocoPaymentId: string; sentAt: Date };

/**
 * T2 step 4. Claims the attempt (sent_at) inside a locked transaction, so a
 * second call for the same (orderId, attempt) is VALIDATION, never a re-send.
 * Then, outside any transaction, looks the device up and sends once.
 *   sent                → yoco_payment_id persisted at once
 *   timeout / a throw   → PAYMENT_UNKNOWN; unresolved; never re-sent
 *   gateway_unavailable → GATEWAY_UNAVAILABLE, retry offered; attempt closed out
 *   device_error        → TERMINAL_UNREACHABLE; attempt closed out
 */
export async function sendToTerminal(
  deps: TenderDeps,
  actor: TenderActor,
  orderId: string,
  attempt: number
): Promise<SendToTerminalOk | TenderFailure> {
  const sentAt = deps.now();
  const claimed = await deps.store.transaction(async (tx) => {
    const locked = await lockAttempt(tx, orderId, attempt);
    if (!locked) {
      await tx.audit({
        entityKind: "order",
        entityId: orderId,
        action: "payment.send_rejected",
        ...actorFields(actor),
        reason: "no_such_attempt",
        after: { attempt },
      });
      return fail("VALIDATION", "No such tender attempt.");
    }
    const p = locked.payment;
    if (p.status !== "pending" || p.sentAt !== null || p.yocoPaymentId !== null) {
      await tx.audit({
        entityKind: "payment",
        entityId: p.id,
        action: "payment.send_rejected",
        ...actorFields(actor),
        reason: "second_send_refused",
        before: { status: p.status, sentAt: p.sentAt?.toISOString() ?? null, yocoPaymentId: p.yocoPaymentId },
      });
      return fail("VALIDATION", "This attempt has already been sent. An attempt is never sent twice.");
    }
    await tx.updatePayment(p.id, { sentAt });
    await tx.audit({
      entityKind: "payment",
      entityId: p.id,
      action: "payment.send_claimed",
      ...actorFields(actor),
      after: { sentAt: sentAt.toISOString() },
    });
    return { ok: true as const, payment: p };
  });
  if (!claimed.ok) return claimed;
  const p = claimed.payment;

  const closeOut = async (code: "GATEWAY_UNAVAILABLE" | "TERMINAL_UNREACHABLE") => {
    const r = await recordTenderResult(deps, actor, orderId, attempt, { kind: "not_sent", code });
    if (!r.ok && r.code !== code) return r;
    return code === "GATEWAY_UNAVAILABLE"
      ? fail("GATEWAY_UNAVAILABLE", COPY.GATEWAY_UNAVAILABLE, true)
      : fail("TERMINAL_UNREACHABLE", COPY.TERMINAL_UNREACHABLE, false);
  };

  // §6.8.2: the device is looked up before each send.
  const device = await deps.port.lookupDevice(p.webposDeviceId).catch(() => ({ kind: "fetch_error" as const }));
  if (device.kind === "device_error") return closeOut("TERMINAL_UNREACHABLE");
  if (device.kind === "fetch_error") return closeOut("GATEWAY_UNAVAILABLE");

  let sent: WebPosSendResult;
  try {
    sent = await deps.port.sendPayment({
      deviceId: p.webposDeviceId,
      amountZar: p.amountZar,
      clientReference: p.clientReference,
    });
  } catch {
    // An exception mid-send cannot establish the outcome: a payment may exist.
    sent = { kind: "timeout" };
  }

  switch (sent.kind) {
    case "sent": {
      const yocoPaymentId = sent.yocoPaymentId;
      await deps.store.transaction(async (tx) => {
        await tx.lockOrder(orderId);
        await tx.updatePayment(p.id, { yocoPaymentId });
        await tx.audit({
          entityKind: "payment",
          entityId: p.id,
          action: "payment.sent",
          ...actorFields(actor),
          after: { yocoPaymentId, sentAt: sentAt.toISOString() },
        });
      });
      return { ok: true, yocoPaymentId, sentAt };
    }
    case "timeout": {
      const r = await recordTenderResult(deps, actor, orderId, attempt, { kind: "unresolved", cause: "send_timeout" });
      if (!r.ok && r.code !== "PAYMENT_UNKNOWN") return r;
      return fail("PAYMENT_UNKNOWN", COPY.PAYMENT_UNKNOWN);
    }
    case "gateway_unavailable":
      return closeOut("GATEWAY_UNAVAILABLE");
    case "device_error":
      return closeOut("TERMINAL_UNREACHABLE");
  }
}

// ─── (3) pollTenderResult ─────────────────────────────────────────────────────

export type PollOk = { ok: true; status: PaymentStatus; fetchError?: true };

async function fetchWithRetry(port: YocoWebPosPort, yocoPaymentId: string) {
  let last = await port.fetchPayment(yocoPaymentId).catch(() => ({ kind: "fetch_error" as const }));
  for (let i = 0; i < FETCH_RETRIES && last.kind === "fetch_error"; i++) {
    last = await port.fetchPayment(yocoPaymentId).catch(() => ({ kind: "fetch_error" as const }));
  }
  return last;
}

function statusAnswer(status: PaymentStatus): PollOk | TenderFailure {
  if (status === "declined") return fail("PAYMENT_DECLINED", COPY.PAYMENT_DECLINED);
  if (status === "unresolved") return fail("PAYMENT_UNKNOWN", COPY.PAYMENT_UNKNOWN);
  return { ok: true, status };
}

/**
 * T2 step 5. One fetch per call — the caller drives S2's schedule (2 s, then
 * 5 s). Writes last_checked_at. Returns the status unchanged and never reads
 * an error as a status. At 180 s from the send it stops waiting: unresolved,
 * PAYMENT_UNKNOWN, and no cancel is attempted (REQ-003).
 */
export async function pollTenderResult(
  deps: TenderDeps,
  actor: TenderActor,
  orderId: string,
  attempt: number
): Promise<PollOk | TenderFailure> {
  const now = deps.now();
  const locked = await deps.store.transaction(async (tx) => {
    const l = await lockAttempt(tx, orderId, attempt);
    if (!l || (l.payment.status === "pending" && l.payment.sentAt === null)) {
      await tx.audit({
        entityKind: l ? "payment" : "order",
        entityId: l ? l.payment.id : orderId,
        action: "payment.poll_rejected",
        ...actorFields(actor),
        reason: l ? "not_sent" : "no_such_attempt",
        after: { attempt },
      });
    }
    return l;
  });
  if (!locked) return fail("VALIDATION", "No such tender attempt.");
  const p = locked.payment;
  if (p.status !== "pending") return statusAnswer(p.status);
  if (p.sentAt === null) return fail("VALIDATION", "This attempt has not been sent.");

  if (now.getTime() - p.sentAt.getTime() >= TENDER_CEILING_MS) {
    const r = await recordTenderResult(deps, actor, orderId, attempt, { kind: "unresolved", cause: "ceiling" });
    return r.ok ? statusAnswer(r.status) : r;
  }
  // Mid-send, the id is not yet back. Keep waiting; the ceiling still applies.
  if (p.yocoPaymentId === null) return { ok: true, status: "pending" };

  const read = await fetchWithRetry(deps.port, p.yocoPaymentId);
  await deps.store.transaction(async (tx) => {
    await tx.lockOrder(orderId);
    await tx.updatePayment(p.id, { lastCheckedAt: now });
  });

  if (
    read.kind !== "found" ||
    read.payment.yocoPaymentId !== p.yocoPaymentId ||
    read.payment.clientReference !== p.clientReference
  ) {
    return { ok: true, status: "pending", fetchError: true };
  }
  if (read.payment.status === "pending") return { ok: true, status: "pending" };
  const r = await recordTenderResult(deps, actor, orderId, attempt, { kind: "read", payment: read.payment });
  return r.ok ? statusAnswer(r.status) : r;
}

// ─── shared by the two writers only ───────────────────────────────────────────

async function flagDuplicate(
  tx: TenderTx,
  actor: TenderActor,
  orderId: string,
  paymentId: string,
  yocoPaymentIds: string[],
  amountZar: number,
  deps: TenderDeps,
  post: Post
): Promise<void> {
  const after = { yocoPaymentIds, amountZar };
  await tx.audit({ entityKind: "order", entityId: orderId, action: "order.flagged", ...actorFields(actor), reason: "duplicate_charge", after });
  await tx.audit({ entityKind: "payment", entityId: paymentId, action: "payment.flagged", ...actorFields(actor), reason: "duplicate_charge", after });
  post.push(() => deps.notify.duplicateCharge({ orderId, yocoPaymentIds, amountZar }));
}

/**
 * Attach a payment Yoco reports `successful`. Called only by
 * recordTenderResult and resolveTenderByLookup.
 *   - The order already has a successful attempt → a double charge has
 *     happened: this row keeps `unresolved` (the unique index forbids a second
 *     successful row) carrying what Yoco charged, and duplicate_charge is
 *     flagged and pushed (REQ-011, §6.8.4).
 *   - Otherwise `successful`, at the CHARGED amount; charged ≠ orders.total_zar
 *     (plain integer cents, no factor) is flagged, never overwritten (REQ-030).
 */
async function attachSuccessful(
  tx: TenderTx,
  actor: TenderActor,
  order: TenderOrder,
  p: TenderPayment,
  pays: WebPosPayment[],
  via: "poll" | "lookup",
  deps: TenderDeps,
  post: Post
): Promise<{ status: PaymentStatus; flags: string[] }> {
  // `pays`: every successful payment Yoco holds on this attempt's reference.
  // pays[0] is the one attached; any more is a double charge on one reference.
  const pay = pays[0];
  const charged = pay.chargedAmountZar as number;
  const patch = {
    ...(p.yocoPaymentId === null ? { yocoPaymentId: pay.yocoPaymentId } : {}),
    chargedAmountZar: charged,
    tipZar: pay.tipZar,
  };
  const others = (await tx.listPayments(order.id)).filter((x) => x.id !== p.id && x.status === "successful");
  if (others.length > 0) {
    // Idempotent: job 4 re-reading the same duplicate flags and pushes nothing new.
    const alreadyFlagged =
      p.status === "unresolved" && p.chargedAmountZar !== null && p.yocoPaymentId === pay.yocoPaymentId;
    if (alreadyFlagged) return { status: p.status, flags: ["duplicate_charge"] };
    await tx.setPaymentStatus(p.id, "unresolved", patch);
    await tx.audit({
      entityKind: "payment",
      entityId: p.id,
      action: "payment.unresolved",
      ...actorFields(actor),
      reason: "duplicate_charge",
      before: { status: p.status },
      after: { status: "unresolved", ...patch, via },
    });
    const ids = [...others.map((x) => x.yocoPaymentId ?? `attempt:${x.attempt}`), ...pays.map((x) => x.yocoPaymentId)];
    await flagDuplicate(tx, actor, order.id, p.id, ids, charged, deps, post);
    return { status: "unresolved", flags: ["duplicate_charge"] };
  }
  if (pays.length > 1) {
    // Two successful on ONE reference: attach the first, flag once. Next run
    // this row is `successful`, so it is no longer a lookup candidate.
    await flagDuplicate(tx, actor, order.id, p.id, pays.map((x) => x.yocoPaymentId), charged, deps, post);
  }

  await tx.setPaymentStatus(p.id, "successful", patch);
  await tx.audit({
    entityKind: "payment",
    entityId: p.id,
    action: "payment.successful",
    ...actorFields(actor),
    before: { status: p.status },
    after: { status: "successful", ...patch, via },
  });
  const flags: string[] = [];
  if (charged !== order.totalZar) {
    flags.push("amount_mismatch");
    await tx.audit({
      entityKind: "payment",
      entityId: p.id,
      action: "payment.flagged",
      ...actorFields(actor),
      reason: "amount_mismatch",
      after: { orderTotalZar: order.totalZar, amountZar: p.amountZar, chargedAmountZar: charged },
    });
  }
  if (pay.tipZar !== 0) {
    flags.push("tip_variance");
    await tx.audit({
      entityKind: "payment",
      entityId: p.id,
      action: "payment.flagged",
      ...actorFields(actor),
      reason: "tip_variance",
      after: { tipZar: pay.tipZar },
    });
  }
  return { status: "successful", flags };
}

// ─── (3b) recordTenderResult — WRITER 1 ───────────────────────────────────────

export type RecordOk = { ok: true; status: PaymentStatus; flags: string[] };

/**
 * T2 step 6. Moves a `pending` attempt to its outcome:
 *   read successful → attachSuccessful (successful, or unresolved + duplicate_charge)
 *   read failed     → declined; the order is untouched and stays `ordered` (REQ-004)
 *   unresolved      → unresolved + S4a push (ceiling, or a send that timed out)
 *   not_sent        → closed out: unresolved, sent_at cleared (nothing was sent)
 * Idempotent on (orderId, attempt): the same outcome again writes nothing.
 * Any other transition is refused and audited.
 *
 * `read` results must come from the server's own fetch through the port —
 * part 2b must never expose this with a client-supplied result.
 */
export async function recordTenderResult(
  deps: TenderDeps,
  actor: TenderActor,
  orderId: string,
  attempt: number,
  result: TenderResult
): Promise<RecordOk | TenderFailure> {
  const post: Post = [];
  const out = await deps.store.transaction(async (tx): Promise<RecordOk | TenderFailure> => {
    const locked = await lockAttempt(tx, orderId, attempt);
    const reject = async (entityKind: "order" | "payment", entityId: string, reason: string, before?: unknown) => {
      await tx.audit({
        entityKind,
        entityId,
        action: "payment.result_rejected",
        ...actorFields(actor),
        reason,
        before,
        after: { attempt, result: result.kind === "read" ? result.payment.status : result.kind },
      });
      return fail("VALIDATION", "That result cannot be recorded against this attempt.");
    };
    if (!locked) return reject("order", orderId, "no_such_attempt");
    const { order, payment: p } = locked;

    const target: PaymentStatus | null =
      result.kind === "read"
        ? result.payment.status === "successful"
          ? "successful"
          : result.payment.status === "failed"
            ? "declined"
            : null
        : "unresolved";
    if (target === null) return reject("payment", p.id, "pending_is_not_a_result");

    if (result.kind === "read" && result.payment.clientReference !== p.clientReference) {
      return reject("payment", p.id, "client_reference_mismatch");
    }
    if (result.kind === "read" && p.yocoPaymentId !== null && result.payment.yocoPaymentId !== p.yocoPaymentId) {
      return reject("payment", p.id, "yoco_payment_id_mismatch");
    }

    if (p.status !== "pending") {
      const sameRead =
        result.kind !== "read" || p.yocoPaymentId === null || p.yocoPaymentId === result.payment.yocoPaymentId;
      if (p.status === target && sameRead && !(result.kind === "not_sent" && !isClosedOutUnsent(p))) {
        return { ok: true, status: p.status, flags: [] }; // idempotent replay: nothing written
      }
      return reject("payment", p.id, `transition_refused:${p.status}->${target}`, { status: p.status });
    }

    if (result.kind === "read" && result.payment.status === "successful") {
      const charged = result.payment.chargedAmountZar;
      if (charged === null || !Number.isInteger(charged) || !Number.isInteger(result.payment.tipZar)) {
        return reject("payment", p.id, "charged_amount_not_integer_cents");
      }
      const r = await attachSuccessful(tx, actor, order, p, [result.payment], "poll", deps, post);
      return { ok: true, ...r };
    }

    if (result.kind === "read") {
      // failed → declined. The order row is not written: it stays `ordered`
      // with its queue position and bound target (S3, REQ-004).
      await tx.setPaymentStatus(p.id, "declined");
      await tx.audit({
        entityKind: "payment",
        entityId: p.id,
        action: "payment.declined",
        ...actorFields(actor),
        before: { status: p.status },
        after: { status: "declined" },
      });
      return fail("PAYMENT_DECLINED", COPY.PAYMENT_DECLINED);
    }

    if (result.kind === "unresolved") {
      await tx.setPaymentStatus(p.id, "unresolved");
      await tx.audit({
        entityKind: "payment",
        entityId: p.id,
        action: "payment.unresolved",
        ...actorFields(actor),
        reason: result.cause,
        before: { status: p.status },
        after: { status: "unresolved" },
      });
      post.push(() =>
        deps.notify.paymentUnresolved({ orderId, attempt, amountZar: p.amountZar, cause: result.cause })
      );
      return fail("PAYMENT_UNKNOWN", COPY.PAYMENT_UNKNOWN);
    }

    // not_sent: closed out never-sent — `unresolved` (the enum has no
    // closed-out value), sent_at back to NULL because nothing was sent (the
    // claim set it). NO S4a push: nothing can have been charged, so it is not
    // "unresolved needing attention" (isUnresolvedNeedingAttention) and does
    // not count toward REQ-012's escalation or job 4's ageing.
    await tx.setPaymentStatus(p.id, "unresolved", { sentAt: null });
    await tx.audit({
      entityKind: "payment",
      entityId: p.id,
      action: "payment.closed_never_sent",
      ...actorFields(actor),
      reason: result.code,
      before: { status: p.status, sentAt: p.sentAt?.toISOString() ?? null },
      after: { status: "unresolved", sentAt: null },
    });
    return fail(result.code, result.code === "GATEWAY_UNAVAILABLE" ? COPY.GATEWAY_UNAVAILABLE : COPY.TERMINAL_UNREACHABLE);
  });
  await runPost(post);
  return out;
}

// ─── (4) resolveTenderByLookup — WRITER 2 ─────────────────────────────────────

export type LookupOutcome = { attempt: number; read: LookupRead | "skipped"; status: PaymentStatus };
export type ResolveOk = { ok: true; attempts: LookupOutcome[] };

type Reads = { kind: "found"; payments: WebPosPayment[] } | { kind: "not_found" } | { kind: "fetch_error" };

async function readForLookup(port: YocoWebPosPort, p: TenderPayment): Promise<Reads> {
  if (p.yocoPaymentId !== null) {
    const r = await fetchWithRetry(port, p.yocoPaymentId);
    return r.kind === "found" ? { kind: "found", payments: [r.payment] } : r;
  }
  // No id held (a timed-out send): by client_reference.
  const r = await port.findPaymentsByClientReference(p.clientReference).catch(() => ({ kind: "fetch_error" as const }));
  if (r.kind === "fetch_error") return r;
  return r.payments.length === 0 ? { kind: "not_found" } : r;
}

/**
 * S4's recovery (§11.2). For every pending and unresolved attempt on the
 * order, asks Yoco — by yoco_payment_id where FAVO holds one, by
 * client_reference where it does not — and records exactly what Yoco says:
 *   successful → attachSuccessful; two successful → duplicate_charge (REQ-011)
 *   failed     → declined ONLY on S4 step 3's two negatives: this read and the
 *                previous lookup both `failed`, ≥ 60 s apart, ≥ 120 s after the send
 *   anything else (pending, not found, a fetch error) → unchanged
 * It NEVER sends a payment (REQ-008). Callable by a barista or by job 4.
 */
export async function resolveTenderByLookup(
  deps: TenderDeps,
  actor: TenderActor,
  orderId: string
): Promise<ResolveOk | TenderFailure> {
  const now = deps.now();
  const attempts = await deps.store.transaction(async (tx) => {
    const order = await tx.lockOrder(orderId);
    if (!order) {
      await tx.audit({
        entityKind: "order",
        entityId: orderId,
        action: "payment.lookup_rejected",
        ...actorFields(actor),
        reason: "order_not_found",
      });
      return null;
    }
    return tx.listPayments(orderId);
  });
  if (!attempts) return fail("VALIDATION", "Order not found.");

  // Candidates: pending or unresolved attempts that WERE sent. A never-sent
  // row (sent_at NULL — closed out, or begun and never sent) cannot hold money
  // and is not looked up, so job 4 never loops on its not_found.
  const candidates = attempts.filter((p) => (p.status === "pending" || p.status === "unresolved") && p.sentAt !== null);
  const outcomes: LookupOutcome[] = [];
  for (const c of candidates) {
    const reads = await readForLookup(deps.port, c);
    const post: Post = [];
    const outcome = await deps.store.transaction(async (tx): Promise<LookupOutcome> => {
      const locked = await lockAttempt(tx, orderId, c.attempt);
      if (!locked || (locked.payment.status !== "pending" && locked.payment.status !== "unresolved")) {
        return { attempt: c.attempt, read: "skipped", status: locked?.payment.status ?? c.status };
      }
      const { order, payment: p } = locked;

      // Only a payment carrying THIS attempt's reference (and id, if held)
      // counts. Anything else is not evidence about this attempt.
      const all = reads.kind === "found" ? reads.payments : [];
      const matched = all.filter(
        (x) => x.clientReference === p.clientReference && (p.yocoPaymentId === null || x.yocoPaymentId === p.yocoPaymentId)
      );
      const usable = matched.filter(
        (x) => x.status !== "successful" || (x.chargedAmountZar !== null && Number.isInteger(x.chargedAmountZar) && Number.isInteger(x.tipZar))
      );
      const successes = usable.filter((x) => x.status === "successful");

      let read: LookupRead;
      let status: PaymentStatus = p.status;
      if (successes.length > 0) {
        read = "successful";
        const r = await attachSuccessful(tx, actor, order, p, successes, "lookup", deps, post);
        status = r.status;
      } else if (usable.some((x) => x.status === "failed")) {
        read = "failed";
        const prev = await tx.lastLookupRead(p.id);
        const twoNegatives =
          prev !== null &&
          prev.read === "failed" &&
          now.getTime() - prev.at.getTime() >= SECOND_NEGATIVE_GAP_MS &&
          p.sentAt !== null &&
          now.getTime() - p.sentAt.getTime() >= MIN_SINCE_SEND_FOR_DECLINE_MS;
        if (twoNegatives) {
          await tx.setPaymentStatus(p.id, "declined");
          await tx.audit({
            entityKind: "payment",
            entityId: p.id,
            action: "payment.declined",
            ...actorFields(actor),
            reason: "s4_two_negatives",
            before: { status: p.status },
            after: { status: "declined", previousFailedReadAt: prev.at.toISOString() },
          });
          status = "declined";
        }
      } else if (usable.some((x) => x.status === "pending")) {
        read = "pending";
      } else if (reads.kind === "fetch_error" || all.length > 0) {
        // A fetch error, or only payments that are not this attempt's: never a status.
        read = "fetch_error";
      } else {
        read = "not_found";
      }

      // REQ-003 on the lookup path: still `pending` 180 s after the send →
      // FAVO stops waiting; unresolved, with S4a's push (§11.2 "leaves
      // everything else unresolved").
      if (status === "pending" && p.sentAt !== null && now.getTime() - p.sentAt.getTime() >= TENDER_CEILING_MS) {
        await tx.setPaymentStatus(p.id, "unresolved");
        await tx.audit({
          entityKind: "payment",
          entityId: p.id,
          action: "payment.unresolved",
          ...actorFields(actor),
          reason: "ceiling",
          before: { status: p.status },
          after: { status: "unresolved", via: "lookup" },
        });
        post.push(() =>
          deps.notify.paymentUnresolved({ orderId, attempt: p.attempt, amountZar: p.amountZar, cause: "ceiling" })
        );
        status = "unresolved";
      }

      await tx.updatePayment(p.id, { lastCheckedAt: now });
      await tx.audit({
        entityKind: "payment",
        entityId: p.id,
        action: "payment.lookup",
        ...actorFields(actor),
        after: { read, at: now.toISOString(), yocoPaymentIds: matched.map((x) => x.yocoPaymentId), status },
      });
      return { attempt: c.attempt, read, status };
    });
    await runPost(post);
    outcomes.push(outcome);
  }
  return { ok: true, attempts: outcomes };
}
