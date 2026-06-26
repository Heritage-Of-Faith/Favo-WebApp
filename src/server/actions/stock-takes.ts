"use server";

// Stock-take server actions — task G11
// runStockTake:        creates take + pre-fills lines for every active lot.
// recordStockTakeLine: updates one line's counted + recomputes variance.
// closeStockTake:      gates on full coverage; inserts corrective movements
//                      for variance > T01 threshold; writes variancePct.
// listStockTakes:      admin + finance + manager read.
// Docs: docs/API.md · docs/BUSINESS_RULES.md L08 T01

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  stockTakes,
  stockTakeLines,
  inventoryLots,
  inventoryItems,
  stockMovements,
  staff,
} from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import {
  computeLinePct,
  computeWeightedVariancePct,
} from "@/server/inventory/variance";
import type { ActionResult, StockTake, StockTakeLine, StockTakeKind } from "@/lib/types";
import type { DB } from "@/lib/db";

const ADMIN_ROLES = ["admin"] as const;
const READER_ROLES = ["admin"] as const;

// T01: variance % above this threshold triggers a corrective stock_movement
const VARIANCE_ADJUSTMENT_THRESHOLD_PCT = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute the running stock for a lot (SUM of all deltas). */
async function lotRunningStock(lotId: string, tx: DB): Promise<number> {
  const [row] = await tx
    .select({
      total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.inventoryLotId, lotId));
  return row?.total ?? 0;
}

// ─── listStockTakes ───────────────────────────────────────────────────────────

export async function listStockTakes(input?: {
  kind?: StockTakeKind;
  includeLines?: boolean;
}): Promise<ActionResult<{ takes: StockTake[]; total: number }>> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const rows = await db
    .select({
      id: stockTakes.id,
      kind: stockTakes.kind,
      startedAt: stockTakes.startedAt,
      completedAt: stockTakes.completedAt,
      byStaffId: stockTakes.byStaffId,
      staffName: staff.name,
      variancePct: stockTakes.variancePct,
    })
    .from(stockTakes)
    .innerJoin(staff, eq(stockTakes.byStaffId, staff.id))
    .where(input?.kind ? eq(stockTakes.kind, input.kind) : undefined)
    .orderBy(desc(stockTakes.startedAt));

  const takes: StockTake[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as StockTakeKind,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    byStaffId: r.byStaffId,
    byStaffName: r.staffName,
    variancePct: r.variancePct,
    lines: [], // lines loaded on demand via getStockTake
  }));

  return { ok: true, data: { takes, total: takes.length } };
}

// ─── getStockTake ─────────────────────────────────────────────────────────────

export async function getStockTake(
  takeId: string
): Promise<ActionResult<{ take: StockTake }>> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const [take] = await db
    .select({
      id: stockTakes.id,
      kind: stockTakes.kind,
      startedAt: stockTakes.startedAt,
      completedAt: stockTakes.completedAt,
      byStaffId: stockTakes.byStaffId,
      staffName: staff.name,
      variancePct: stockTakes.variancePct,
    })
    .from(stockTakes)
    .innerJoin(staff, eq(stockTakes.byStaffId, staff.id))
    .where(eq(stockTakes.id, takeId));

  if (!take) {
    return { ok: false, code: "NOT_FOUND", message: "Stock take not found." };
  }

  const lineRows = await db
    .select({
      id: stockTakeLines.id,
      inventoryLotId: stockTakeLines.inventoryLotId,
      expected: stockTakeLines.expected,
      counted: stockTakeLines.counted,
      variance: stockTakeLines.variance,
      // Fix: was selecting inventoryItemId (a UUID) — join to inventoryItems for actual name
      itemName: inventoryItems.name,
      unit: inventoryItems.unit,
      itemKind: inventoryItems.kind,
      lotReceivedAt: inventoryLots.receivedAt,
      lotSourceName: inventoryLots.sourceName,
      roastDate: inventoryLots.roastDate,
    })
    .from(stockTakeLines)
    .leftJoin(inventoryLots, eq(stockTakeLines.inventoryLotId, inventoryLots.id))
    .leftJoin(inventoryItems, eq(inventoryLots.inventoryItemId, inventoryItems.id))
    .where(eq(stockTakeLines.stockTakeId, takeId));

  const lines: StockTakeLine[] = lineRows.map((l) => ({
    id: l.id,
    inventoryLotId: l.inventoryLotId,
    inventoryItemName: l.itemName ?? "Unknown item",
    unit: l.unit ?? null,
    itemKind: l.itemKind ?? null,
    lotReceivedAt: l.lotReceivedAt?.toISOString() ?? null,
    lotSourceName: l.lotSourceName ?? null,
    roastDate: l.roastDate?.toISOString() ?? null,
    expected: l.expected,
    counted: l.counted ?? null,
    variancePct: l.counted !== null && l.counted !== undefined
      ? computeLinePct(l.expected, l.counted)
      : null,
  }));

  return {
    ok: true,
    data: {
      take: {
        id: take.id,
        kind: take.kind as StockTakeKind,
        startedAt: take.startedAt.toISOString(),
        completedAt: take.completedAt?.toISOString() ?? null,
        byStaffId: take.byStaffId,
        byStaffName: take.staffName,
        variancePct: take.variancePct,
        lines,
      },
    },
  };
}

// ─── runStockTake ─────────────────────────────────────────────────────────────

/**
 * Creates a new stock-take and pre-fills one line per active lot.
 * expected = running stock at take-creation time.
 * counted = null until recordStockTakeLine is called for each lot.
 * Admin+ only.
 */
