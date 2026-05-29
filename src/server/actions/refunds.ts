"use server";

import type { ActionResult } from "@/lib/types";

// Docs: docs/API.md → requestRefund, approveRefund
// Business rule L02: full refunds only in v1

// TODO (G5 / admin): Insert pending refund row
export async function requestRefund(
  orderId: string,
  reason: string
): Promise<ActionResult<{ refundId: string }>> {
  void orderId;
  void reason;
  throw new Error("Not implemented — see task G5");
}

// TODO (admin): Trigger Yoco refund API call. Full amount only (rule L02).
// Requires admin or owner role.
export async function approveRefund(refundId: string): Promise<ActionResult> {
  void refundId;
  throw new Error("Not implemented — admin task");
}
