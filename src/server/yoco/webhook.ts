// TODO (G6): Verify Yoco webhook HMAC signature using YOCO_WEBHOOK_SECRET
// Idempotent on yoco_payment_id — docs/API.md → POST /api/payments/yoco/webhook

export function verifyYocoWebhook(
  _payload: string,
  _signature: string
): boolean {
  throw new Error("Not implemented — see task G6");
}
