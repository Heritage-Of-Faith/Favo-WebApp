"use client";

// Inventory items table — task A8.
// Columns: name, kind, current stock, editable threshold, low-stock badge, lots.
// Presentational; state + drawer live in InventoryManager.

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import StatusBadge, { stockVariant } from "@/components/shared/StatusBadge";
import ThresholdEditor from "@/components/admin/ThresholdEditor";
import type { InventoryItemStatus } from "@/lib/types";

export interface InventoryTableProps {
  items: InventoryItemStatus[];
  onOpenLots: (item: InventoryItemStatus) => void;
  onThresholdSaved: (itemId: string, newValue: number) => void;
}

export default function InventoryTable({ items, onOpenLots, onThresholdSaved }: InventoryTableProps) {
  if (items.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-card)] border p-6 text-center favo-small"
        style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-muted)" }}
      >
        No inventory items found. Add items via the Purchases section to begin tracking stock.
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-card)] border"
      style={{ borderColor: "var(--color-border-subtle)" }}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead>Threshold</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Lots</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell style={{ fontWeight: 600, color: "var(--color-text-strong)" }}>
                {item.name}
              </TableCell>
              <TableCell style={{ color: "var(--color-text-muted)", textTransform: "capitalize" }}>
                {item.kind}
              </TableCell>
              <TableCell className="text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                {item.currentStock} {item.unit}
              </TableCell>
              <TableCell>
                <ThresholdEditor
                  itemId={item.id}
                  value={item.lowStockThreshold}
                  unit={item.unit}
                  onSaved={(n) => onThresholdSaved(item.id, n)}
                />
              </TableCell>
              <TableCell>
                <StatusBadge variant={stockVariant(item.status)} />
              </TableCell>
              <TableCell className="text-right">
                <button
                  type="button"
                  onClick={() => onOpenLots(item)}
                  className="min-h-10 rounded-[var(--radius-btn)] border px-3 favo-small transition-colors hover:bg-[color:var(--color-porcelain-soft)]"
                  style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-strong)" }}
                >
                  View lots
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
