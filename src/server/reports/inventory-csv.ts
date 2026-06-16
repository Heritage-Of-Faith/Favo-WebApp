// Inventory CSV renderer — task G21 (AT-62)
// Exports active lots with item name, origin, qty remaining, and last movement.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function buildInventoryCsv(): Promise<string> {
  const rows = await db.execute<{
    lot_id: string;
    item: string;
    origin: string | null;
    qty_remaining: number;
    last_movement_at: string | null;
    state: string;
  }>(sql`
    SELECT
      il.id AS lot_id,
      ii.name AS item,
      il.origin,
      COALESCE(SUM(sm.delta), 0) AS qty_remaining,
      MAX(sm.at AT TIME ZONE 'Africa/Johannesburg') AS last_movement_at,
      il.state
    FROM inventory_lots il
    JOIN inventory_items ii ON il.inventory_item_id = ii.id
    LEFT JOIN stock_movements sm ON sm.inventory_lot_id = il.id
    GROUP BY il.id, ii.name, il.origin, il.state
    ORDER BY ii.name, il.received_at DESC
  `);

  const headers = ["Lot ID", "Item", "Origin", "Qty Remaining", "Last Movement (SAST)", "State"];
  const lines = [headers.map(csvCell).join(",")];

  for (const r of rows) {
    lines.push(
      [r.lot_id, r.item, r.origin, r.qty_remaining, r.last_movement_at ?? "", r.state]
        .map(csvCell)
        .join(",")
    );
  }

  return "﻿" + lines.join("\r\n");
}
