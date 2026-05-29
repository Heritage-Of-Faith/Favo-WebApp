// Yoco REST API client stub — task G6
// NEVER log or store PAN/CVV/expiry. Yoco hosted-fields only (business rule L01).

export type YocoCreateIntentParams = {
  amountZar: number;
  currency?: "ZAR";
  metadata?: Record<string, string>;
};

export async function createPaymentIntent(
  _params: YocoCreateIntentParams
): Promise<{ id: string; clientSecret: string }> {
  throw new Error("Not implemented — see task G6");
}
