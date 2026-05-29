// Yoco webhook signature verification — task G6
// Verifies an HMAC-SHA256 signature over the raw request body using the
// webhook secret (YOCO_WEBHOOK_SECRET). Timing-safe comparison.
//
// NOTE: confirm the exact header name + envelope (id.timestamp.body) against
// current Yoco docs when wiring the route — the crypto core here is standard
// regardless of the envelope and is what the tests pin down.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Compute the base64 HMAC-SHA256 of a payload with the given secret. */
export function computeSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

/**
 * Timing-safe compare of a provided signature against the expected one.
 * Returns false on any length/format mismatch rather than throwing.
 */
export function verifyYocoSignature(
  payload: string,
  providedSignature: string,
  secret: string
): boolean {
  if (!providedSignature || !secret) return false;
  const expected = computeSignature(payload, secret);

  const a = Buffer.from(expected);
  const b = Buffer.from(providedSignature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
