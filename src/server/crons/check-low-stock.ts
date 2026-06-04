// Low-stock cron — task G14
// Runs every 15 minutes (T05). Queries items below low_stock_threshold,
// finds matching stock_alert_recipients (item-specific + global),
// sends a Web Push to each recipient's staff device.
// Deduplicates: does NOT re-fire within 60 min for the same item unless
// stock has dropped further.
// writeAudit per push attempt (L08).
// Docs: API.md · BUSINESS_RULES.md T04 T05 · FAVO_PRD_v3.md §07 §09

import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryItems,
  inventoryLots,
  stockMovements,
  stockAlertRecipients,
  staff,
  lowStockPings,
} from "@db/schema";
import { writeAudit } from "@/server/audit";
import webpush from "web-push";
import { initVapid } from "@/server/push/vapid";
import { isValidPushSubscription } from "@/server/push/payload";
import type { PushSubscriptionShape } from "@/server/push/payload";

// Minimum time between pings for the same item (60 min)
const PING_COOLDOWN_MS = 60 * 60 * 1000;

/** Running stock for an inventory item (SUM across all lots). */
async function itemRunningStock(itemId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int`,
    })
    .from(stockMovements)
    .innerJoin(inventoryLots, eq(stockMovements.inventoryLotId, inventoryLots.id))
    .where(eq(inventoryLots.inventoryItemId, itemId));
  return row?.total ?? 0;
}

/** Send a Web Push notification to a staff subscription. */
async function sendStaffPush(
  subscription: PushSubscriptionShape,
  payload: string
): Promise<boolean> {
  initVapid();
  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    return statusCode !== 404 && statusCode !== 410;
  }
}

export async function checkLowStock(): Promise<{
  checkedItems: number;
  pushAttempts: number;
}> {
  const now = new Date();
  const cooldownBoundary = new Date(now.getTime() - PING_COOLDOWN_MS);

  // 1. Load all inventory items with their current stock
  const items = await db.select().from(inventoryItems);

  let pushAttempts = 0;

  for (const item of items) {
    const currentStock = await itemRunningStock(item.id);

    // Skip items above threshold
    if (currentStock >= item.lowStockThreshold) continue;

    // 2. Find recipients for this item (item-specific + global)
    const recipients = await db
      .select({
        staffId: stockAlertRecipients.staffId,
        staffName: staff.name,
        pushSubscription: staff.pushSubscription,
      })
      .from(stockAlertRecipients)
      .innerJoin(staff, eq(stockAlertRecipients.staffId, staff.id))
      .where(
        or(
          eq(stockAlertRecipients.inventoryItemId, item.id),
          isNull(stockAlertRecipients.inventoryItemId)
        )
      );

    for (const recipient of recipients) {
      // 3. Dedup: skip if pinged within PING_COOLDOWN_MS AND stock hasn't dropped further
      const [lastPing] = await db
        .select({ stockAtFire: lowStockPings.stockAtFire })
        .from(lowStockPings)
        .where(
          and(
            eq(lowStockPings.inventoryItemId, item.id),
            eq(lowStockPings.staffId, recipient.staffId),
            gte(lowStockPings.firedAt, cooldownBoundary)
          )
        )
        .orderBy(desc(lowStockPings.firedAt))
        .limit(1);

      if (lastPing && currentStock >= lastPing.stockAtFire) {
        // Stock hasn't gotten worse since last ping — skip
        continue;
      }

      // 4. Send push if subscription exists and is valid
      if (
        recipient.pushSubscription &&
        isValidPushSubscription(recipient.pushSubscription)
      ) {
        const payload = JSON.stringify({
          title: `⚠️ Low stock: ${item.name}`,
          body: `${currentStock} ${item.unit} remaining (threshold: ${item.lowStockThreshold})`,
          data: { itemId: item.id, stock: currentStock },
        });

        await sendStaffPush(
          recipient.pushSubscription as PushSubscriptionShape,
          payload
        );
        pushAttempts++;
      }

      // 5. Record the ping (for dedup and audit)
      await db.insert(lowStockPings).values({
        inventoryItemId: item.id,
        staffId: recipient.staffId,
        stockAtFire: currentStock,
      });

      // 6. Audit (L08)
      await writeAudit({
        entityKind: "inventory_item",
        entityId: item.id,
        action: "low_stock_ping",
        actorId: recipient.staffId,
        before: null,
        after: { stock: currentStock, threshold: item.lowStockThreshold, recipient: recipient.staffId },
        reason: "low_stock_alert",
      });
    }
  }

  return { checkedItems: items.length, pushAttempts };
}
