"use server";

// Menu + operating hours actions — task G-menu (Gian)
// getMenu: public (no auth). setMenuItemPrice: admin/owner only.
// getOperatingHours: public (display-only; system NEVER rejects orders on time — rule L04).
// Docs: docs/API.md · docs/DATA_MODEL.md → menu_items, price_history, operating_hours

import { z } from "zod";
import { eq, asc, desc, and, isNull } from "drizzle-orm";
import { unstable_cache, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { menuItems, menuCustomisations, priceHistory, operatingHours } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult, MenuItem, MenuCustomisation, MenuCategory } from "@/lib/types";

// Cache tag for the public menu. The menu changes rarely (only on price edits
// or item/customisation changes), but is read on every POS mount, landing page,
// and customer PWA load. Caching it removes ~1.5s of cross-region DB latency
// (Supabase eu-west-1 ↔ South Africa) from every one of those reads.
const MENU_CACHE_TAG = "menu";

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

const MENU_CATEGORIES = ["coffee", "tea", "cold_brew", "food", "merchandise", "other"] as const;

const setPriceSchema = z.object({
  menuItemId: z.string().min(1),
  newPriceZar: z.number().int().positive("Price must be a positive integer (cents)."),
});

const createItemSchema = z.object({
  name: z.string().min(1, "Name is required.").max(80, "Name too long."),
  category: z.enum(MENU_CATEGORIES),
  priceZar: z.number().int().positive("Price must be a positive integer (cents)."),
});

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Build the full menu from the DB: all active items with their current price
 * and customisations. Wrapped by `unstable_cache` below — invalidated by
 * `revalidateTag(MENU_CACHE_TAG)` on any menu mutation, with a 5-minute
 * time-based fallback so a missed invalidation self-heals.
 */
const loadMenu = unstable_cache(
  async (): Promise<MenuItem[]> => {
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

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      currentPriceZar: item.currentPriceZar,
      active: item.active,
      customisations: custByItem.get(item.id) ?? [],
    }));
  },
  ["get-menu"],
  { tags: [MENU_CACHE_TAG], revalidate: 300 }
);

/**
 * Return the full menu: all active items with their current price and
 * customisations. Public — no auth required (POS, landing page, customer PWA).
 * Served from cache; see `loadMenu` for the underlying query.
 */
export async function getMenu(): Promise<ActionResult<MenuItem[]>> {
  const menu = await loadMenu();
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
  const auth = await authorize("admin");
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

  // The denormalised price the menu serves has changed — invalidate the menu
  // cache so subsequent getMenu() reads reflect the new price. "max" gives
  // stale-while-revalidate semantics (Next 16 recommended); a momentarily stale
  // *display* price is harmless because createOrder always re-reads prices
  // directly from the DB and never trusts the cached menu.
  revalidateTag(MENU_CACHE_TAG, "max");

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
  const auth = await authorize("admin");
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
 * Return all menu items (active + inactive) for the admin editor.
 * Auth: admin only.
 */
export async function getMenuAdmin(): Promise<ActionResult<MenuItem[]>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const [items, customisations] = await Promise.all([
    db
      .select()
      .from(menuItems)
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

  return {
    ok: true,
    data: items.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      currentPriceZar: item.currentPriceZar,
      active: item.active,
      customisations: custByItem.get(item.id) ?? [],
    })),
  };
}

/**
 * Create a new menu item with an initial price history row.
 * Auth: admin only.
 */
export async function createMenuItem(input: {
  name: string;
  category: MenuCategory;
  priceZar: number;
}): Promise<ActionResult<MenuItem>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const parsed = createItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { name, category, priceZar } = parsed.data;
  const now = new Date();

  const [created] = await db
    .insert(menuItems)
    .values({ name, category, currentPriceZar: priceZar, active: true })
    .returning();

  await db.insert(priceHistory).values({
    menuItemId: created!.id,
    priceZar,
    effectiveFrom: now,
    effectiveUntil: null,
  });

  await writeAudit({
    entityKind: "menu_item",
    entityId: created!.id,
    action: "create",
    actorId: auth.session.id,
    actorRole: auth.session.role,
    before: null,
    after: { name, category, priceZar },
  });

  revalidateTag(MENU_CACHE_TAG, "max");

  return {
    ok: true,
    data: {
      id: created!.id,
      name: created!.name,
      category: created!.category,
      currentPriceZar: created!.currentPriceZar,
      active: created!.active,
      customisations: [],
    },
  };
}

/**
 * Activate or deactivate a menu item (soft delete).
 * Deactivated items are hidden from POS and customer menu but preserved in order history.
 * Auth: admin only.
 */
export async function setMenuItemActive(
  menuItemId: string,
  active: boolean,
): Promise<ActionResult<void>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const [existing] = await db
    .select({ id: menuItems.id, active: menuItems.active })
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId));

  if (!existing) return { ok: false, code: "NOT_FOUND", message: "Menu item not found." };
  if (existing.active === active) return { ok: true, data: undefined };

  await db.update(menuItems).set({ active }).where(eq(menuItems.id, menuItemId));

  await writeAudit({
    entityKind: "menu_item",
    entityId: menuItemId,
    action: active ? "reactivate" : "deactivate",
    actorId: auth.session.id,
    actorRole: auth.session.role,
    before: { active: existing.active },
    after: { active },
  });

  revalidateTag(MENU_CACHE_TAG, "max");

  return { ok: true, data: undefined };
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
