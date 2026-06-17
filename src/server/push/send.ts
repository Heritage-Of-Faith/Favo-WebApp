// Send a Web Push notification — task G7
// Called when an order transitions to `ready` (see transitionOrder, G5).

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
  const payload = JSON.stringify(buildOrderReadyPayload(orderId, customerName));
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
