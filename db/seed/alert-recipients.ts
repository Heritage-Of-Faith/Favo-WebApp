// Stock alert recipients seed — task G8 (Phase 2)
// Seeds the on-call barista as a global low-stock recipient.
// inventoryItemId = NULL means "receive alerts for every item".
// Docs: DATA_MODEL.md · BUSINESS_RULES.md T04 · API.md addStockAlertRecipient

import { db } from "../index";
import { stockAlertRecipients } from "../schema";

export type SeedAlertRecipient = {
  id: string;
  staffId: string;
  inventoryItemId: string | null; // null = global
};

export const ALERT_RECIPIENTS: SeedAlertRecipient[] = [
  {
    // Sam Barista receives all low-stock alerts (global sentinel row)
    id: "sar_sam_global",
    staffId: "staff_barista_sam",
    inventoryItemId: null,
  },
];

export async function seedAlertRecipients() {
  console.log(`  → stock alert recipients (${ALERT_RECIPIENTS.length})`);
  await db
    .insert(stockAlertRecipients)
    .values(ALERT_RECIPIENTS)
    .onConflictDoNothing();
}
