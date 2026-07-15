"use server";

// Purchase server actions — task G10
// recordPurchase: all staff can record; emergency kind requires admin approval
//   unless the caller is admin/owner (L10).
// approveEmergencyPurchase: admin/owner only.
// listPurchases: admin + finance + manager read.
// Docs: docs/API.md · docs/BUSINESS_RULES.md L08 L10

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  purchases,
  inventoryLots,
  stockMovements,
  inventoryItems,
} from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type {
  ActionResult,
  Purchase,
  PurchaseKind,
  RecordPurchaseInput,
} from "@/lib/types";
import type { DB } from "@/lib/db";

const READER_ROLES = ["admin"] as const;
const ADMIN_ROLES = ["admin"] as const;
const RECORDER_ROLES = ["barista", "admin"] as const;

// Input types (PurchaseLotItem, RecordPurchaseInput) now live in @/lib/types so
// both this action and the admin PurchaseForm share one definition.

// ─── getHistoricalCostPerCup ──────────────────────────────────────────────────

/**
 * Auto-learned cost/cup for a container item (milk & beans), used as the live
 * COGS estimate for a lot while it's still open — never a value the admin
 * types in. Weighted average of (containerCostZar / cupsMade) across every
 * CLOSED lot of this item that actually made at least one cup. Returns null
 * if no closed lot with real yield data exists yet (e.g. the very first
 * container ever bought for this item) — COGS simply won't count it until
 * one does, rather than guessing.
 */
async function getHistoricalCostPerCup(
  inventoryItemId: string,
  tx: DB
): Promise<string | null> {
  const closedLots = await tx
    .select({ id: inventoryLots.id, containerCostZar: inventoryLots.containerCostZar })
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.inventoryItemId, inventoryItemId),
        eq(inventoryLots.state, "closed"),
        isNotNull(inventoryLots.containerCostZar)
      )
    );
  if (closedLots.length === 0) return null;

  const lotIds = closedLots.map((l) => l.id);
  const cupsRows = await tx
    .select({
      lotId: stockMovements.inventoryLotId,
      cups: sql<number>`coalesce(sum(-${stockMovements.delta}), 0)::int`,
    })
    .from(stockMovements)
    .where(and(inArray(stockMovements.inventoryLotId, lotIds), eq(stockMovements.kind, "deduction")))
    .groupBy(stockMovements.inventoryLotId);
  const cupsByLot = new Map(cupsRows.map((r) => [r.lotId, r.cups]));

  let totalCostZar = 0;
  let totalCups = 0;
  for (const lot of closedLots) {
    const cups = cupsByLot.get(lot.id) ?? 0;
    if (cups > 0 && lot.containerCostZar) {
      totalCostZar += lot.containerCostZar;
      totalCups += cups;
    }
  }
  if (totalCups === 0) return null;
  return (totalCostZar / totalCups).toFixed(4);
}

// ─── listPurchases ────────────────────────────────────────────────────────────

/**
 * Lists purchases, most-recent first.
 * Manager / admin / finance / owner read.
 */
export async function listPurchases(input?: {
  kind?: PurchaseKind;
  status?: "active" | "pending_admin_approval";
}): Promise<ActionResult<{ purchases: Purchase[]; total: number }>> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const rows = await db
    .select({
      id: purchases.id,
      sourceName: purchases.sourceName,
      receivedAt: purchases.receivedAt,
      totalZar: purchases.totalZar,
      kind: purchases.kind,
      status: purchases.status,
      adminApprovedBy: purchases.adminApprovedBy,
    })
    .from(purchases)
    .where(
      and(
        input?.kind ? eq(purchases.kind, input.kind) : undefined,
        input?.status ? eq(purchases.status, input.status) : undefined
      )
    )
    .orderBy(desc(purchases.receivedAt));

  const result: Purchase[] = rows.map((r) => ({
    id: r.id,
    sourceName: r.sourceName,
    receivedAt: r.receivedAt.toISOString(),
    totalZar: r.totalZar,
    kind: r.kind as PurchaseKind,
    status: r.status as "active" | "pending_admin_approval",
    adminApprovedBy: r.adminApprovedBy,
  }));

  return { ok: true, data: { purchases: result, total: result.length } };
}

