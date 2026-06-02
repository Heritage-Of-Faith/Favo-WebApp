"use server";

// Menu read actions — owner: Gian surface, called by Mine (M3)
// Returns active menu items with their customisations, grouped for the POS.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuItems, menuCustomisations } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import type { ActionResult, MenuItem } from "@/lib/types";

/**
 * Fetch all active menu items with their customisation options.
 * Prices are server-resolved — never trust client-supplied prices.
 */
export async function getMenu(): Promise<ActionResult<MenuItem[]>> {
  const auth = await authorize("barista", "manager", "admin", "owner");
  if (!auth.ok) return auth;

  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.active, true))
    .orderBy(menuItems.category, menuItems.name);

  const customisations = await db
    .select()
    .from(menuCustomisations)
    .orderBy(menuCustomisations.name);

  const modsByItem = new Map<string, typeof customisations>();
  for (const mod of customisations) {
    if (!modsByItem.has(mod.menuItemId)) modsByItem.set(mod.menuItemId, []);
    modsByItem.get(mod.menuItemId)!.push(mod);
  }

  const menu: MenuItem[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    currentPriceZar: item.currentPriceZar,
    active: item.active,
    customisations: (modsByItem.get(item.id) ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      priceDeltaZar: m.priceDeltaZar,
    })),
  }));

  return { ok: true, data: menu };
}
