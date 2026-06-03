"use server";

// Stock-take server actions — Phase 2 G11
// runStockTake, recordStockTakeLine, closeStockTake: admin+ only.
// listStockTakes: admin + finance read.
// Docs: docs/API.md · docs/BUSINESS_RULES.md L08 T01

import type { ActionResult, StockTake, StockTakeKind } from "@/lib/types";

// ─── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_STOCK_TAKES: StockTake[] = [
  {
    id: "st_001",
    kind: "full",
    startedAt: "2026-05-25T08:00:00+02:00",
    completedAt: "2026-05-25T09:15:00+02:00",
    byStaffId: "staff_manager_mia",
    byStaffName: "Mia Manager",
    variancePct: 3,
    lines: [
      {
        id: "stl_001_beans",
        inventoryLotId: "lot_espresso_beans_001",
        inventoryItemName: "Espresso Beans",
        expected: 2000,
        counted: 1940,
        variancePct: 3,
      },
      {
        id: "stl_001_milk",
        inventoryLotId: "lot_whole_milk_001",
        inventoryItemName: "Full-Cream Milk",
        expected: 4000,
        counted: 3920,
        variancePct: 2,
      },
    ],
  },
  {
    id: "st_002",
    kind: "spot",
    startedAt: "2026-05-30T08:00:00+02:00",
    completedAt: null,
    byStaffId: "staff_manager_mia",
    byStaffName: "Mia Manager",
    variancePct: null,
    lines: [
      {
        id: "stl_002_oat",
        inventoryLotId: "lot_oat_milk_001",
        inventoryItemName: "Oat Milk",
        expected: 1200,
        counted: null,
        variancePct: null,
      },
    ],
  },
];

// ─── listStockTakes ───────────────────────────────────────────────────────────

/**
 * Lists stock takes, most-recent first.
 * Admin + finance + manager read.
 * TODO (P2 G11): replace fixture with real DB query.
 */
export async function listStockTakes(input?: {
  kind?: StockTakeKind;
  includeLines?: boolean; // default false — lines fetched per-take by UI
}): Promise<ActionResult<{ takes: StockTake[]; total: number }>> {
  void input;
  // STUB — returns fixture data until G11 is merged.
  return {
    ok: true,
    data: { takes: FIXTURE_STOCK_TAKES, total: FIXTURE_STOCK_TAKES.length },
  };
}

// ─── getStockTake ─────────────────────────────────────────────────────────────

/**
 * Returns a single stock-take with all lines (for the walk-lots UI in A9).
 * TODO (P2 G11): real implementation.
 */
export async function getStockTake(
  takeId: string
): Promise<ActionResult<{ take: StockTake }>> {
  void takeId;
  // STUB — returns first fixture take.
  return { ok: true, data: { take: FIXTURE_STOCK_TAKES[0] } };
}

// ─── runStockTake ─────────────────────────────────────────────────────────────

/**
 * Creates a new stock-take and pre-fills lines for every active lot.
 * Admin+ only.  writeAudit on creation (L08).
 * TODO (P2 G11): real implementation — see src/server/actions/stock-takes.ts.
 */
export async function runStockTake(
  kind: StockTakeKind
): Promise<ActionResult<{ stockTakeId: string }>> {
  void kind;
  throw new Error("Not implemented — Phase 2 G11");
}

// ─── recordStockTakeLine ──────────────────────────────────────────────────────

/**
 * Updates one line's counted value and recomputes its variance.
 * Admin+ only.
 * TODO (P2 G11): real implementation.
 */
export async function recordStockTakeLine(
  takeId: string,
  lotId: string,
  counted: number
): Promise<ActionResult> {
  void takeId;
  void lotId;
  void counted;
  throw new Error("Not implemented — Phase 2 G11");
}

// ─── closeStockTake ───────────────────────────────────────────────────────────

/**
 * Closes a take after all lines are counted. Computes weighted variance;
 * inserts corrective stock_movements rows for variance > T01 threshold.
 * Admin+ only.  writeAudit per adjustment (L08).
 * TODO (P2 G11): real implementation.
 */
export async function closeStockTake(takeId: string): Promise<ActionResult> {
  void takeId;
  throw new Error("Not implemented — Phase 2 G11");
}
