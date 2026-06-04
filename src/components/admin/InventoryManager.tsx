"use client";

// Inventory manager — task A8 orchestrator.
// Holds the item list + lot-drawer state, refreshes from listInventory after
// edits that change stock/cost.

import { useState } from "react";
import { listInventory } from "@/server/actions/inventory";
import InventoryTable from "@/components/admin/InventoryTable";
import LotDrawer from "@/components/admin/LotDrawer";
import type { InventoryItemStatus } from "@/lib/types";

export interface InventoryManagerProps {
  initialItems: InventoryItemStatus[];
}

export default function InventoryManager({ initialItems }: InventoryManagerProps) {
  const [items, setItems] = useState<InventoryItemStatus[]>(initialItems);
  const [drawerItem, setDrawerItem] = useState<InventoryItemStatus | null>(null);

  async function refresh() {
    const res = await listInventory();
    if (res.ok) setItems(res.data.items);
  }

  return (
    <div className="space-y-4">
      <InventoryTable
        items={items}
        onOpenLots={setDrawerItem}
        onThresholdSaved={(itemId, newValue) =>
          setItems((prev) =>
            prev.map((it) => (it.id === itemId ? { ...it, lowStockThreshold: newValue } : it))
          )
        }
      />
      <LotDrawer
        item={drawerItem}
        onClose={() => setDrawerItem(null)}
        onCostUpdated={() => void refresh()}
      />
    </div>
  );
}
