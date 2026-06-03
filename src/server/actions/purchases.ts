"use server";

// Purchase server actions — Phase 2 G10
// recordPurchase: admin+ (emergency kind held pending for non-admin per L10).
// approveEmergencyPurchase: admin only.
// listPurchases: admin + finance read.
// Docs: docs/API.md · docs/BUSINESS_RULES.md L08 L10

import type { ActionResult, Purchase, PurchaseKind } from "@/lib/types";

// ─── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_PURCHASES: Purchase[] = [
  {
    id: "purch_001",
    sourceName: "Origin Coffee Roasters",
    receivedAt: "2026-05-01T07:00:00+02:00",
    totalZar: 90000, // R900,00 for 2kg beans
    kind: "planned",
    status: "active",
    adminApprovedBy: null,
  },
  {
    id: "purch_002",
    sourceName: "Bunzl SA",
    receivedAt: "2026-05-01T07:00:00+02:00",
    totalZar: 62000, // R620,00 cups + lids
    kind: "planned",
    status: "active",
    adminApprovedBy: null,
  },
  {
    id: "purch_003",
    sourceName: "Clover SA",
    receivedAt: "2026-05-29T06:30:00+02:00",
    totalZar: 28000, // R280,00 emergency milk restock
    kind: "emergency",
    status: "pending_admin_approval",
    adminApprovedBy: null,
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type PurchaseLotItem = {
  inventoryItemId: string;
  quantity: number; // in the item's unit
  unitCostZar: string; // numeric string (cents per base unit)
};

export type RecordPurchaseInput = {
  sourceName: string;
  kind: PurchaseKind;
  items: PurchaseLotItem[];
  /** Total invoice amount in integer cents. */
  totalZar: number;
};

// ─── listPurchases ────────────────────────────────────────────────────────────

/**
 * Lists all purchases, most-recent first.
 * Admin + finance read.
 * TODO (P2 G10): replace fixture with real DB query.
 */
export async function listPurchases(input?: {
  kind?: PurchaseKind;
  status?: "active" | "pending_admin_approval";
}): Promise<ActionResult<{ purchases: Purchase[]; total: number }>> {
  void input;
  // STUB — returns fixture data until G10 is merged.
  return {
    ok: true,
    data: { purchases: FIXTURE_PURCHASES, total: FIXTURE_PURCHASES.length },
  };
}

// ─── recordPurchase ───────────────────────────────────────────────────────────

/**
 * Records a purchase and creates inventory lots.
 * - Standard: creates lots immediately with state='active'.
 * - Emergency by non-admin: creates lots with state='quarantined' (pending),
 *   inserts purchase with adminApprovedBy=null (no CHECK violation).
 * - Emergency by admin/owner: creates lots as 'active' directly.
 * writeAudit per lot created (L08).
 * TODO (P2 G10): real implementation.
 */
export async function recordPurchase(
  input: RecordPurchaseInput
): Promise<ActionResult<{ purchaseId: string }>> {
  void input;
  throw new Error("Not implemented — Phase 2 G10");
}

// ─── approveEmergencyPurchase ─────────────────────────────────────────────────

/**
 * Admin approves a pending emergency purchase: sets adminApprovedBy and
 * promotes quarantined lots to active. writeAudit (L08).
 * TODO (P2 G10): real implementation.
 */
export async function approveEmergencyPurchase(
  purchaseId: string
): Promise<ActionResult> {
  void purchaseId;
  throw new Error("Not implemented — Phase 2 G10");
}
