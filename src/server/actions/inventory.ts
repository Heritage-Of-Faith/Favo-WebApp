"use server";

// Inventory server actions — G12 (real DB implementations)
// listInventory, listLots, listInventoryStatus, getActiveBeanLot:
//   admin/finance/manager read; POS reads listInventoryStatus post-login.
// setItemThreshold, updateLotCost: admin+ write + audit (L08) + cogs_changes notify.
// Docs: docs/API.md · docs/DATA_MODEL.md · docs/BUSINESS_RULES.md L08 T04

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryItems,
  inventoryLots,
  stockMovements,
} from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type {
  ActionResult,
  InventoryItemStatus,
  InventoryLot,
  InventoryStatusMap,
} from "@/lib/types";
import type { DB } from "@/lib/db";

const READER_ROLES = ["admin", "barista"] as const;
const ADMIN_ROLES = ["admin"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Running stock for a lot = SUM of all stock_movements.delta. */
async function lotRunningStock(lotId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.inventoryLotId, lotId));
  return row?.total ?? 0;
}

/** Running stock for an inventory item = SUM across ALL its lots. */
async function itemRunningStock(itemId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int`,
    })
    .from(stockMovements)
    .innerJoin(inventoryLots, eq(stockMovements.inventoryLotId, inventoryLots.id))
    .where(eq(inventoryLots.inventoryItemId, itemId));
  return row?.total ?? 0;
}

function deriveStatus(
  currentStock: number,
  threshold: number
): "ok" | "low" | "out" {
  if (currentStock <= 0) return "out";
  if (currentStock < threshold) return "low";
  return "ok";
}

// ─── listInventory ────────────────────────────────────────────────────────────

export async function listInventory(): Promise<
  ActionResult<{ items: InventoryItemStatus[] }>
> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const items = await db.select().from(inventoryItems);

  const result: InventoryItemStatus[] = await Promise.all(
    items.map(async (item) => {
      const currentStock = await itemRunningStock(item.id);
      return {
        id: item.id,
        name: item.name,
        kind: item.kind as InventoryItemStatus["kind"],
        unit: item.unit as InventoryItemStatus["unit"],
        lowStockThreshold: item.lowStockThreshold,
        currentStock,
        status: deriveStatus(currentStock, item.lowStockThreshold),
      };
    })
  );

  return { ok: true, data: { items: result } };
}

// ─── listLots ─────────────────────────────────────────────────────────────────

export async function listLots(
  inventoryItemId: string
): Promise<ActionResult<{ lots: InventoryLot[] }>> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const [item] = await db
    .select({ name: inventoryItems.name, unit: inventoryItems.unit })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, inventoryItemId));

  const itemName = item?.name ?? inventoryItemId;
  const isCup = item?.unit === "cup";

  const lots = await db
    .select()
    .from(inventoryLots)
    .where(eq(inventoryLots.inventoryItemId, inventoryItemId))
    .orderBy(desc(inventoryLots.receivedAt));

  const lotIds = lots.map((l) => l.id);

  // Preload aggregates in two grouped queries (keyed by lot) instead of 2×N
  // per-lot reads. cupsMade is only needed for cup containers (LotDrawer gates
  // on item.unit === 'cup'), so skip that query entirely otherwise.
  const remainingByLot = new Map<string, number>();
  if (lotIds.length > 0) {
    const rows = await db
      .select({
        lotId: stockMovements.inventoryLotId,
        total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int`,
      })
      .from(stockMovements)
      .where(inArray(stockMovements.inventoryLotId, lotIds))
      .groupBy(stockMovements.inventoryLotId);
    for (const r of rows) remainingByLot.set(r.lotId, r.total);
  }

  const cupsMadeByLot = new Map<string, number>();
  if (isCup && lotIds.length > 0) {
    const rows = await db
      .select({
        lotId: stockMovements.inventoryLotId,
        total: sql<number>`COALESCE(SUM(-${stockMovements.delta}), 0)::int`,
      })
      .from(stockMovements)
      .where(
        and(
          inArray(stockMovements.inventoryLotId, lotIds),
          eq(stockMovements.kind, "deduction")
        )
      )
      .groupBy(stockMovements.inventoryLotId);
    for (const r of rows) cupsMadeByLot.set(r.lotId, r.total);
  }

  const result: InventoryLot[] = lots.map((lot) => ({
    id: lot.id,
    inventoryItemId: lot.inventoryItemId,
    inventoryItemName: itemName,
    sourceName: lot.sourceName,
    batchNumber: lot.batchNumber,
    roastDate: lot.roastDate?.toISOString() ?? null,
    receivedAt: lot.receivedAt.toISOString(),
    state: lot.state as InventoryLot["state"],
    origin: lot.origin,
    unitCostZar: lot.unitCostZar,
    quantityReceived: lot.quantityReceived,
    quantityRemaining: remainingByLot.get(lot.id) ?? 0,
    openedAt: lot.openedAt?.toISOString() ?? null,
    closedAt: lot.closedAt?.toISOString() ?? null,
    ...(isCup ? { cupsMade: cupsMadeByLot.get(lot.id) ?? 0 } : {}),
  }));

  return { ok: true, data: { lots: result } };
}

