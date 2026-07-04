"use server";

import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
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
 *
 * @param tx  Optional Drizzle transaction object. Pass the `tx` from
 *            `db.transaction(async (tx) => { ... })` so the audit row is
 *            part of the same atomic unit as the mutation it records.
 *            Defaults to the global `db` singleton when called outside
 *            a transaction (legacy callsites remain unaffected).
 */
// This function IS writeAudit — the mutation-without-audit rule flags it as a
// definitional false positive; the rule's own docs prescribe annotating it.
export async function writeAudit(input: AuditInput, tx?: DB): Promise<void> { // nosemgrep: mutation-without-audit
  const client = tx ?? db;
  await client.insert(auditLog).values({
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
