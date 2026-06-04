// ⚠️ PLACEHOLDER DATA — owner: Mia (task A5)
// ───────────────────────────────────────────────────────────────────────────
// Gian's menu Server Actions do not all exist on `main` yet. `setMenuItemPrice`
// is documented in API.md but unbuilt; `getMenu` and a price-history reader are
// not yet built either. This module fakes them IN THE BROWSER so the A5 UI is
// fully reviewable now.
//
// Names + argument order + `ActionResult<T>` return shape match what Gian's real
// actions will use, so wiring the real backend later is a one-line import swap:
//     import { getMenu, setMenuItemPrice } from "@/lib/menu-placeholders"; ← drop
//     import { getMenu, setMenuItemPrice } from "@/server/actions/menu";   ← use
// `setMenuItemPrice` mirrors API.md: closes the current price_history row and
// inserts a new one. Money is integer cents (R38.00 = 3800). Then delete this file.
// ───────────────────────────────────────────────────────────────────────────

import type { ActionResult, MenuItem } from "@/lib/types";

// One history row per price period (matches db `price_history`).
export type PriceHistoryEntry = {
  priceZar: number;
  // ISO timestamps; effectiveUntil null == current price.
  effectiveFrom: string;
  effectiveUntil: string | null;
};

// Seeded from db/seed/menu.ts (subset) so the placeholder mirrors real data.
let MENU: MenuItem[] = [
  { id: "menu_espresso", name: "Espresso", category: "coffee", currentPriceZar: 2500, active: true, customisations: [] },
  { id: "menu_americano", name: "Americano", category: "coffee", currentPriceZar: 3000, active: true, customisations: [] },
  { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 3800, active: true, customisations: [] },
  { id: "menu_flat_white", name: "Flat White", category: "coffee", currentPriceZar: 4000, active: true, customisations: [] },
  { id: "menu_latte", name: "Latte", category: "coffee", currentPriceZar: 4200, active: true, customisations: [] },
  { id: "menu_cold_brew", name: "Cold Brew", category: "cold_brew", currentPriceZar: 4800, active: true, customisations: [] },
  { id: "menu_rooibos", name: "Rooibos Tea", category: "tea", currentPriceZar: 2800, active: true, customisations: [] },
];

// Per-item price history, newest first. Current period has effectiveUntil null.
const HISTORY: Record<string, PriceHistoryEntry[]> = {
  menu_cappuccino: [
    { priceZar: 3800, effectiveFrom: "2026-05-01T08:00:00+02:00", effectiveUntil: null },
    { priceZar: 3500, effectiveFrom: "2026-01-15T08:00:00+02:00", effectiveUntil: "2026-05-01T08:00:00+02:00" },
    { priceZar: 3200, effectiveFrom: "2025-09-01T08:00:00+02:00", effectiveUntil: "2026-01-15T08:00:00+02:00" },
  ],
};

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function getMenu(): Promise<ActionResult<MenuItem[]>> {
  return delay({ ok: true, data: [...MENU] });
}

export async function getPriceHistory(
  menuItemId: string
): Promise<ActionResult<PriceHistoryEntry[]>> {
  const item = MENU.find((m) => m.id === menuItemId);
  if (!item) {
    return delay({ ok: false, code: "NOT_FOUND", message: "Menu item not found." });
  }
  const rows = HISTORY[menuItemId] ?? [
    { priceZar: item.currentPriceZar, effectiveFrom: "2026-01-01T08:00:00+02:00", effectiveUntil: null },
  ];
  return delay({ ok: true, data: rows });
}

export async function setMenuItemPrice(
  id: string,
  priceZar: number
): Promise<ActionResult> {
  const item = MENU.find((m) => m.id === id);
  if (!item) {
    return delay({ ok: false, code: "NOT_FOUND", message: "Menu item not found." });
  }
  if (!Number.isInteger(priceZar) || priceZar <= 0) {
    return delay({
      ok: false,
      code: "VALIDATION",
      message: "Price must be a positive amount.",
    });
  }
  // Real action closes the open price_history row + inserts a new one; the
  // placeholder mimics the visible effect (update current price + history).
  const nowIso = "2026-06-01T08:00:00+02:00";
  const prev = HISTORY[id] ?? [];
  if (prev[0]) prev[0] = { ...prev[0], effectiveUntil: nowIso };
  HISTORY[id] = [
    { priceZar, effectiveFrom: nowIso, effectiveUntil: null },
    ...prev,
  ];
  MENU = MENU.map((m) => (m.id === id ? { ...m, currentPriceZar: priceZar } : m));
  return delay({ ok: true, data: undefined });
}
