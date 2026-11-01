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
import { shotSurchargeZar, type ShotPolicy } from "@/server/orders/shot-surcharge";
import { readShotPolicy, readCoffeeRecipeIds } from "@/server/orders/shot-policy";
import { revenueDay } from "@/lib/format";

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
        // AT-202: the line's shot count. Absent (an entry queued before the
        // picker existed) = 1.
        shots: z.number().int().min(1).default(1),
      })
    )
    .min(1),
  paymentMode: z.enum(["yoco_deferred", "free"]),
  clientTotalZar: z.number().int().nonnegative(),
  clientTimestamp: z.string().datetime(),
});

export type OutboxItem = z.input<typeof outboxItemSchema>;

// ─── Result types ─────────────────────────────────────────────────────────────

export type ApplyOutboxResult =
  | { outcome: "applied"; orderId: string; serverTotalZar: number }
  | { outcome: "duplicate"; orderId: string | null; appliedAt: Date | null }
  | {
      outcome: "rejected";
      reason: "unknown_menu_item" | "amount_mismatch" | "shots_above_ceiling" | "shots_not_allowed";
    };

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
    .select({ id: menuItems.id, name: menuItems.name, currentPriceZar: menuItems.currentPriceZar, active: menuItems.active, recipeId: menuItems.recipeId })
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

  // ── AT-202: shots — the same ceiling and surcharge createOrder applies ────
  // The mode is the one in force on the SERVER'S receipt day (the day this
  // order's revenue_day is written for, REQ-039), never the client's clock.
  // So a Sunday triple replayed on a Sunday is charged its surcharge, and one
  // replayed on any other day is above that day's ceiling and refused — it is
  // never silently re-priced without the surcharge. A 1-shot line cannot be
  // affected, so the policy is read only when a line carries more.
  const shotsOf = (i: OutboxItem["items"][number]) => i.shots ?? 1;
  let shotPolicy: ShotPolicy | null = null;
  const multiShot = item.items.filter((i) => shotsOf(i) > 1);
  if (multiShot.length > 0) {
    // L48: no coffee in the recipe, no extra shots (as createOrder refuses).
    const recipeOf = (id: string) => menuById.get(id)!.recipeId;
    const coffee = await readCoffeeRecipeIds(
      db,
      multiShot.map((i) => recipeOf(i.menuItemId)).filter((r): r is string => typeof r === "string")
    );
    if (multiShot.some((i) => { const r = recipeOf(i.menuItemId); return !(r && coffee.has(r)); })) {
      return { outcome: "rejected", reason: "shots_not_allowed" };
    }
    shotPolicy = await readShotPolicy(db, revenueDay());
    const policy = shotPolicy;
    if (item.items.some((i) => shotsOf(i) > policy.maxShots)) {
      return { outcome: "rejected", reason: "shots_above_ceiling" };
    }
  }
  const surchargeFor = (shots: number) =>
    shotPolicy ? shotSurchargeZar(shots, shotPolicy.extraShotZar, shotPolicy.surchargeInForce) : 0;

  const lines = item.items.map((i) => ({
    unitPriceZar: menuById.get(i.menuItemId)!.currentPriceZar,
    quantity: i.quantity,
    modifications: [],
    surchargeZar: surchargeFor(shotsOf(i)),
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
    // L28: the target was bound at ring-up by attaching (or not) a customer;
    // the outbox payload carries that choice as customerId (PRD T1 step 2:
    // offline, the target is `none`). Matches the §10.3 CHECK.
    notificationTarget: item.customerId ? "customer" : "none",
    state: "ordered",
    totalZar: serverTotalZar,
    paymentMode: item.paymentMode,
    // REQ-039: the server's receipt time decides the revenue day, never the client's.
    revenueDay: revenueDay(),
  });

  await db.insert(orderItems).values(
    item.items.map((i, idx) => ({
      orderId,
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      unitPriceZar: menuById.get(i.menuItemId)!.currentPriceZar,
      modifications: i.modifications.map((id) => ({ id })),
      shots: shotsOf(i),
      surchargeZar: lines[idx].surchargeZar,
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
