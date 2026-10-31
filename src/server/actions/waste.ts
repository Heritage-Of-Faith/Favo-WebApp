"use server";

// Waste log server actions — task G10
// logWaste: barista+ can log waste. Inserts waste_log + stock_movements
// atomically in one transaction. writeAudit on both inserts (L08).
// Docs: docs/API.md · docs/BUSINESS_RULES.md L08 · DATA_MODEL.md waste_log

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { wasteLog, stockMovements, inventoryLots } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";
import {
  isWasteableLotState,
  lotStateRefusalMessage,
  WASTE_CATEGORIES,
  WASTE_REASON_MAX,
} from "@/lib/pos/waste-validation";
import type { DB } from "@/lib/db";
import { stripControlChars } from "@/server/http/request-guards";

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

  // QA R5-SEC-1/2: the body is untrusted (a forged server-action call can send
  // anything), so shape problems are a VALIDATION_ERROR, never a DB-enum 500.
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid waste entry." };
  }
  if (!(WASTE_CATEGORIES as readonly unknown[]).includes(input.category)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Choose a waste category." };
  }
  if (input.inventoryLotId !== undefined && typeof input.inventoryLotId !== "string") {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid lot." };
  }
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== "string") {
    return { ok: false, code: "VALIDATION_ERROR", message: "Reason must be text." };
  }
  // QA R6-SEC-1: Postgres rejects NUL in text (a bare 500), so any control
  // character in the reason or lot id is refused here.
  if (typeof input.inventoryLotId === "string" && stripControlChars(input.inventoryLotId) !== input.inventoryLotId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Invalid lot." };
  }
  if (typeof input.reason === "string" && stripControlChars(input.reason) !== input.reason) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Reason contains characters that cannot be saved." };
  }
  // QA R6-SEC-2: count characters (code points), not UTF-16 units.
  if (typeof input.reason === "string" && Array.from(input.reason).length > WASTE_REASON_MAX) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `Reason is too long (${WASTE_REASON_MAX} characters max).`,
    };
  }

  // Basic validation
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "quantity must be a positive integer.",
    };
  }

  let wasteLogId!: string;

  const refused = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    // Validate lot if provided. The row lock comes first, so the state check and
    // the remaining-stock check below both see the lot as it is at write time.
    if (input.inventoryLotId) {
      const [lot] = await tx
        .select({
          id: inventoryLots.id,
          state: inventoryLots.state,
          quantityReceived: inventoryLots.quantityReceived,
        })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, input.inventoryLotId))
        .for("update");

      if (!lot) {
        return { ok: false as const, code: "NOT_FOUND", message: "Inventory lot not found." };
      }
      if (!isWasteableLotState(lot.state)) {
        return {
          ok: false as const,
          code: "INVALID_LOT_STATE",
          message: lotStateRefusalMessage(lot.state),
        };
      }

      // QA R2-9/B3: waste may never take a lot below zero. QA R6 barista P2-1:
      // a lot with nothing left (remaining <= 0) refuses waste, whatever its
      // kind. Only countdown lots (a received quantity was booked in) are also
      // capped by quantity; container-model lots (quantityReceived null) have
      // no received figure to count down.
      {
        const [row] = await tx
          .select({ total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int` })
          .from(stockMovements)
          .where(eq(stockMovements.inventoryLotId, input.inventoryLotId));
        const remaining = Number(row?.total ?? 0);
        const exceeds = lot.quantityReceived != null && input.quantity > remaining;
        if (remaining <= 0 || exceeds) {
          const refusal = wasteExceedsLot(remaining);
          // Audited; nothing is thrown, so the audit row commits.
          await writeAudit(
            {
              entityKind: "inventory_lot",
              entityId: input.inventoryLotId,
              action: "waste_refused",
              actorId: session.id,
              actorRole: session.role,
              after: { code: refusal.code, quantity: input.quantity, remaining, category: input.category },
              reason: refusal.code,
            },
            txDb
          );
          return refusal;
        }
      }
    }

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
    return null;
  });

  if (refused) return refused;
  return { ok: true, data: { wasteLogId } };
}

function wasteExceedsLot(remaining: number) {
  return {
    ok: false as const,
    code: "EXCEEDS_STOCK",
    message:
      remaining > 0
        ? `Only ${remaining} left in this lot. Log ${remaining} or less.`
        : "This lot has nothing left to waste.",
  };
}
