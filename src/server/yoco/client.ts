// Yoco REST API client — task G6
// NEVER log or store PAN/CVV/expiry. Yoco hosted-fields only (business rule L01).
// Docs: https://developer.yoco.com/online/resources/integration-options

const YOCO_API_BASE = "https://payments.yoco.com/api";

export type YocoCreateIntentParams = {
  amountZar: number;
  currency?: "ZAR";
  metadata?: Record<string, string>;
};

/**
 * Create a Yoco checkout and return its id used as the clientSecret by the
 * hosted-fields SDK on the frontend. Requires YOCO_SECRET_KEY in env.
 *
 * Yoco checkout API: POST /api/checkouts
 * Response: { id: string, ... } — the `id` is passed to yoco.js as the
 * payment intent identifier for the hosted-fields payment form.
 */
export async function createPaymentIntent(
  params: YocoCreateIntentParams
): Promise<{ id: string; clientSecret: string }> {
  const secretKey = process.env.YOCO_SECRET_KEY;
  if (!secretKey) {
    throw new Error("YOCO_SECRET_KEY is not configured.");
  }

  const res = await fetch(`${YOCO_API_BASE}/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secretKey}`,
    },
    body: JSON.stringify({
      amount: params.amountZar,
      currency: params.currency ?? "ZAR",
      ...(params.metadata ? { metadata: params.metadata } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yoco API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { id: string };
  // The checkout `id` doubles as the clientSecret — the Yoco JS SDK uses it to
  // initialise the hosted-fields payment form on the frontend.
  return { id: data.id, clientSecret: data.id };
}

export type YocoCheckoutStatus = "pending" | "succeeded" | "failed" | "expired";

/**
 * Poll a Yoco checkout for its current status. Used by the deferred-payment
 * retry cron (G22) to resolve payments that were created while the POS was
 * offline and whose webhooks may not have arrived.
 */
export async function getCheckoutStatus(
  checkoutId: string
): Promise<{ status: YocoCheckoutStatus }> {
  const secretKey = process.env.YOCO_SECRET_KEY;
  if (!secretKey) throw new Error("YOCO_SECRET_KEY is not configured.");

  const res = await fetch(`${YOCO_API_BASE}/checkouts/${checkoutId}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  if (!res.ok) {
    throw new Error(`Yoco API error ${res.status} fetching checkout ${checkoutId}`);
  }

  const data = (await res.json()) as { status: string };
  const VALID: YocoCheckoutStatus[] = ["pending", "succeeded", "failed", "expired"];
  const status = VALID.includes(data.status as YocoCheckoutStatus)
    ? (data.status as YocoCheckoutStatus)
    : "pending";

  return { status };
}
