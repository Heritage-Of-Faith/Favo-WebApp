"use server";

// The Favo — server actions (AT-142).
//
// SINGLE shared implementation for both entry points: the customer PWA
// (AT-143) and the barista POS (AT-144) call these same actions against the
// same schema (src/server/favo/schema.ts). Neither surface may implement its
// own save logic — that's the drift the AT-142 architecture mandate forbids.
//
// Auth model:
//  - Staff (barista/admin) may read/write any customer's Favo.
//  - A signed-in customer may read/write only their own.
// Docs: docs/API.md conventions · BUSINESS_RULES.md (audit L08/L12)

import { eq, inArray } from "drizzle-orm";
import { db, type DB } from "@/lib/db";
import { favos, menuItems, menuCustomisations } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { getCustomerSession } from "@/server/auth/customer-session";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";
import { favoItemsSchema, type FavoItem, type FavoView } from "@/server/favo/schema";

type Actor =
  | { kind: "staff"; id: string; role: string }
  | { kind: "customer"; id: string };

/**
 * Staff session wins; otherwise a customer session is accepted only for their
 * own customerId. Returns null when neither applies.
 */
async function resolveActor(customerId: string): Promise<Actor | null> {
  const staffAuth = await authorize("barista", "admin");
  if (staffAuth.ok) {
    return { kind: "staff", id: staffAuth.session.id, role: staffAuth.session.role };
  }
  const sessionCustomerId = await getCustomerSession();
  if (sessionCustomerId && sessionCustomerId === customerId) {
    return { kind: "customer", id: sessionCustomerId };
  }
  return null;
}

function toView(row: { items: unknown; updatedAt: Date; updatedByStaffId: string | null }): FavoView {
  return {
    items: row.items as FavoItem[],
    updatedAt: row.updatedAt.toISOString(),
    updatedByStaffId: row.updatedByStaffId,
  };
}

/** The customer's saved Favo, or null when they haven't set one. */
export async function getFavo(
  customerId: string
): Promise<ActionResult<{ favo: FavoView | null }>> {
  const actor = await resolveActor(customerId);
  if (!actor) {
    return { ok: false, code: "UNAUTHORIZED", message: "You must be signed in." };
  }

  const [row] = await db
    .select({
      items: favos.items,
      updatedAt: favos.updatedAt,
      updatedByStaffId: favos.updatedByStaffId,
    })
    .from(favos)
    .where(eq(favos.customerId, customerId));

  return { ok: true, data: { favo: row ? toView(row) : null } };
}

/**
 * Create or replace the customer's Favo. Validates against the shared schema
 * and rejects menu items that don't exist / aren't active, and customisation
 * ids that don't belong to their line's menu item.
 */
export async function setFavo(
  customerId: string,
  items: FavoItem[]
): Promise<ActionResult<{ favo: FavoView }>> {
  const actor = await resolveActor(customerId);
  if (!actor) {
    return { ok: false, code: "UNAUTHORIZED", message: "You must be signed in." };
  }

  const parsed = favoItemsSchema.safeParse(items);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid Favo items." };
  }
  const data = parsed.data;

  // Validate references against the live menu (mirrors createOrder's checks).
  const modIds = [...new Set(data.flatMap((i) => i.modifications))];
  const [menuRows, modRows] = await Promise.all([
    db
      .select({ id: menuItems.id, active: menuItems.active })
      .from(menuItems)
      .where(inArray(menuItems.id, data.map((i) => i.menuItemId))),
    modIds.length
      ? db
          .select({ id: menuCustomisations.id, menuItemId: menuCustomisations.menuItemId })
          .from(menuCustomisations)
          .where(inArray(menuCustomisations.id, modIds))
      : Promise.resolve([]),
  ]);
  const menuById = new Map(menuRows.map((m) => [m.id, m]));
  const modById = new Map(modRows.map((m) => [m.id, m]));

  for (const item of data) {
    const mi = menuById.get(item.menuItemId);
    if (!mi || !mi.active) {
      return {
        ok: false,
        code: "UNKNOWN_MENU_ITEM",
        message: `That item isn't on the menu any more: ${item.menuItemId}`,
      };
    }
    for (const modId of item.modifications) {
      const mod = modById.get(modId);
      if (!mod || mod.menuItemId !== item.menuItemId) {
        return {
          ok: false,
          code: "INVALID_CUSTOMISATION",
          message: `Customisation ${modId} doesn't belong to item ${item.menuItemId}.`,
        };
      }
    }
  }

  const updatedByStaffId = actor.kind === "staff" ? actor.id : null;

  const saved = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [before] = await tx
      .select({ items: favos.items })
      .from(favos)
      .where(eq(favos.customerId, customerId));

    const [row] = await tx
      .insert(favos)
      .values({ customerId, items: data, updatedAt: new Date(), updatedByStaffId })
      .onConflictDoUpdate({
        target: favos.customerId,
        set: { items: data, updatedAt: new Date(), updatedByStaffId },
      })
      .returning({
        items: favos.items,
        updatedAt: favos.updatedAt,
        updatedByStaffId: favos.updatedByStaffId,
      });

    await writeAudit(
      {
        entityKind: "favo",
        entityId: customerId,
        action: before ? "update" : "create",
        actorId: actor.id,
        actorRole: actor.kind === "staff" ? actor.role : "customer",
        before: before?.items ?? null,
        after: data,
      },
      txDb
    );
    return row;
  });

  return { ok: true, data: { favo: toView(saved) } };
}

/** Remove the customer's Favo entirely. No-op result if none exists. */
export async function clearFavo(
  customerId: string
): Promise<ActionResult<{ cleared: boolean }>> {
  const actor = await resolveActor(customerId);
  if (!actor) {
    return { ok: false, code: "UNAUTHORIZED", message: "You must be signed in." };
  }

  const cleared = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [before] = await tx
      .select({ items: favos.items })
      .from(favos)
      .where(eq(favos.customerId, customerId));
    if (!before) return false;

    await tx.delete(favos).where(eq(favos.customerId, customerId));
    await writeAudit(
      {
        entityKind: "favo",
        entityId: customerId,
        action: "delete",
        actorId: actor.id,
        actorRole: actor.kind === "staff" ? actor.role : "customer",
        before: before.items,
        after: null,
      },
      txDb
    );
    return true;
  });

  return { ok: true, data: { cleared } };
}
