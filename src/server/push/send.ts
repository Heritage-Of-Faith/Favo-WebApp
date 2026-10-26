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
  type PushSubscriptionShape,
} from "./payload";

export const PUSH_MAX_ATTEMPTS = 3;
export const PUSH_BACKOFF_BASE_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Deliver one payload. Returns false only when the subscription is gone
 * (404/410). Returns true on success AND when every attempt failed for a
 * transient reason (the subscription is not known to be dead, so it is kept).
 */
async function deliver(
  subscription: PushSubscriptionShape,
  payload: string
): Promise<boolean> {
  initVapid();
  for (let attempt = 1; attempt <= PUSH_MAX_ATTEMPTS; attempt++) {
    try {
      await webpush.sendNotification(subscription, payload);
      return true;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription expired/unsubscribed — terminal, signal the caller to prune.
        return false;
      }
      if (attempt === PUSH_MAX_ATTEMPTS) {
        console.error(
          "[push] giving up after retries",
          { statusCode, attempts: attempt, endpoint: subscription.endpoint },
          err
        );
        return true;
      }
      await sleep(PUSH_BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }
  return true;
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
