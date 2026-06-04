// Inventory management — task A8.
// Items table with editable thresholds + a lot drawer for recosting (R10).
// Docs: DATA_MODEL.md, API.md, BUSINESS_RULES.md T04.

import { listInventory } from "@/server/actions/inventory";
import InventoryManager from "@/components/admin/InventoryManager";

export default async function InventoryPage() {
  const res = await listInventory();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="favo-h2" style={{ color: "var(--color-text-strong)" }}>
          Inventory
        </h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Stock levels, thresholds, and lot costs. Edit a lot cost to keep COGS accurate (R10).
        </p>
      </header>

      {res.ok ? (
        <InventoryManager initialItems={res.data.items} />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      )}
    </div>
  );
}
