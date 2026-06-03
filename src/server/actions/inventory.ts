"use server";

// Inventory server actions — Phase 2 (G8 / G9 / G10 / G11 / G12)
// Functions marked STUB return fixture data until the real implementation
// is merged on its respective branch.
// Docs: docs/API.md · docs/DATA_MODEL.md · docs/BUSINESS_RULES.md L08 T04

import type {
  ActionResult,
  InventoryItemStatus,
  InventoryLot,
  InventoryStatusMap,
} from "@/lib/types";

// ─── Fixture data (removed once real implementations land) ───────────────────

const FIXTURE_ITEMS: InventoryItemStatus[] = [
  {
    id: "inv_item_espresso_beans",
    name: "Espresso Beans",
    kind: "bean",
    unit: "g",
    lowStockThreshold: 500,
    currentStock: 1800,
    status: "ok",
  },
  {
    id: "inv_item_whole_milk",
    name: "Full-Cream Milk",
    kind: "milk",
    unit: "ml",
    lowStockThreshold: 2000,
    currentStock: 3500,
    status: "ok",
  },
  {
    id: "inv_item_oat_milk",
    name: "Oat Milk",
    kind: "milk",
    unit: "ml",
    lowStockThreshold: 1000,
    currentStock: 800,
    status: "low",
  },
  {
    id: "inv_item_macadamia_milk",
    name: "Macadamia Milk",
    kind: "milk",
    unit: "ml",
    lowStockThreshold: 500,
    currentStock: 500,
    status: "ok",
  },
  {
    id: "inv_item_cup_8oz",
    name: "8 oz Cup",
    kind: "packaging",
    unit: "unit",
    lowStockThreshold: 50,
    currentStock: 175,
    status: "ok",
  },
  {
    id: "inv_item_cup_12oz",
    name: "12 oz Cup",
    kind: "packaging",
    unit: "unit",
    lowStockThreshold: 50,
    currentStock: 85,
    status: "ok",
  },
  {
    id: "inv_item_lid",
    name: "Cup Lid",
    kind: "packaging",
    unit: "unit",
    lowStockThreshold: 100,
    currentStock: 260,
    status: "ok",
  },
  {
    id: "inv_item_hot_choc_powder",
    name: "Hot Chocolate Powder",
    kind: "other",
    unit: "g",
    lowStockThreshold: 200,
    currentStock: 440,
    status: "ok",
  },
];

const FIXTURE_LOTS: InventoryLot[] = [
  {
    id: "lot_espresso_beans_001",
    inventoryItemId: "inv_item_espresso_beans",
    inventoryItemName: "Espresso Beans",
    sourceName: "Origin Coffee Roasters",
    batchNumber: "OCR-2026-05-01",
    roastDate: "2026-04-28T00:00:00Z",
    receivedAt: "2026-05-01T07:00:00Z",
    state: "active",
    origin: "Yirgacheffe · Konga",
    unitCostZar: "0.4500",
    quantityReceived: "2000.00",
    quantityRemaining: 1800,
  },
  {
    id: "lot_whole_milk_001",
    inventoryItemId: "inv_item_whole_milk",
    inventoryItemName: "Full-Cream Milk",
    sourceName: "Clover SA",
    batchNumber: "CLV-2026-05-01",
    roastDate: null,
    receivedAt: "2026-05-01T07:00:00Z",
    state: "active",
    origin: null,
    unitCostZar: "0.0280",
    quantityReceived: "4000.00",
    quantityRemaining: 3500,
  },
  {
    id: "lot_oat_milk_001",
    inventoryItemId: "inv_item_oat_milk",
    inventoryItemName: "Oat Milk",
    sourceName: "Oatly SA",
    batchNumber: "OAT-2026-05-01",
    roastDate: null,
    receivedAt: "2026-05-01T07:00:00Z",
    state: "active",
    origin: null,
    unitCostZar: "0.0450",
    quantityReceived: "2000.00",
    quantityRemaining: 800,
  },
  {
    id: "lot_cup_8oz_001",
    inventoryItemId: "inv_item_cup_8oz",
    inventoryItemName: "8 oz Cup",
    sourceName: "Bunzl SA",
    batchNumber: "BNZ-8OZ-2026-05",
    roastDate: null,
    receivedAt: "2026-05-01T07:00:00Z",
    state: "active",
    origin: null,
    unitCostZar: "120.0000",
    quantityReceived: "200.00",
    quantityRemaining: 175,
  },
  {
    id: "lot_lid_001",
    inventoryItemId: "inv_item_lid",
    inventoryItemName: "Cup Lid",
    sourceName: "Bunzl SA",
    batchNumber: "BNZ-LID-2026-05",
    roastDate: null,
    receivedAt: "2026-05-01T07:00:00Z",
    state: "active",
    origin: null,
    unitCostZar: "80.0000",
    quantityReceived: "300.00",
    quantityRemaining: 260,
  },
];

