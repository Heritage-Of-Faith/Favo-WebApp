// REQ-134 · PRD §10.6: "orders.payment_mode is never null, and any report
// grouping by payment mode fails loudly on an unknown value; it never
// defaults." §15.1: a report fed an unhandled payment_mode must fail loudly
// "rather than absorbing the row".
//
// The known values are the orders.payment_mode enum (db/schema.ts). NULL is
// not one of them: §10.3 L2499 calls a NULL "'yoco' by convention, which
// silently mis-buckets every per-mode query" and commissions a NOT NULL
// backfill — migration 0051 (owner-approved). A NULL that reaches a report
// anyway is refused here like any other unknown value — never read as
// 'yoco'. Pure and client-safe.

export const PAYMENT_MODES = ["yoco", "yoco_deferred", "free", "donor_fund"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export class UnknownPaymentModeError extends Error {
  readonly code = "UNKNOWN_PAYMENT_MODE";
  constructor(
    readonly value: unknown,
    readonly where?: string
  ) {
    super(
      `Unknown payment_mode ${value === null || value === undefined ? "NULL" : JSON.stringify(value)}` +
        `${where ? ` on ${where}` : ""} — the report stops rather than guess (§10.6).`
    );
    this.name = "UnknownPaymentModeError";
  }
}

/**
 * The mode an order WRITES when it carries a charge (§10.3 L2499, §10.6:
 * never NULL). A tender already chosen — card, deferred card, or a fund draw —
 * is kept; anything else (an order that was `free` and now owes money) is
 * 'yoco', the card tender createOrder writes. The caller writes 'free' itself
 * when the total is R0 (L42).
 */
export function chargeableMode(current: string | null | undefined): Exclude<PaymentMode, "free"> {
  if (current === "yoco" || current === "yoco_deferred" || current === "donor_fund") return current;
  return "yoco";
}

/** Returns the mode, or throws UnknownPaymentModeError. Never defaults. */
export function assertPaymentMode(value: unknown, where?: string): PaymentMode {
  if (typeof value === "string" && (PAYMENT_MODES as readonly string[]).includes(value)) return value as PaymentMode;
  throw new UnknownPaymentModeError(value, where);
}
