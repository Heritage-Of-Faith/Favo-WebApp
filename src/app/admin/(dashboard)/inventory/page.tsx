// Inventory management — task A8.
// Items table with editable thresholds + a lot drawer for recosting (R10).
// Docs: DATA_MODEL.md, API.md, BUSINESS_RULES.md T04.
import Link from "next/link";
import type { Route } from "next";
import { listInventory } from "@/server/actions/inventory";
import InventoryManager from "@/components/admin/InventoryManager";

export const metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const res = await listInventory();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="favo-h2" style={{ color: "var(--color-text-strong)" }}>
            Inventory
          </h1>
          <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
            Stock levels, thresholds, and lot costs. Edit a lot cost to keep COGS accurate (R10).
          </p>
        </div>
        <Link
          href={"/admin/inventory/recipients" as Route}
          className="inline-flex min-h-10 items-center rounded-[var(--radius-btn)] border px-3 favo-small transition-colors hover:bg-[color:var(--color-porcelain-soft)]"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-strong)" }}
        >
          Low-stock recipients →
        </Link>
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
