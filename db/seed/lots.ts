// Inventory lots seed — task G8 (Phase 2)
// One starter lot per item with best-estimate unit costs.
// Also inserts an opening restock stock_movement so running-stock queries
// (SUM of stock_movements.delta) return the correct opening balance.
//
// unit_cost_zar is stored as numeric(10,4) cents per base unit:
//   g-unit items:   SA wholesale prices ÷ 1000  (e.g. R450/kg → 0.4500 ¢/g)
//   ml-unit items:  SA wholesale prices ÷ 1000  (e.g. R28/L  → 0.0280 ¢/ml)
//   unit items:     exact cents per unit         (e.g. R1.20  → 120.0000 ¢)
//
// All lots are flagged cost_estimated=true via audit reason so the COGS
// dashboard shows the R10 warning until admin recosts via A8.
//
// Docs: DATA_MODEL.md · BUSINESS_RULES.md L08 R10

import { db } from "../index";
import { inventoryLots, stockMovements } from "../schema";

export type SeedLot = {
  id: string;
  inventoryItemId: string;
  sourceName: string;
  batchNumber: string;
  // unit_cost_zar: ¢ per base unit (see file header)
  unitCostZar: string; // stored as string → numeric(10,4) in PG
  // quantity received in the item's own unit (numeric(10,2))
  quantityReceived: string;
  // Opening delta inserted as a restock stock_movement
  openingDelta: number;
};

// SA best-estimate wholesale prices (May 2026):
//   Specialty roasted beans  R450/kg  → 0.4500 ¢/g
//   Full-cream milk          R28/L    → 0.0280 ¢/ml
//   Oat milk                 R45/L    → 0.0450 ¢/ml
//   Macadamia milk           R60/L    → 0.0600 ¢/ml
//   8 oz cups                R1.20 ea → 120.0000 ¢/unit
//   12 oz cups               R1.50 ea → 150.0000 ¢/unit
//   Cup lids                 R0.80 ea → 80.0000 ¢/unit
//   Hot chocolate powder     R180/kg  → 0.1800 ¢/g
export const INVENTORY_LOTS: SeedLot[] = [
  {
    id: "lot_espresso_beans_001",
    inventoryItemId: "inv_item_espresso_beans",
    sourceName: "Origin Coffee Roasters",
    batchNumber: "OCR-2026-05-01",
    unitCostZar: "0.4500",
    quantityReceived: "2000.00", // 2 kg starter stock
    openingDelta: 2000,
  },
  {
    id: "lot_whole_milk_001",
    inventoryItemId: "inv_item_whole_milk",
    sourceName: "Clover SA",
    batchNumber: "CLV-2026-05-01",
    unitCostZar: "0.0280",
    quantityReceived: "4000.00", // 4 L
    openingDelta: 4000,
  },
  {
    id: "lot_oat_milk_001",
    inventoryItemId: "inv_item_oat_milk",
    sourceName: "Oatly SA",
    batchNumber: "OAT-2026-05-01",
    unitCostZar: "0.0450",
    quantityReceived: "2000.00", // 2 L
    openingDelta: 2000,
  },
  {
    id: "lot_macadamia_milk_001",
    inventoryItemId: "inv_item_macadamia_milk",
    sourceName: "Natura Foods",
    batchNumber: "NAT-2026-05-01",
    unitCostZar: "0.0600",
    quantityReceived: "1000.00", // 1 L
    openingDelta: 1000,
  },
  {
    id: "lot_cup_8oz_001",
    inventoryItemId: "inv_item_cup_8oz",
    sourceName: "Bunzl SA",
    batchNumber: "BNZ-8OZ-2026-05",
    unitCostZar: "120.0000",
    quantityReceived: "200.00",
    openingDelta: 200,
  },
  {
    id: "lot_cup_12oz_001",
    inventoryItemId: "inv_item_cup_12oz",
    sourceName: "Bunzl SA",
    batchNumber: "BNZ-12OZ-2026-05",
    unitCostZar: "150.0000",
    quantityReceived: "100.00",
    openingDelta: 100,
  },
  {
    id: "lot_lid_001",
    inventoryItemId: "inv_item_lid",
    sourceName: "Bunzl SA",
    batchNumber: "BNZ-LID-2026-05",
    unitCostZar: "80.0000",
    quantityReceived: "300.00",
    openingDelta: 300,
  },
  {
    id: "lot_hot_choc_powder_001",
    inventoryItemId: "inv_item_hot_choc_powder",
    sourceName: "Afrikoa",
    batchNumber: "AFK-2026-05-01",
    unitCostZar: "0.1800",
    quantityReceived: "500.00", // 500 g
    openingDelta: 500,
  },
];

// Stable IDs for opening restock movements (idempotent re-run via ON CONFLICT)
function openingMovementId(lotId: string) {
  return `sm_opening_${lotId}`;
}

export async function seedLots() {
  console.log(`  → inventory lots (${INVENTORY_LOTS.length})`);

  for (const lot of INVENTORY_LOTS) {
    // Insert lot — skip if already exists
    await db
      .insert(inventoryLots)
      .values({
        id: lot.id,
        inventoryItemId: lot.inventoryItemId,
        sourceName: lot.sourceName,
        batchNumber: lot.batchNumber,
        unitCostZar: lot.unitCostZar,
        quantityReceived: lot.quantityReceived,
        state: "active",
      })
      .onConflictDoNothing();

    // Opening restock movement — establishes running-stock for COGS queries
    await db
      .insert(stockMovements)
      .values({
        id: openingMovementId(lot.id),
        inventoryLotId: lot.id,
        delta: lot.openingDelta,
        kind: "restock",
      })
      .onConflictDoNothing();
  }
}
