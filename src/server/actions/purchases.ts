"use server";

// Purchase server actions — task G10
// recordPurchase: all staff can record; emergency kind requires admin approval
//   unless the caller is admin/owner (L10).
// approveEmergencyPurchase: admin/owner only.
// listPurchases: admin + finance + manager read.
// Docs: docs/API.md · docs/BUSINESS_RULES.md L08 L10

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  purchases,
  inventoryLots,
  stockMovements,
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
    if (item.quantity <= 0) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: `quantity for item ${item.inventoryItemId} must be positive.`,
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
      // 1. Create lot
      const [lot] = await tx
        .insert(inventoryLots)
        .values({
          inventoryItemId: item.inventoryItemId,
          sourceName: input.sourceName,
          unitCostZar: item.unitCostZar,
          quantityReceived: String(item.quantity),
          state: lotState,
        })
        .returning({ id: inventoryLots.id });

      // 2. Restock movement (only for active lots; quarantined lots
      //    don't add to running stock until approved)
      if (!pendingApproval) {
        await tx.insert(stockMovements).values({
          inventoryLotId: lot.id,
          delta: item.quantity,
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
          after: {
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
