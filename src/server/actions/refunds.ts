"use server";

// Docs: docs/API.md → requestRefund, approveRefund
// Business rule L02 (LOCKED): FAVO does not process refunds.
//
// Per PRD v4 §07 (API Surface) and §08 L02, refunds.ts is NOT implemented and
// throws on any call. This is a locked rule — changing it requires a PRD
// amendment. Do not re-introduce a refund flow here without one.

import type { ActionResult } from "@/lib/types";

const NO_REFUNDS_MESSAGE =
  "Refunds are not supported (business rule L02). FAVO does not process refunds.";

/**
 * Not implemented (L02). Throws on any call.
 * @deprecated FAVO does not process refunds — see PRD v4 §08 L02.
 */
export async function requestRefund(
  _orderId: string,
  _reason: string
): Promise<ActionResult<{ refundId: string }>> {
  throw new Error(NO_REFUNDS_MESSAGE);
}

/**
 * Not implemented (L02). Throws on any call.
 * @deprecated FAVO does not process refunds — see PRD v4 §08 L02.
 */
export async function approveRefund(_refundId: string): Promise<ActionResult> {
  throw new Error(NO_REFUNDS_MESSAGE);
}
