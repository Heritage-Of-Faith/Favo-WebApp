"use client";

/**
 * useStockStatus — task M9.
 *
 * Gives the POS live awareness of inventory levels so it can badge / disable
 * menu tiles. Combines two server actions:
 *   - listRecipes()         → menu item id → required inventory item ids
 *   - listInventoryStatus() → inventory item id → ok | low | out
 *
 * The recipe map is fetched once (recipes rarely change mid-shift); the status
 * map is re-polled every 30 s so a restock re-enables tiles within one cycle.
 *
 * `inventory_changes` SSE is not yet emitted by the backend (G9 follow-up);
 * polling is the contracted mechanism per the Phase 2 plan. When the channel
 * lands, `refresh()` can be wired to it for instant updates.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { listInventoryStatus } from "@/server/actions/inventory";
import { listRecipes } from "@/server/actions/recipes";
import type { InventoryStatusMap } from "@/lib/types";

export type StockState = "ok" | "low" | "out";

const POLL_MS = 30_000;

export function useStockStatus() {
  const [statusMap, setStatusMap] = useState<InventoryStatusMap>({});
  const [recipeMap, setRecipeMap] = useState<Record<string, string[]>>({});
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const r = await listInventoryStatus();
    if (r.ok) setStatusMap(r.data.statusMap);
  }, []);

  useEffect(() => {
    let mounted = true;

    // Recipe map: menuItemId → [inventoryItemId]
    listRecipes().then((r) => {
      if (mounted && r.ok) {
        const map: Record<string, string[]> = {};
        for (const rec of r.data.recipes) {
          map[rec.menuItemId] = rec.ingredients.map((i) => i.inventoryItemId);
        }
        setRecipeMap(map);
      }
    });

    // Initial status + poll
    refresh().finally(() => mounted && setLoaded(true));
    timerRef.current = setInterval(refresh, POLL_MS);

    return () => {
      mounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  /**
   * Worst stock state across a menu item's ingredients.
   * out (any ingredient ≤ 0) > low (any below threshold) > ok.
   * Returns "ok" when the item has no known recipe (e.g. merch).
   */
  const menuItemStock = useCallback(
    (menuItemId: string): StockState => {
      const ingredientIds = recipeMap[menuItemId];
      if (!ingredientIds || ingredientIds.length === 0) return "ok";
      let worst: StockState = "ok";
      for (const id of ingredientIds) {
        const s = statusMap[id]?.status;
        if (s === "out") return "out";
        if (s === "low") worst = "low";
      }
      return worst;
    },
    [recipeMap, statusMap]
  );

  /** Inventory items currently out of stock (for the banner). */
  const outOfStockItems = Object.values(statusMap)
    .filter((s) => s.status === "out")
    .map((s) => s.name);

  return { menuItemStock, outOfStockItems, statusMap, loaded, refresh };
}
