"use server";

// Container actions — Phase 3 (container stock model: milk & beans)
// Baristas open/close physical bottles/bags on the POS. Each cup-unit inventory
// item has at most one OPEN container at a time (enforced by the partial unique
// index uq_one_open_lot_per_item + a per-item advisory lock here).
//
//   openContainer(inventoryItemId)  — open the FIFO-oldest sealed container
//   closeContainer(lotId, reason?)  — finish a container; leftover cups are
//                                     written off with a COGS-neutral adjustment
//   listOpenContainers()            — POS card data (open container + sealed count)
//
// Docs: docs/DATA_MODEL.md · docs/BUSINESS_RULES.md L08

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryItems, inventoryLots, stockMovements } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

const POS_ROLES = ["admin", "barista"] as const;

export type OpenContainerView = {
  inventoryItemId: string;
  inventoryItemName: string;
  /** The currently-open container, or null if none is open. */
  openLotId: string | null;
  openLabel: string | null; // batch number or source name, for display
  /** Number of sealed (not-yet-opened) containers still on the shelf. */
  sealedCount: number;
};

/** Running stock (cups) for a lot = SUM(stock_movements.delta). */
async function lotCups(lotId: string, tx: DB): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int` })
    .from(stockMovements)
    .where(eq(stockMovements.inventoryLotId, lotId));
  return row?.total ?? 0;
}

// ─── openContainer ──────────────────────────────────────────────────────────

/**
 * Opens the FIFO-oldest sealed (active) container for a cup-unit item. Fails with
 * CONFLICT if one is already open for that item (close it first). Serialised per
 * item with an advisory lock so two POS taps can't open two containers.
 */
export async function openContainer(inventoryItemId: string): Promise<ActionResult> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;
      await txDb.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"open_container:" + inventoryItemId}))`
      );

      const [alreadyOpen] = await txDb
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(
          and(
            eq(inventoryLots.inventoryItemId, inventoryItemId),
            eq(inventoryLots.state, "open")
          )
        )
        .limit(1);

      if (alreadyOpen) {
        throw new ContainerError(
          "CONFLICT",
          "A container is already open for this item — close it first."
        );
      }

      const [sealed] = await txDb
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(
          and(
            eq(inventoryLots.inventoryItemId, inventoryItemId),
            eq(inventoryLots.state, "active")
          )
        )
        .orderBy(asc(inventoryLots.receivedAt))
        .limit(1)
        .for("update");

      if (!sealed) {
        throw new ContainerError(
          "NOT_FOUND",
          "No sealed container left to open for this item."
        );
      }

      await txDb
        .update(inventoryLots)
        .set({ state: "open", openedAt: sql`now()` })
        .where(eq(inventoryLots.id, sealed.id));

      await writeAudit(
        {
          entityKind: "inventory_lot",
          entityId: sealed.id,
          action: "open_container",
          actorId: session.id,
          actorRole: session.role,
          before: { state: "active" },
          after: { state: "open" },
        },
        txDb
      );
    });
  } catch (err) {
    if (err instanceof ContainerError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  notifyInventory();
  return { ok: true, data: undefined };
}

// ─── closeContainer ─────────────────────────────────────────────────────────

/**
 * Closes an open container. Any cups still remaining are written off with a
 * COGS-neutral `adjustment` movement so running stock reflects the empty/retired
 * bottle. Idempotent-ish: closing an already-closed lot returns CONFLICT.
 *
 * Container lots (no predicted quantity): also finalises `unitCostZar` to this
 * lot's own real cost/cup (containerCostZar ÷ actual cups made) — the real
 * number the container yielded, replacing whatever historical-average estimate
 * was used while it was open. Past COGS entries already used that estimate at
 * the time of deduction and are not restated; this only affects reporting and
 * the estimate used by future containers of the same item.
 */
export async function closeContainer(
  lotId: string,
  reason?: string
): Promise<ActionResult> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      const [lot] = await txDb
        .select({
          id: inventoryLots.id,
          state: inventoryLots.state,
          containerCostZar: inventoryLots.containerCostZar,
        })
        .from(inventoryLots)
        .where(eq(inventoryLots.id, lotId))
        .for("update");

      if (!lot) {
        throw new ContainerError("NOT_FOUND", "Container not found.");
      }
      if (lot.state !== "open") {
        throw new ContainerError(
          "CONFLICT",
          `Only an open container can be closed; this one is ${lot.state}.`
        );
      }

      const remaining = await lotCups(lotId, txDb);
      // Real cups actually made from this container (legacy lots: remaining
      // is what's left of a predicted total, so this is meaningless for them
      // and simply unused). Only positive for container lots, since their
      // running stock never starts above zero.
      const cupsMade = Math.max(0, -remaining);

      // Write off any leftover cups so running stock matches the empty bottle.
      // adjustment ≠ deduction → does not affect COGS (v_daily_cogs).
      if (remaining > 0) {
        await txDb.insert(stockMovements).values({
          inventoryLotId: lotId,
          delta: -remaining,
          kind: "adjustment",
          byStaffId: session.id,
        });
      }

      await txDb
        .update(inventoryLots)
        .set({
          state: "closed",
          closedAt: sql`now()`,
          ...(lot.containerCostZar && cupsMade > 0
            ? { unitCostZar: (lot.containerCostZar / cupsMade).toFixed(4) }
            : {}),
        })
        .where(eq(inventoryLots.id, lotId));

      await writeAudit(
        {
          entityKind: "inventory_lot",
          entityId: lotId,
          action: "close_container",
          actorId: session.id,
          actorRole: session.role,
          before: { state: "open", cups: remaining },
          after: { state: "closed", cups: 0, writtenOff: remaining, cupsMade },
          reason: reason ?? "container_closed",
        },
        txDb
      );
    });
  } catch (err) {
    if (err instanceof ContainerError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  notifyInventory();
  return { ok: true, data: undefined };
}

// ─── listOpenContainers ───────────────────────────────────────────────────────

/**
 * One row per cup-unit (container) item: the open container (if any) plus how
 * many sealed containers remain. Drives the POS "Open containers" card.
 */
export async function listOpenContainers(): Promise<
  ActionResult<{ containers: OpenContainerView[] }>
> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;

  const items = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name })
    .from(inventoryItems)
    .where(eq(inventoryItems.unit, "cup"));

  const containers: OpenContainerView[] = [];
  for (const item of items) {
    const lots = await db
      .select({
        id: inventoryLots.id,
        state: inventoryLots.state,
        batchNumber: inventoryLots.batchNumber,
        sourceName: inventoryLots.sourceName,
      })
      .from(inventoryLots)
      .where(eq(inventoryLots.inventoryItemId, item.id));

    const open = lots.find((l) => l.state === "open") ?? null;
    const sealedCount = lots.filter((l) => l.state === "active").length;

    containers.push({
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      openLotId: open?.id ?? null,
      openLabel: open ? open.batchNumber ?? open.sourceName ?? null : null,
      sealedCount,
    });
  }

  return { ok: true, data: { containers } };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

class ContainerError extends Error {
  constructor(
    public readonly code: "CONFLICT" | "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "ContainerError";
  }
}

/** Non-fatal POS refresh ping (same channel the deduction path uses). */
function notifyInventory() {
  db.execute(
    sql`SELECT pg_notify('inventory_changes', ${JSON.stringify({ containers: true })})`
  ).catch(() => {});
}
