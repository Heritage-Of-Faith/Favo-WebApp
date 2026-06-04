"use server";

// Stock alert recipient actions — task G12
// addStockAlertRecipient:    admin+ only. UNIQUE on (item, staff).
// removeStockAlertRecipient: admin+ only.
// listStockAlertRecipients:  admin + manager read.
// Docs: docs/API.md · docs/DATA_MODEL.md · stock_alert_recipients · T04

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockAlertRecipients, staff, inventoryItems } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult, AlertRecipient } from "@/lib/types";
import type { DB } from "@/lib/db";

const ADMIN_ROLES = ["admin", "manager", "owner"] as const;
const READER_ROLES = ["admin", "manager", "owner"] as const;

// AlertRecipient now lives in @/lib/types (shared with the admin RecipientsEditor).

// ─── listStockAlertRecipients ─────────────────────────────────────────────────

export async function listStockAlertRecipients(): Promise<
  ActionResult<{ recipients: AlertRecipient[] }>
> {
  const auth = await authorize(...READER_ROLES);
  if (!auth.ok) return auth;

  const rows = await db
    .select({
      id: stockAlertRecipients.id,
      staffId: stockAlertRecipients.staffId,
      staffName: staff.name,
      staffRole: staff.role,
      inventoryItemId: stockAlertRecipients.inventoryItemId,
      inventoryItemName: inventoryItems.name,
    })
    .from(stockAlertRecipients)
    .innerJoin(staff, eq(stockAlertRecipients.staffId, staff.id))
    .leftJoin(
      inventoryItems,
      eq(stockAlertRecipients.inventoryItemId, inventoryItems.id)
    );

  const recipients: AlertRecipient[] = rows.map((r) => ({
    id: r.id,
    staffId: r.staffId,
    staffName: r.staffName,
    staffRole: r.staffRole,
    inventoryItemId: r.inventoryItemId,
    inventoryItemName: r.inventoryItemName ?? null,
  }));

  return { ok: true, data: { recipients } };
}

// ─── addStockAlertRecipient ───────────────────────────────────────────────────

export async function addStockAlertRecipient(input: {
  staffId: string;
  inventoryItemId: string | null;
}): Promise<ActionResult<{ recipientId: string }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  // Check for duplicates manually (ON CONFLICT DO NOTHING would silently skip)
  const existing = await db
    .select({ id: stockAlertRecipients.id })
    .from(stockAlertRecipients)
    .where(
      and(
        eq(stockAlertRecipients.staffId, input.staffId),
        input.inventoryItemId
          ? eq(stockAlertRecipients.inventoryItemId, input.inventoryItemId)
          : eq(stockAlertRecipients.inventoryItemId, null as unknown as string)
      )
    );

  if (existing.length > 0) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "This staff member is already a recipient for this item.",
    };
  }

  let recipientId!: string;

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    const [inserted] = await tx
      .insert(stockAlertRecipients)
      .values({
        staffId: input.staffId,
        inventoryItemId: input.inventoryItemId,
      })
      .returning({ id: stockAlertRecipients.id });

    recipientId = inserted.id;

    await writeAudit(
      {
        entityKind: "stock_alert_recipient",
        entityId: recipientId,
        action: "create",
        actorId: session.id,
        actorRole: session.role,
        before: null,
        after: { staffId: input.staffId, inventoryItemId: input.inventoryItemId },
      },
      txDb
    );
  });

  return { ok: true, data: { recipientId } };
}

// ─── removeStockAlertRecipient ────────────────────────────────────────────────

export async function removeStockAlertRecipient(
  recipientId: string
): Promise<ActionResult> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  const [existing] = await db
    .select({ id: stockAlertRecipients.id })
    .from(stockAlertRecipients)
    .where(eq(stockAlertRecipients.id, recipientId));

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Recipient not found." };
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    await tx
      .delete(stockAlertRecipients)
      .where(eq(stockAlertRecipients.id, recipientId));

    await writeAudit(
      {
        entityKind: "stock_alert_recipient",
        entityId: recipientId,
        action: "delete",
        actorId: session.id,
        actorRole: session.role,
        before: { recipientId },
        after: null,
      },
      txDb
    );
  });

  return { ok: true, data: undefined };
}