// ─── listInventoryStatus ──────────────────────────────────────────────────────

/**
 * Lightweight map for POS low-stock badges (M9). No auth required beyond
 * a valid session — called after PIN login.
 */
export async function listInventoryStatus(): Promise<
  ActionResult<{ statusMap: InventoryStatusMap }>
> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const items = await db.select().from(inventoryItems);
  const statusMap: InventoryStatusMap = {};

  for (const item of items) {
    const currentStock = await itemRunningStock(item.id);
    statusMap[item.id] = {
      id: item.id,
      name: item.name,
      kind: item.kind as InventoryItemStatus["kind"],
      unit: item.unit as InventoryItemStatus["unit"],
      lowStockThreshold: item.lowStockThreshold,
      currentStock,
      status: deriveStatus(currentStock, item.lowStockThreshold),
    };
  }

  return { ok: true, data: { statusMap } };
}

// ─── getActiveBeanLot ─────────────────────────────────────────────────────────

export async function getActiveBeanLot(): Promise<
  ActionResult<{ lot: InventoryLot | null }>
> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const [lot] = await db
    .select()
    .from(inventoryLots)
    .where(eq(inventoryLots.inventoryItemId, "inv_item_espresso_beans"))
    .orderBy(asc(inventoryLots.receivedAt))
    .limit(1);

  if (!lot) return { ok: true, data: { lot: null } };

  return {
    ok: true,
    data: {
      lot: {
        id: lot.id,
        inventoryItemId: lot.inventoryItemId,
        inventoryItemName: "Espresso Beans",
        sourceName: lot.sourceName,
        batchNumber: lot.batchNumber,
        roastDate: lot.roastDate?.toISOString() ?? null,
        receivedAt: lot.receivedAt.toISOString(),
        state: lot.state as InventoryLot["state"],
        origin: lot.origin,
        unitCostZar: lot.unitCostZar,
        quantityReceived: lot.quantityReceived,
        quantityRemaining: await lotRunningStock(lot.id),
      },
    },
  };
}

// ─── setItemThreshold ─────────────────────────────────────────────────────────

export async function setItemThreshold(
  inventoryItemId: string,
  threshold: number
): Promise<ActionResult> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!Number.isInteger(threshold) || threshold < 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "threshold must be a non-negative integer.",
    };
  }

  const [item] = await db
    .select({ id: inventoryItems.id, lowStockThreshold: inventoryItems.lowStockThreshold })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, inventoryItemId));

  if (!item) {
    return { ok: false, code: "NOT_FOUND", message: "Inventory item not found." };
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    await tx
      .update(inventoryItems)
      .set({ lowStockThreshold: threshold })
      .where(eq(inventoryItems.id, inventoryItemId));

    await writeAudit(
      {
        entityKind: "inventory_item",
        entityId: inventoryItemId,
        action: "update",
        actorId: session.id,
        actorRole: session.role,
        before: { lowStockThreshold: item.lowStockThreshold },
        after: { lowStockThreshold: threshold },
      },
      txDb
    );
  });

  return { ok: true, data: undefined };
}

// ─── updateLotCost ────────────────────────────────────────────────────────────

/**
 * Admin recosts a lot (R10 mitigation). Pings cogs_changes so A7 refreshes.
 */
export async function updateLotCost(
  lotId: string,
  newCostZar: string
): Promise<ActionResult> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  const costNum = parseFloat(newCostZar);
  if (!Number.isFinite(costNum) || costNum < 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "newCostZar must be a non-negative numeric string.",
    };
  }

  const [lot] = await db
    .select({ id: inventoryLots.id, unitCostZar: inventoryLots.unitCostZar })
    .from(inventoryLots)
    .where(eq(inventoryLots.id, lotId));

  if (!lot) {
    return { ok: false, code: "NOT_FOUND", message: "Inventory lot not found." };
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    await tx
      .update(inventoryLots)
      .set({ unitCostZar: newCostZar })
      .where(eq(inventoryLots.id, lotId));

    await writeAudit(
      {
        entityKind: "inventory_lot",
        entityId: lotId,
        action: "recost",
        actorId: session.id,
        actorRole: session.role,
        before: { unitCostZar: lot.unitCostZar },
        after: { unitCostZar: newCostZar },
        reason: "admin_recost",
      },
      txDb
    );
  });

  // Notify COGS dashboard (non-fatal)
  db.execute(
    sql`SELECT pg_notify('cogs_changes', ${JSON.stringify({ lotId })})`
  ).catch(() => {});

  return { ok: true, data: undefined };
}

// logWaste moved to src/server/actions/waste.ts (G10)
// runStockTake moved to src/server/actions/stock-takes.ts (G11)
