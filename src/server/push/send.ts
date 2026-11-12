// Send a Web Push notification — task G7
// Called when an order transitions to `ready` (see transitionOrder, G5).
//
// Delivery policy (PRD §6.1 + the dependency table): up to 3 attempts with
// exponential backoff (500 ms, then 1 s). A 404/410 is terminal — the
// subscription is gone, so there is no retry and the caller prunes it. Any
// other error is retried, then given up on WITHOUT throwing: a push failure
// must never reach the order transition (the queue board is the primary signal).

import webpush from "web-push";
import { initVapid } from "./vapid";
import {
  buildOrderReadyPayload,
  buildShiftStartPayload,
  type PushSubscriptionShape,
} from "./payload";

export const PUSH_MAX_ATTEMPTS = 3;
export const PUSH_BACKOFF_BASE_MS = 500;
// Worst case 3 x 2500 + 500 + 1000 = 9000 ms, inside REQ-047's 10 s.
export const PUSH_REQUEST_TIMEOUT_MS = 2500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * What actually happened to one payload: delivered, the subscription is gone
 * (404/410), or it was not delivered (a permanent client error, or every
 * attempt failed). Throws only if VAPID cannot be initialised.
 */
export type PushOutcome = "sent" | "gone" | "failed";

async function deliverOutcome(
  subscription: PushSubscriptionShape,
  payload: string
): Promise<PushOutcome> {
  initVapid();
  for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt++) {
    try {
      await webpush.sendNotification(subscription, payload, { timeout: PUSH_REQUEST_TIMEOUT_MS });
      return "sent";
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription expired/unsubscribed — terminal, signal the caller to prune.
        return "gone";
      }
      if (statusCode === 400 || statusCode === 403 || statusCode === 413) {
        // Permanent client error: retrying cannot help, but the subscription
        // is not known dead, so it is kept. Log the status only.
        console.error("[push] permanent push error, not retrying", { statusCode });
        return "failed";
      }
      if (attempt === PUSH_MAX_ATTEMPTS) {
        console.error("[push] giving up after retries", { statusCode, attempts: attempt });
        return "failed";
      }
      await sleep(PUSH_BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }
  return "failed";
}

/**
 * Deliver one payload. Returns false only when the subscription is gone
 * (404/410). Returns true on success AND when every attempt failed for a
 * transient reason (the subscription is not known to be dead, so it is kept).
 */
async function deliver(
  subscription: PushSubscriptionShape,
  payload: string
): Promise<boolean> {
  return (await deliverOutcome(subscription, payload)) !== "gone";
}

/**
 * Push an "order ready" notification to a single subscription.
 * Returns false if the subscription is gone (410/404) so the caller can prune it.
 * The payload carries the order id and the customer's first name only — never a
 * fund balance or ledger entry (REQ-165).
 */
export async function sendOrderReadyPush(
  subscription: PushSubscriptionShape,
  orderId: string,
  customerName?: string
): Promise<boolean> {
  const payload = JSON.stringify({ ...buildOrderReadyPayload(orderId, customerName), tag: "favo-order-ready" });
  return deliver(subscription, payload);
}

/**
 * Push a "cafe hours posted" notification to a single subscription.
 * Returns false if the subscription is gone (410/404) so the caller can prune it.
 */
export async function sendHoursPostedPush(
  subscription: PushSubscriptionShape,
  opensAt: string,
  closesAt: string,
  isClosed: boolean
): Promise<boolean> {
  const body = isClosed
    ? "FAVO is closed today."
    : `We're open ${opensAt} – ${closesAt} today.`;
  const payload = JSON.stringify({
    title: "FAVO hours posted ☕",
    body,
    // public/sw.js reads data.url — a top-level url is ignored.
    data: { url: "/customer" },
  });
  return deliver(subscription, payload);
}

/**
 * Push an "opening today" notification to a single subscription (AT-134).
 * `isReopening` = a later session on a day that already had one (the café
 * closed and is opening again).
 * Returns false if the subscription is gone (410/404) so the caller can prune it.
 */
export async function sendOpeningPush(
  subscription: PushSubscriptionShape,
  opensAt: string,
  isReopening: boolean
): Promise<boolean> {
  const payload = JSON.stringify({
    title: isReopening ? "FAVO is reopening ☕" : "FAVO is opening today ☕",
    body: isReopening
      ? `We're opening again at ${opensAt} — see you there.`
      : `We're opening at ${opensAt} today.`,
    data: { url: "/customer" },
    tag: "favo-opening",
  });
  return deliver(subscription, payload);
}

/**
 * Push the shift-start notification to a rostered barista (PRD §6.3, COL-23).
 * Returns the real outcome, so a send that gave up is never recorded as sent.
 */
export async function sendShiftStartPush(
  subscription: PushSubscriptionShape,
  opensAt: string
): Promise<PushOutcome> {
  return deliverOutcome(subscription, buildShiftStartPayload(opensAt));
}

/**
 * Push the timed shift-start reminder (§9.6.2 job 10, DEC-29). The payload is
 * built by buildShiftReminderPayload. Returns the real outcome.
 */
export async function sendShiftReminderPush(
  subscription: PushSubscriptionShape,
  payload: string
): Promise<PushOutcome> {
  return deliverOutcome(subscription, payload);
}

/**
 * Push the card-machine alert to an on-duty barista (PRD §9.6.3, REQ-068).
 * The payload is built by src/server/deferred/card-machine-alert.ts.
 * Returns the real outcome; the caller logs a failure, never throws it on.
 */
export async function sendCardMachineAlertPush(
  subscription: PushSubscriptionShape,
  payload: string
): Promise<PushOutcome> {
  return deliverOutcome(subscription, payload);
}
