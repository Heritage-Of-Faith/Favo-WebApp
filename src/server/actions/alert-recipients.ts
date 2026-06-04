"use server";

// Stock alert recipient actions — Phase 2 G12
// addStockAlertRecipient, removeStockAlertRecipient: admin+ only.
// listStockAlertRecipients: admin + manager read.
// Docs: docs/API.md · docs/DATA_MODEL.md · stock_alert_recipients · T04

import type { ActionResult, Staff } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertRecipient = {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: Staff["role"];
  /** null = global (receives alerts for all items). */
  inventoryItemId: string | null;
  inventoryItemName: string | null;
};

// ─── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_RECIPIENTS: AlertRecipient[] = [
  {
    id: "sar_sam_global",
    staffId: "staff_barista_sam",
    staffName: "Sam Barista",
    staffRole: "barista",
    inventoryItemId: null,
    inventoryItemName: null,
  },
];

// ─── listStockAlertRecipients ─────────────────────────────────────────────────

/**
 * Returns all current alert recipients.
 * Admin + manager read.
 * TODO (P2 G12): replace fixture with real DB query.
 */
export async function listStockAlertRecipients(): Promise<
  ActionResult<{ recipients: AlertRecipient[] }>
> {
  // STUB — returns fixture data until G12 is merged.
  return { ok: true, data: { recipients: FIXTURE_RECIPIENTS } };
}

// ─── addStockAlertRecipient ───────────────────────────────────────────────────

/**
 * Adds a staff member as a recipient for a specific item (or globally).
 * Admin+ only. UNIQUE on (inventory_item_id, staff_id) — rejects duplicates.
 * writeAudit (L08).
 * TODO (P2 G12): real implementation.
 */
export async function addStockAlertRecipient(input: {
  staffId: string;
  inventoryItemId: string | null; // null = global
}): Promise<ActionResult<{ recipientId: string }>> {
  void input;
  throw new Error("Not implemented — Phase 2 G12");
}

// ─── removeStockAlertRecipient ────────────────────────────────────────────────

/**
 * Removes a recipient row. Admin+ only. writeAudit (L08).
 * TODO (P2 G12): real implementation.
 */
export async function removeStockAlertRecipient(
  recipientId: string
): Promise<ActionResult> {
  void recipientId;
  throw new Error("Not implemented — Phase 2 G12");
}
