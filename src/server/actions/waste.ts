"use server";

// Waste log server actions — task G10
// logWaste: barista+ can log waste. Inserts waste_log + stock_movements
// atomically in one transaction. writeAudit on both inserts (L08).
// Docs: docs/API.md · docs/BUSINESS_RULES.md L08 · DATA_MODEL.md waste_log

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { wasteLog, stockMovements, inventoryLots } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

// All roles that can log waste (barista and above)
const WASTE_ROLES = ["barista", "admin"] as const;

export type LogWasteInput = {
  /** Waste category from the waste_category enum. */
  category:
    | "expired"
    | "damaged"
    | "spilled"
    | "overproduction"
    | "other";
  /** Lot the waste came from. Required unless waste is not lot-specific. */
  inventoryLotId?: string;
  /** Quantity in the lot's base unit (integer, > 0). */
  quantity: number;
  /** Free-text reason for the waste event. */
  reason?: string;
};

/**
 * Logs a waste event.
 *
 * In one transaction:
 *   1. Validates the lot exists and is 'active' or 'depleted'.
 *   2. Inserts a waste_log row.
 *   3. Inserts a stock_movements row (kind='waste', delta=-quantity).
 *   4. Writes an audit row (L08).
 *
 * Barista+ can log waste.  Quantity must be a positive integer.
 */
export async function logWaste(
  input: LogWasteInput
): Promise<ActionResult<{ wasteLogId: string }>> {
  const auth = await authorize(...WASTE_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  // Basic validation
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "quantity must be a positive integer.",
    };
  }

  // Validate lot if provided
  if (input.inventoryLotId) {
    const [lot] = await db
      .select({ id: inventoryLots.id, state: inventoryLots.state })
      .from(inventoryLots)
      .where(eq(inventoryLots.id, input.inventoryLotId));

    if (!lot) {
      return { ok: false, code: "NOT_FOUND", message: "Inventory lot not found." };
    }
    if (!["active", "depleted"].includes(lot.state)) {
      return {
        ok: false,
        code: "INVALID_LOT_STATE",
        message: `Cannot log waste against a ${lot.state} lot.`,
      };
    }
  }

  let wasteLogId!: string;

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    // 1. Insert waste_log
    const [inserted] = await tx
      .insert(wasteLog)
      .values({
        category: input.category,
        inventoryLotId: input.inventoryLotId ?? null,
        quantity: input.quantity,
        reason: input.reason ?? null,
        byStaffId: session.id,
      })
      .returning({ id: wasteLog.id });

    wasteLogId = inserted.id;

    // 2. Insert paired stock_movements row (only when a lot is specified)
    if (input.inventoryLotId) {
      await tx.insert(stockMovements).values({
        inventoryLotId: input.inventoryLotId,
        delta: -input.quantity,
        kind: "waste",
        byStaffId: session.id,
      });
    }

    // 3. Audit (L08)
    await writeAudit(
      {
        entityKind: "waste_log",
        entityId: wasteLogId,
        action: "create",
        actorId: session.id,
        actorRole: session.role,
        before: null,
        after: {
          category: input.category,
          inventoryLotId: input.inventoryLotId,
          quantity: input.quantity,
        },
        reason: input.reason,
      },
      txDb
    );
  });

  return { ok: true, data: { wasteLogId } };
}
