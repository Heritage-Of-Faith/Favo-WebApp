"use server";

// Docs: docs/API.md → requestRefund, approveRefund
// Business rule L02 (LOCKED): FAVO does not process refunds.
//
// Per PRD v4 §07 (API Surface) and §08 L02, refunds are NOT supported. These
// Server Actions therefore return the standard { ok: false } ActionResult —
// they do NOT throw. A "use server" export that throws surfaces to the client
// as an opaque, digest-masked server error; every other action in this codebase
// returns a structured result, and callers rely on `res.ok`. Re-introducing a
// real refund flow requires a PRD amendment.

import type { ActionResult } from "@/lib/types";

const NO_REFUNDS_MESSAGE =
  "Refunds are not supported (business rule L02). FAVO does not process refunds.";

/**
 * Not supported (L02) — returns { ok: false, code: "NOT_SUPPORTED" }.
 * @deprecated FAVO does not process refunds — see PRD v4 §08 L02.
 */
export async function requestRefund(
  _orderId: string,
  _reason: string
): Promise<ActionResult<{ refundId: string }>> {
  return { ok: false, code: "NOT_SUPPORTED", message: NO_REFUNDS_MESSAGE };
}

/**
 * Not supported (L02) — returns { ok: false, code: "NOT_SUPPORTED" }.
 * @deprecated FAVO does not process refunds — see PRD v4 §08 L02.
 */
export async function approveRefund(_refundId: string): Promise<ActionResult> {
  return { ok: false, code: "NOT_SUPPORTED", message: NO_REFUNDS_MESSAGE };
}
