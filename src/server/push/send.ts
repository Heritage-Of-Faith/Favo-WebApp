// Send a Web Push notification — task G7
// Called when an order transitions to `ready` (see transitionOrder, G5).
// Also used for loyalty earn notifications (AT-128).

import webpush from "web-push";
import { initVapid } from "./vapid";
import {
  buildOrderReadyPayload,
  type PushSubscriptionShape,
} from "./payload";

/**
 * Push an "order ready" notification to a single subscription.
 * Returns false if the subscription is gone (410/404) so the caller can prune it.
 */
export async function sendOrderReadyPush(
  subscription: PushSubscriptionShape,
  orderId: string,
  customerName?: string
): Promise<boolean> {
  initVapid();
  const payload = JSON.stringify({ ...buildOrderReadyPayload(orderId, customerName), tag: "favo-order-ready" });
  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      // Subscription expired/unsubscribed — signal the caller to remove it.
      return false;
    }
    // Log unexpected errors (e.g. VAPID misconfiguration, network failure) before
    // re-throwing so the caller's .catch() can surface them in Vercel logs.
    console.error("[push] webpush.sendNotification error", { statusCode, endpoint: subscription.endpoint }, err);
    throw err;
  }
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
  initVapid();
  const body = isClosed
    ? "FAVO is closed today."
    : `We're open ${opensAt} – ${closesAt} today.`;
  const payload = JSON.stringify({
    title: "FAVO hours posted ☕",
    body,
    url: "/loyalty",
  });
  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return false;
    }
    console.error("[push] webpush.sendNotification error", { statusCode, endpoint: subscription.endpoint }, err);
    throw err;
  }
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
  initVapid();
  const payload = JSON.stringify({
    title: isReopening ? "FAVO is reopening ☕" : "FAVO is opening today ☕",
    body: isReopening
      ? `We're opening again at ${opensAt} — see you there.`
      : `We're opening at ${opensAt} today.`,
    data: { url: "/loyalty" },
    tag: "favo-opening",
  });
  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return false;
    }
    console.error("[push] webpush.sendNotification error", { statusCode, endpoint: subscription.endpoint }, err);
    throw err;
  }
}

/**
 * Push a "points earned" notification to a single subscription (AT-128).
 * Returns false if the subscription is gone (410/404) so the caller can handle it.
 * Fire-and-forget — never blocks the order flow.
 */
export async function sendPointsEarnedPush(
  subscription: PushSubscriptionShape,
  pointsEarned: number,
  newBalance: number
): Promise<boolean> {
  initVapid();
  const payload = JSON.stringify({
    title: "Points earned! ☕",
    body: `You earned ${pointsEarned} pts. Balance: ${newBalance} pts.`,
    data: { url: "/loyalty" },
    tag: "favo-points-earned",
  });
  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return false;
    }
    console.error("[push] webpush.sendNotification error", { statusCode, endpoint: subscription.endpoint }, err);
    throw err;
  }
}