// ─── listInventory ────────────────────────────────────────────────────────────

/**
 * Returns all inventory items with their current running-stock and status.
 * Admin / finance / manager read.
 * TODO (P2 G12): replace fixture with real DB query.
 */
export async function listInventory(): Promise<
  ActionResult<{ items: InventoryItemStatus[] }>
> {
  // STUB — returns fixture data until G12 is merged.
  return { ok: true, data: { items: FIXTURE_ITEMS } };
}

// ─── listLots ─────────────────────────────────────────────────────────────────

/**
 * Returns lots for a specific inventory item, most-recently-received first.
 * Admin / finance / manager read.
 * TODO (P2 G12): replace fixture with real DB query.
 */
export async function listLots(
  inventoryItemId: string
): Promise<ActionResult<{ lots: InventoryLot[] }>> {
  // STUB — returns fixture lots for the requested item.
  const lots = FIXTURE_LOTS.filter(
    (l) => l.inventoryItemId === inventoryItemId
  );
  return { ok: true, data: { lots } };
}

// ─── listInventoryStatus ──────────────────────────────────────────────────────

/**
 * Lightweight map of itemId → status for POS low-stock badges (M9).
 * No auth required (POS reads this after PIN login via session cookie).
 * TODO (P2 G12): replace fixture with real DB query.
 */
export async function listInventoryStatus(): Promise<
  ActionResult<{ statusMap: InventoryStatusMap }>
> {
  // STUB — returns fixture map.
  const statusMap: InventoryStatusMap = Object.fromEntries(
    FIXTURE_ITEMS.map((item) => [item.id, item])
  );
  return { ok: true, data: { statusMap } };
}

// ─── getActiveBeanLot ─────────────────────────────────────────────────────────

/**
 * Returns the currently active espresso-bean lot for the POS bean card (M11).
 * No auth required (POS reads this post PIN login).
 * TODO (P2 G12): replace fixture with real DB query (FIFO active lot for
 *   inv_item_espresso_beans).
 */
export async function getActiveBeanLot(): Promise<
  ActionResult<{ lot: InventoryLot | null }>
> {
  // STUB — returns the seeded bean lot.
  const lot = FIXTURE_LOTS.find(
    (l) => l.inventoryItemId === "inv_item_espresso_beans"
  ) ?? null;
  return { ok: true, data: { lot } };
}

// ─── setItemThreshold ─────────────────────────────────────────────────────────

/**
 * Updates low_stock_threshold for an inventory item. Admin+ only.
 * TODO (P2 G12): implement real DB update + writeAudit.
 */
export async function setItemThreshold(
  inventoryItemId: string,
  threshold: number
): Promise<ActionResult> {
  void inventoryItemId;
  void threshold;
  // STUB — no-op until G12 is merged.
  return { ok: true, data: undefined };
}

// ─── updateLotCost ────────────────────────────────────────────────────────────

/**
 * Updates unit_cost_zar on a lot (admin recost — R10 mitigation). Admin+ only.
 * Also pings `cogs_changes` SSE channel so A7 refreshes within 5 s.
 * TODO (P2 G12): implement real DB update + writeAudit + pg_notify.
 */
export async function updateLotCost(
  lotId: string,
  newCostZar: string
): Promise<ActionResult> {
  void lotId;
  void newCostZar;
  // STUB — no-op until G12 is merged.
  return { ok: true, data: undefined };
}

// logWaste moved to src/server/actions/waste.ts        (G10)
// runStockTake moved to src/server/actions/stock-takes.ts (G11)