// ─── recordPurchase ───────────────────────────────────────────────────────────

/**
 * Records a purchase delivery.  Creates one lot + one restock movement per
 * item.  Writes one purchases row per item (each linked to its lot).
 *
 * L10 logic:
 *   - standard kind → lots are 'active', status='active' immediately.
 *   - emergency kind, admin/owner caller → same as standard (approved inline).
 *   - emergency kind, other roles → lots are 'quarantined',
 *     status='pending_admin_approval' until approveEmergencyPurchase is called.
 */
export async function recordPurchase(
  input: RecordPurchaseInput
): Promise<ActionResult<{ purchaseIds: string[] }>> {
  const auth = await authorize(...RECORDER_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!input.items || input.items.length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "items must not be empty." };
  }

  for (const item of input.items) {
    if (!Number.isInteger(item.totalZar) || item.totalZar <= 0) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `totalZar for item ${item.inventoryItemId} must be a positive integer.`,
      };
    }
    // Container items (unit='cup') send containerSize instead of quantity —
    // which shape applies is decided below, per-item, from the item's own
    // unit (not trusting the client's shape). Both must be positive if present.
    if (item.quantity !== undefined && item.quantity <= 0) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `quantity for item ${item.inventoryItemId} must be positive.`,
      };
    }
    if (item.containerSize !== undefined && item.containerSize <= 0) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `containerSize for item ${item.inventoryItemId} must be positive.`,
      };
    }
  }

  // Look up each item's real unit server-side — the container-purchase model
  // (no predicted yield) only applies to unit='cup' items (milk & beans);
  // everything else keeps the existing quantity-received model unchanged.
  const itemUnits = await db
    .select({ id: inventoryItems.id, unit: inventoryItems.unit })
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, input.items.map((i) => i.inventoryItemId)));
  const unitById = new Map(itemUnits.map((i) => [i.id, i.unit]));

  for (const item of input.items) {
    const isContainerItem = unitById.get(item.inventoryItemId) === "cup";
    if (isContainerItem && (item.containerSize === undefined || item.containerSizeUnit === undefined)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `${item.inventoryItemId} is a container item — provide containerSize and containerSizeUnit, not quantity.`,
      };
    }
    if (!isContainerItem && (item.quantity === undefined || item.unitCostZar === undefined)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `${item.inventoryItemId} — provide quantity and unitCostZar.`,
      };
    }
  }

  const isAdmin = session.role === "admin";
  const isEmergency = input.kind === "emergency";
  const pendingApproval = isEmergency && !isAdmin;
  const lotState = pendingApproval ? "quarantined" : "active";
  const purchaseStatus = pendingApproval ? "pending_admin_approval" : "active";

  const purchaseIds: string[] = [];

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    for (const item of input.items) {
      const isContainerItem = unitById.get(item.inventoryItemId) === "cup";

      // 1. Create lot — container items (milk & beans) record the real size
      //    bought and cost paid, no predicted cup yield; unitCostZar is a
      //    historical average (or null until one exists) rather than a
      //    number derived from a guessed quantity.
      const [lot] = await tx
        .insert(inventoryLots)
        .values(
          isContainerItem
            ? {
                inventoryItemId: item.inventoryItemId,
                sourceName: input.sourceName,
                containerSize: String(item.containerSize),
                containerSizeUnit: item.containerSizeUnit,
                containerCostZar: item.totalZar,
                unitCostZar: await getHistoricalCostPerCup(item.inventoryItemId, txDb),
                state: lotState,
              }
            : {
                inventoryItemId: item.inventoryItemId,
                sourceName: input.sourceName,
                unitCostZar: item.unitCostZar,
                quantityReceived: String(item.quantity),
                state: lotState,
              }
        )
        .returning({ id: inventoryLots.id });

      // 2. Restock movement — only for the legacy quantity model. Container
      //    items start with zero movements (nothing consumed yet); they have
      //    no predicted total to restock against, so there's nothing to write.
      if (!pendingApproval && !isContainerItem) {
        // Validated above: non-container items always carry `quantity`.
        await tx.insert(stockMovements).values({
          inventoryLotId: lot.id,
          delta: item.quantity!,
          kind: "restock",
          byStaffId: session.id,
        });
      }

      // 3. Purchase record linked to the lot
      const [purchase] = await tx
        .insert(purchases)
        .values({
          sourceName: input.sourceName,
          inventoryLotId: lot.id,
          totalZar: item.totalZar,
          kind: input.kind,
          status: purchaseStatus,
          adminApprovedBy: isEmergency && isAdmin ? session.id : null,
        })
        .returning({ id: purchases.id });

      purchaseIds.push(purchase.id);

      // 4. Audit per lot (L08)
      await writeAudit(
        {
          entityKind: "inventory_lot",
          entityId: lot.id,
          action: "create",
          actorId: session.id,
          actorRole: session.role,
          before: null,
          after: isContainerItem
            ? {
                inventoryItemId: item.inventoryItemId,
                containerSize: item.containerSize,
                containerSizeUnit: item.containerSizeUnit,
                state: lotState,
                purchaseId: purchase.id,
              }
            : {
                inventoryItemId: item.inventoryItemId,
                quantity: item.quantity,
                state: lotState,
                purchaseId: purchase.id,
              },
          reason: pendingApproval
            ? "emergency_purchase · phase2_seed · cost_estimated · pending_approval"
            : `${input.kind}_purchase · phase2_seed · cost_estimated`,
        },
        txDb
      );
    }
  });

  return { ok: true, data: { purchaseIds } };
}

