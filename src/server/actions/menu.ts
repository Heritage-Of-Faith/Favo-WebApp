"use server";

// Menu + operating hours actions — task G-menu (Gian)
// getMenu: public (no auth). setMenuItemPrice: admin/owner only.
// getOperatingHours: public (display-only; system NEVER rejects orders on time — rule L04).
// Docs: docs/API.md · docs/DATA_MODEL.md → menu_items, price_history, operating_hours

import { z } from "zod";
import { eq, asc, desc, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuItems, menuCustomisations, priceHistory, operatingHours } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult, MenuItem, MenuCustomisation } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PriceHistoryRow = {
  id: string;
  priceZar: number;
  effectiveFrom: string; // ISO 8601
  effectiveUntil: string | null;
};

export type OperatingHour = {
  dayOfWeek: number;  // 0=Sun … 6=Sat
  opensAt: string;    // "HH:mm"
  closesAt: string;   // "HH:mm"
  isClosed: boolean;
};

// ─── Schemas ─────────────────────────────────────────────────────────────────

const setPriceSchema = z.object({
  menuItemId: z.string().min(1),
  newPriceZar: z.number().int().positive("Price must be a positive integer (cents)."),
});

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Return the full menu: all active items with their current price and
 * customisations. Public — no auth required (POS, landing page, customer PWA).
 */
export async function getMenu(): Promise<ActionResult<MenuItem[]>> {
  const [items, customisations] = await Promise.all([
    db
      .select()
      .from(menuItems)
      .where(eq(menuItems.active, true))
      .orderBy(asc(menuItems.category), asc(menuItems.name)),
    db
      .select()
      .from(menuCustomisations)
      .orderBy(asc(menuCustomisations.name)),
  ]);

  const custByItem = new Map<string, MenuCustomisation[]>();
  for (const c of customisations) {
    const list = custByItem.get(c.menuItemId) ?? [];
    list.push({ id: c.id, name: c.name, priceDeltaZar: c.priceDeltaZar });
    custByItem.set(c.menuItemId, list);
  }

  const menu: MenuItem[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    currentPriceZar: item.currentPriceZar,
    active: item.active,
    customisations: custByItem.get(item.id) ?? [],
  }));

  return { ok: true, data: menu };
}

/**
 * Update the price of a menu item.
 * - Closes the current open price_history row (sets effectiveUntil = now).
 * - Inserts a new price_history row for the new price.
 * - Updates menu_items.current_price_zar.
 * - All in a transaction; writeAudit after commit.
 * Auth: admin, owner only.
 */
export async function setMenuItemPrice(input: {
  menuItemId: string;
  newPriceZar: number;
}): Promise<ActionResult<MenuItem>> {
  const auth = await authorize("admin", "owner");
  if (!auth.ok) return auth;

  const parsed = setPriceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { menuItemId, newPriceZar } = parsed.data;

  const [existing] = await db
    .select({ id: menuItems.id, name: menuItems.name, currentPriceZar: menuItems.currentPriceZar })
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId));

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Menu item not found." };
  }

  if (existing.currentPriceZar === newPriceZar) {
    return { ok: false, code: "NO_CHANGE", message: "New price is the same as the current price." };
  }

  const oldPriceZar = existing.currentPriceZar;
  const now = new Date();

  await db.transaction(async (tx) => {
    // Close the current open price history row.
    await tx
      .update(priceHistory)
      .set({ effectiveUntil: now })
      .where(
        and(
          eq(priceHistory.menuItemId, menuItemId),
          isNull(priceHistory.effectiveUntil)
        )
      );

    // Insert a new price history row.
    await tx.insert(priceHistory).values({
      menuItemId,
      priceZar: newPriceZar,
      effectiveFrom: now,
      effectiveUntil: null,
    });

    // Update the denormalised current price.
    await tx
      .update(menuItems)
      .set({ currentPriceZar: newPriceZar })
      .where(eq(menuItems.id, menuItemId));
  });

  await writeAudit({
    entityKind: "menu_item",
    entityId: menuItemId,
    action: "price_change",
    actorId: auth.session.id,
    actorRole: auth.session.role,
    before: { priceZar: oldPriceZar },
    after: { priceZar: newPriceZar },
  });

  // Return the updated item with customisations.
  const [updated] = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId));

  const custs = await db
    .select()
    .from(menuCustomisations)
    .where(eq(menuCustomisations.menuItemId, menuItemId))
    .orderBy(asc(menuCustomisations.name));

  return {
    ok: true,
    data: {
      id: updated!.id,
      name: updated!.name,
      category: updated!.category,
      currentPriceZar: updated!.currentPriceZar,
      active: updated!.active,
      customisations: custs.map((c) => ({
        id: c.id,
        name: c.name,
        priceDeltaZar: c.priceDeltaZar,
      })),
    },
  };
}

/**
 * Get price history for a menu item, newest first.
 * Auth: admin, finance, owner only.
 */
export async function getMenuItemPriceHistory(
  menuItemId: string
): Promise<ActionResult<PriceHistoryRow[]>> {
  const auth = await authorize("admin", "finance", "owner");
  if (!auth.ok) return auth;

  const rows = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.menuItemId, menuItemId))
    .orderBy(desc(priceHistory.effectiveFrom));

  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      priceZar: r.priceZar,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveUntil: r.effectiveUntil ? r.effectiveUntil.toISOString() : null,
    })),
  };
}

/**
 * Return operating hours for all days, ordered Mon–Sun.
 * Public — no auth required.
 * Display-only: rule L04 states the system NEVER rejects orders based on time.
 */
export async function getOperatingHours(): Promise<ActionResult<OperatingHour[]>> {
  const rows = await db
    .select()
    .from(operatingHours)
    .orderBy(asc(operatingHours.dayOfWeek));

  return {
    ok: true,
    data: rows.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      opensAt: r.openTime,
      closesAt: r.closeTime,
      isClosed: r.isClosed,
    })),
  };
}
