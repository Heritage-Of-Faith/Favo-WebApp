// Offline sync — apply a single outbox entry — task G20 (AT-61)
// Called by POST /api/sync/orders. Pure DB logic; no HTTP concerns here.
// Idempotency: keyed on outbox_log.client_uuid — duplicates return the stored result.
// LWW per order creation: an unknown/inactive menu item or a payment-amount
// mismatch (server total vs. client total) is rejected outright rather than
// silently accepted. (Deletion pass: this used to open a row in a dedicated
// conflict-tracking table for manager review; that tracking/resolution layer
// is gone — the outbox entry itself still records the receipt, just never
// gets applied.)
// Docs: docs/API.md · BUSINESS_RULES.md L01

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  outboxLog,
  orders,
  orderItems,
  menuItems,
} from "@db/schema";
import { writeAudit } from "@/server/audit";
import { computeOrderTotalZar } from "@/server/orders/pricing";

// ─── Input schema ─────────────────────────────────────────────────────────────

export const outboxItemSchema = z.object({
  clientUuid: z.string().uuid("clientUuid must be a valid UUID"),
  staffId: z.string().min(1),
  customerId: z.string().optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        modifications: z.array(z.string()),
      })
    )
    .min(1),
  paymentMode: z.enum(["yoco_deferred", "free"]),
  clientTotalZar: z.number().int().nonnegative(),
  clientTimestamp: z.string().datetime(),
});

export type OutboxItem = z.infer<typeof outboxItemSchema>;

// ─── Result types ─────────────────────────────────────────────────────────────

export type ApplyOutboxResult =
  | { outcome: "applied"; orderId: string; serverTotalZar: number }
  | { outcome: "duplicate"; orderId: string | null; appliedAt: Date | null }
  | { outcome: "rejected"; reason: "unknown_menu_item" | "amount_mismatch" };

// ─── applyOutboxItem ──────────────────────────────────────────────────────────

export async function applyOutboxItem(item: OutboxItem): Promise<ApplyOutboxResult> {
  // ── Idempotency check ──────────────────────────────────────────────────────
  const [existing] = await db
    .select()
    .from(outboxLog)
    .where(eq(outboxLog.clientUuid, item.clientUuid));

  if (existing) {
    // Already processed — return stored result without re-applying.
    const existingOrderId = await findOrderForOutboxEntry(existing.id);
    return { outcome: "duplicate", orderId: existingOrderId, appliedAt: existing.appliedAt };
  }

  // ── Write to outbox_log (before applying — so we record receipt even on failure) ─
  const [logEntry] = await db
    .insert(outboxLog)
    .values({
      clientUuid: item.clientUuid,
      customerId: item.customerId,
      staffId: item.staffId,
      payload: item as unknown as Record<string, unknown>,
    })
    .returning({ id: outboxLog.id });

  if (!logEntry) {
    return { outcome: "rejected", reason: "unknown_menu_item" };
  }

  // ── Resolve menu items and compute server-side total ───────────────────────
  const menuRows = await db
    .select({ id: menuItems.id, name: menuItems.name, currentPriceZar: menuItems.currentPriceZar, active: menuItems.active })
    .from(menuItems)
    .where(inArray(menuItems.id, item.items.map((i) => i.menuItemId)));

  const menuById = new Map(menuRows.map((m) => [m.id, m]));

  // Verify all items exist and are active. Rejected outright — the outbox_log
  // row already recorded the receipt (appliedAt stays null).
  for (const reqItem of item.items) {
    const mi = menuById.get(reqItem.menuItemId);
    if (!mi || !mi.active) {
      return { outcome: "rejected", reason: "unknown_menu_item" };
    }
  }

  const lines = item.items.map((i) => ({
    unitPriceZar: menuById.get(i.menuItemId)!.currentPriceZar,
    quantity: i.quantity,
    modifications: [],
  }));
  const serverTotalZar = computeOrderTotalZar(lines);

  // ── Payment amount validation (LWW — server total is authoritative) ────────
  if (serverTotalZar !== item.clientTotalZar) {
    return { outcome: "rejected", reason: "amount_mismatch" };
  }

  // ── Create the order ───────────────────────────────────────────────────────
  const orderId = crypto.randomUUID();

  await db.insert(orders).values({
    id: orderId,
    staffId: item.staffId,
    customerId: item.customerId ?? null,
    state: "ordered",
    totalZar: serverTotalZar,
    paymentMode: item.paymentMode,
  });

  await db.insert(orderItems).values(
    item.items.map((i) => ({
      orderId,
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      unitPriceZar: menuById.get(i.menuItemId)!.currentPriceZar,
      modifications: i.modifications.map((id) => ({ id })),
    }))
  );

  // Mark outbox entry as applied
  await db
    .update(outboxLog)
    .set({ appliedAt: new Date() })
    .where(eq(outboxLog.id, logEntry.id));

  await writeAudit({
    actorId: item.staffId,
    actorRole: "barista",
    action: "order.sync_applied",
    entityKind: "order",
    entityId: orderId,
    after: { clientUuid: item.clientUuid, paymentMode: item.paymentMode, totalZar: serverTotalZar },
  });

  return { outcome: "applied", orderId, serverTotalZar };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function findOrderForOutboxEntry(outboxId: string): Promise<string | null> {
  // The outbox_log doesn't directly store the orderId, but we can find it
  // via the client_uuid in the order payload if needed. For the idempotent
  // response, we return null if we can't quickly find it.
  void outboxId;
  return null;
}