// ─── approveEmergencyPurchase ─────────────────────────────────────────────────

/**
 * Admin/owner approves a pending emergency purchase:
 *   1. Sets purchases.status = 'active', adminApprovedBy = session.id.
 *   2. Promotes the linked lot from 'quarantined' to 'active'.
 *   3. Inserts the restock stock_movement (deferred until now).
 *   4. writeAudit (L08).
 */
export async function approveEmergencyPurchase(
  purchaseId: string
): Promise<ActionResult> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  const [purchase] = await db
    .select({
      id: purchases.id,
      inventoryLotId: purchases.inventoryLotId,
      kind: purchases.kind,
      status: purchases.status,
    })
    .from(purchases)
    .where(eq(purchases.id, purchaseId));

  if (!purchase) {
    return { ok: false, code: "NOT_FOUND", message: "Purchase not found." };
  }
  if (purchase.kind !== "emergency") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Only emergency purchases require approval.",
    };
  }
  if (purchase.status !== "pending_admin_approval") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Purchase is not pending approval.",
    };
  }
  if (!purchase.inventoryLotId) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Purchase has no linked inventory lot.",
    };
  }

  // Load lot details for the restock movement quantity
  const [lot] = await db
    .select({ id: inventoryLots.id, quantityReceived: inventoryLots.quantityReceived })
    .from(inventoryLots)
    .where(eq(inventoryLots.id, purchase.inventoryLotId));

  if (!lot) {
    return { ok: false, code: "NOT_FOUND", message: "Linked inventory lot not found." };
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    // 1. Approve purchase
    await tx
      .update(purchases)
      .set({ status: "active", adminApprovedBy: session.id })
      .where(eq(purchases.id, purchaseId));

    // 2. Activate the lot
    await tx
      .update(inventoryLots)
      .set({ state: "active" })
      .where(eq(inventoryLots.id, lot.id));

    // 3. Insert the deferred restock movement
    const quantity = lot.quantityReceived ? parseFloat(lot.quantityReceived) : 0;
    if (quantity > 0) {
      await tx.insert(stockMovements).values({
        inventoryLotId: lot.id,
        delta: Math.round(quantity), // integer delta
        kind: "restock",
        byStaffId: session.id,
      });
    }

    // 4. Audit (L08)
    await writeAudit(
      {
        entityKind: "purchases",
        entityId: purchaseId,
        action: "approve",
        actorId: session.id,
        actorRole: session.role,
        before: { status: "pending_admin_approval" },
        after: { status: "active", adminApprovedBy: session.id },
        reason: "emergency_purchase_approval",
      },
      txDb
    );
  });

  return { ok: true, data: undefined };
}