export async function runStockTake(
  kind: StockTakeKind
): Promise<ActionResult<{ stockTakeId: string }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  let stockTakeId!: string;

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    // 1. Create the take header
    const [take] = await tx
      .insert(stockTakes)
      .values({ kind, byStaffId: session.id })
      .returning({ id: stockTakes.id });

    stockTakeId = take.id;

    // 2. Find all physically-present lots: sealed (active) plus the in-use OPEN
    //    container for cup items. Closed/depleted/expired lots are empty and
    //    excluded. Without 'open' here the draining container is never counted.
    const lots = await tx
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .where(inArray(inventoryLots.state, ["active", "open"]));

    // 3. Pre-fill lines with expected = running stock per lot
    for (const lot of lots) {
      const expected = await lotRunningStock(lot.id, txDb);
      await tx.insert(stockTakeLines).values({
        stockTakeId,
        inventoryLotId: lot.id,
        expected,
        counted: null,
        variance: null,
      });
    }

    // 4. Audit
    await writeAudit(
      {
        entityKind: "stock_take",
        entityId: stockTakeId,
        action: "create",
        actorId: session.id,
        actorRole: session.role,
        before: null,
        after: { kind, lotCount: lots.length },
      },
      txDb
    );
  });

  return { ok: true, data: { stockTakeId } };
}

// ─── recordStockTakeLine ──────────────────────────────────────────────────────

/**
 * Updates one stock-take line with the physically-counted quantity.
 * Recomputes variance = counted − expected.
 * Admin+ only.
 */
export async function recordStockTakeLine(
  takeId: string,
  lotId: string,
  counted: number
): Promise<ActionResult> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  if (!Number.isInteger(counted) || counted < 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "counted must be a non-negative integer.",
    };
  }

  // Load the line
  const [line] = await db
    .select({ id: stockTakeLines.id, expected: stockTakeLines.expected })
    .from(stockTakeLines)
    .where(
      and(
        eq(stockTakeLines.stockTakeId, takeId),
        eq(stockTakeLines.inventoryLotId, lotId)
      )
    );

  if (!line) {
    return { ok: false, code: "NOT_FOUND", message: "Stock take line not found." };
  }

  const variance = counted - line.expected;

  await db
    .update(stockTakeLines)
    .set({ counted, variance })
    .where(eq(stockTakeLines.id, line.id));

  return { ok: true, data: undefined };
}

// ─── closeStockTake ───────────────────────────────────────────────────────────

/**
 * Closes a stock-take after all lines have a counted value.
 *
 * 1. Guards: every line must be counted.
 * 2. Computes weighted variancePct across all lines.
 * 3. For any line with |variancePct| > T01 threshold (5%), inserts a corrective
 *    stock_movements row (kind='adjustment', delta = counted - expected) so
 *    running-stock matches reality.
 * 4. Sets completedAt and variancePct on the take.
 * 5. writeAudit (L08).
 *
 * Admin+ only.
 */
export async function closeStockTake(takeId: string): Promise<ActionResult> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  const [take] = await db
    .select({ id: stockTakes.id, completedAt: stockTakes.completedAt })
    .from(stockTakes)
    .where(eq(stockTakes.id, takeId));

  if (!take) {
    return { ok: false, code: "NOT_FOUND", message: "Stock take not found." };
  }
  if (take.completedAt) {
    return { ok: false, code: "CONFLICT", message: "Stock take is already closed." };
  }

  // Load all lines
  const lines = await db
    .select({
      id: stockTakeLines.id,
      inventoryLotId: stockTakeLines.inventoryLotId,
      expected: stockTakeLines.expected,
      counted: stockTakeLines.counted,
    })
    .from(stockTakeLines)
    .where(eq(stockTakeLines.stockTakeId, takeId));

  // Guard: every line must be counted
  const uncounted = lines.filter((l) => l.counted === null || l.counted === undefined);
  if (uncounted.length > 0) {
    return {
      ok: false,
      code: "INCOMPLETE",
      message: `${uncounted.length} lot(s) not yet counted. Count all lots before closing.`,
    };
  }

  const countedLines = lines as { id: string; inventoryLotId: string; expected: number; counted: number }[];
  const variancePct = computeWeightedVariancePct(countedLines);

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    // Insert corrective movements for lines outside the T01 threshold
    for (const line of countedLines) {
      const linePct = computeLinePct(line.expected, line.counted);
      if (linePct > VARIANCE_ADJUSTMENT_THRESHOLD_PCT) {
        const delta = line.counted - line.expected;
        await tx.insert(stockMovements).values({
          inventoryLotId: line.inventoryLotId,
          delta,
          kind: "adjustment",
          byStaffId: session.id,
        });
        await writeAudit(
          {
            entityKind: "inventory_lot",
            entityId: line.inventoryLotId,
            action: "stock_take_variance_adjustment",
            actorId: session.id,
            actorRole: session.role,
            before: { stock: line.expected },
            after: { stock: line.counted, variancePct: linePct },
            reason: `stock_take_variance_adjustment · take:${takeId}`,
          },
          txDb
        );
      }
    }

    // Close the take
    await tx
      .update(stockTakes)
      .set({ completedAt: new Date(), variancePct })
      .where(eq(stockTakes.id, takeId));

    await writeAudit(
      {
        entityKind: "stock_take",
        entityId: takeId,
        action: "close",
        actorId: session.id,
        actorRole: session.role,
        before: { completedAt: null },
        after: { completedAt: new Date().toISOString(), variancePct },
      },
      txDb
    );
  });

  return { ok: true, data: undefined };
}
