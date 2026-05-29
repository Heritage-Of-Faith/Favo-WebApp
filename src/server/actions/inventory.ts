"use server";

import type { ActionResult } from "@/lib/types";

// Docs: docs/API.md → logWaste, runStockTake
// Phase 2 tasks — stub only for P1 scaffold

export type LogWasteInput = {
  category: string;
  inventoryLotId?: string;
  quantity: number;
  reason?: string;
};

// TODO (P2): Insert waste_log + stock_movements(kind='waste') atomically
export async function logWaste(input: LogWasteInput): Promise<ActionResult> {
  void input;
  throw new Error("Not implemented — Phase 2");
}

// TODO (P2): Create stock_takes; walk lots; compute variance on close
export async function runStockTake(
  kind: "full" | "spot"
): Promise<ActionResult<{ stockTakeId: string }>> {
  void kind;
  throw new Error("Not implemented — Phase 2");
}
