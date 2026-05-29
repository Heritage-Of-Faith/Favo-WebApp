"use server";

import { db } from "@/lib/db";
import { auditLog } from "@db/schema";

export type AuditInput = {
  entityKind: string;
  entityId: string;
  action: string;
  actorId?: string;
  actorRole?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
};

/**
 * Appends a row to audit_log. Must be called inside every mutation transaction.
 * If this insert fails, the caller's transaction rolls back — failure to audit
 * fails the entire operation (business rule L08 + L12).
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    entityKind: input.entityKind,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actorId,
    actorRole: input.actorRole,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason,
  });
}
