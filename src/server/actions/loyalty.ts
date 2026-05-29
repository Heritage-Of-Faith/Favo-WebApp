"use server";

import type { ActionResult } from "@/lib/types";

// Docs: docs/API.md → redeemLoyalty, topUpWallet, purchasePack
// Business rules: L06 — 5pts per R10, min 100 to redeem, 100pts = R20, full redemption only

// TODO (G5 / Phase 3): Require ≥100pts. Full redemption only — total_zar = 0. (rule L06)
export async function redeemLoyalty(
  customerId: string,
  orderId: string
): Promise<ActionResult> {
  void customerId;
  void orderId;
  throw new Error("Not implemented — see task G5 / Phase 3");
}

// TODO (Phase 3): Yoco intent; webhook credits wallet
export async function topUpWallet(
  customerId: string,
  amountZar: number
): Promise<ActionResult<{ yocoClientSecret: string }>> {
  void customerId;
  void amountZar;
  throw new Error("Not implemented — Phase 3");
}

// TODO (Phase 3): Yoco intent; on success insert coffee_packs (90d expiry, rule L16)
export async function purchasePack(
  customerId: string,
  menuItemId: string,
  qty: number
): Promise<ActionResult<{ yocoClientSecret: string }>> {
  void customerId;
  void menuItemId;
  void qty;
  throw new Error("Not implemented — Phase 3");
}
