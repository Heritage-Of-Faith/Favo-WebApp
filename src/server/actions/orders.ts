"use server";

import type { ActionResult, Order, OrderState } from "@/lib/types";
import { writeAudit } from "@/server/audit";

// Docs: docs/API.md → createOrder, transitionOrder, cancelOrder, applyStaffDiscount
// Business rules: docs/BUSINESS_RULES.md L01–L05, L14–L15

export type CreateOrderInput = {
  customerId?: string;
  items: {
    menuItemId: string;
    quantity: number;
    modifications: string[];
  }[];
};

// TODO (G5): Insert order in 'ordered' state, return id + Yoco payment intent.
// No stock deduction at creation — only on in_progress transition (P2).
export async function createOrder(
  input: CreateOrderInput
): Promise<ActionResult<{ orderId: string; yocoClientSecret: string }>> {
  void input;
  void writeAudit;
  throw new Error("Not implemented — see task G5");
}

// TODO (G5): State machine — ordered→in_progress→ready→collected
// 'ready': fire Web Push + accrue loyalty + pg_notify (rule L15)
// Use SELECT FOR UPDATE for concurrency safety
export async function transitionOrder(
  orderId: string,
  toState: OrderState
): Promise<ActionResult<Order>> {
  void orderId;
  void toState;
  throw new Error("Not implemented — see task G5");
}

// TODO (G5): Cancel only when state == 'ordered'; return 409 otherwise (rule L01)
export async function cancelOrder(
  orderId: string,
  reason: string
): Promise<ActionResult> {
  void orderId;
  void reason;
  throw new Error("Not implemented — see task G5");
}

// TODO (G5): Cappuccino + weekday only. 100% off. DB UNIQUE(staff_id, day) enforces once/day (rule L03, L14)
export async function applyStaffDiscount(
  orderId: string,
  beneficiaryStaffId: string
): Promise<ActionResult> {
  void orderId;
  void beneficiaryStaffId;
  throw new Error("Not implemented — see task G5");
}
