// Yoco webhook event parsing + routing — task G6
// The *decision* logic is pure and unit-tested; the route handler does the I/O
// (signature check, DB read for idempotency, DB write). Idempotent on the Yoco
// payment id (universal invariant). Docs: docs/API.md → POST /api/payments/yoco/webhook

export type YocoEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "refund.succeeded";

export type YocoEvent = {
  type: YocoEventType;
  paymentId: string;
  /** Checkout ID from Yoco — matches payments.yoco_checkout_id / pending_charges.yoco_checkout_id. */
  checkoutId?: string;
  orderId?: string;
  amountZar?: number;
};

/** Parse + validate a raw webhook body into a typed event, or null if invalid. */
export function parseYocoEvent(raw: unknown): YocoEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const type = obj.type;
  const paymentId = obj.paymentId ?? obj.id;
  if (
    typeof type !== "string" ||
    !["payment.succeeded", "payment.failed", "refund.succeeded"].includes(type) ||
    typeof paymentId !== "string" ||
    paymentId.length === 0
  ) {
    return null;
  }

  return {
    type: type as YocoEventType,
    paymentId,
    checkoutId: typeof obj.checkoutId === "string" ? obj.checkoutId : undefined,
    orderId: typeof obj.orderId === "string" ? obj.orderId : undefined,
    amountZar: typeof obj.amountZar === "number" ? obj.amountZar : undefined,
  };
}

export type WebhookOutcome =
  | { action: "noop"; reason: string }
  | { action: "mark_paid"; paymentId: string; orderId?: string }
  | { action: "fail_payment"; paymentId: string; orderId?: string }
  | { action: "record_refund"; paymentId: string; orderId?: string };

/**
 * Decide what a webhook event should do, given whether its payment id was
 * already processed. Pure — no I/O. Duplicate deliveries are a no-op.
 */
export function decideWebhookOutcome(
  event: YocoEvent,
  alreadyProcessed: boolean
): WebhookOutcome {
  if (alreadyProcessed) {
    return { action: "noop", reason: "duplicate delivery (idempotent)" };
  }
  switch (event.type) {
    case "payment.succeeded":
      return { action: "mark_paid", paymentId: event.paymentId, orderId: event.orderId };
    case "payment.failed":
      return { action: "fail_payment", paymentId: event.paymentId, orderId: event.orderId };
    case "refund.succeeded":
      return { action: "record_refund", paymentId: event.paymentId, orderId: event.orderId };
  }
}
