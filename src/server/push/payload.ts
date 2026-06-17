// Web Push payload + subscription helpers — task G7
// Pure + unit-tested. The notification body the customer sees when their order
// is ready, plus validation of the PushSubscription shape we persist.

export type PushSubscriptionShape = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type OrderReadyPayload = {
  title: string;
  body: string;
  data: { orderId: string; url: string };
};

/** Type-guard for a browser PushSubscription before we store it (jsonb). */
export function isValidPushSubscription(x: unknown): x is PushSubscriptionShape {
  if (typeof x !== "object" || x === null) return false;
  const sub = x as Record<string, unknown>;
  if (typeof sub.endpoint !== "string" || sub.endpoint.length === 0) return false;
  const keys = sub.keys as Record<string, unknown> | undefined;
  if (typeof keys !== "object" || keys === null) return false;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

/** The "your order is ready" notification content. */
export function buildOrderReadyPayload(
  orderId: string,
  customerName?: string
): OrderReadyPayload {
  const greeting = customerName ? `${customerName}, your` : "Your";
  return {
    title: "Your order is ready ☕",
    body: `${greeting} order is ready for collection at FAVO Café.`,
    data: { orderId, url: "/customer" },
  };
}
