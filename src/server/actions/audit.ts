"use server";

// Audit log reader — task A6 (Gian)
// Paginated, filterable, read-only. Auth: admin, finance, owner only.
// Docs: docs/API.md · docs/DATA_MODEL.md → audit_log

import { and, desc, gte, lte, eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { startOfDaySast, endOfDaySast } from "@/lib/format";
import type { ActionResult } from "@/lib/types";
import {
  PAGE_SIZE,
  listAuditSchema,
  type ListAuditInput,
  type ListAuditResult,
} from "./audit-types";

/**
 * List audit log entries, newest-first.
 * Auth: admin, finance, owner only — barista/manager cannot view audit log.
 */
export async function listAudit(
  input: ListAuditInput
): Promise<ActionResult<ListAuditResult>> {
  const auth = await authorize("admin", "finance", "owner");
  if (!auth.ok) return auth;

  const parsed = listAuditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid filter input." };
  }
  const { page, entityKind, actorRole, dateFrom, dateTo } = parsed.data;

  // Build WHERE clauses from filters.
  const conditions = [];
  if (entityKind) {
    conditions.push(eq(auditLog.entityKind, entityKind));
  }
  if (actorRole) {
    conditions.push(eq(auditLog.actorRole, actorRole));
  }
  if (dateFrom) {
    conditions.push(gte(auditLog.at, startOfDaySast(dateFrom)));
  }
  if (dateTo) {
    conditions.push(lte(auditLog.at, endOfDaySast(dateTo)));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult, rows] = await Promise.all([
    db.select({ value: count() }).from(auditLog).where(where),
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.at))
      .limit(PAGE_SIZE)
      .offset(page * PAGE_SIZE),
  ]);

  const total = totalResult[0]?.value ?? 0;

  return {
    ok: true,
    data: {
      rows: rows.map((r) => ({
        id: r.id,
        entityKind: r.entityKind,
        entityId: r.entityId,
        action: r.action,
        actorId: r.actorId,
        actorRole: r.actorRole,
        at: r.at.toISOString(),
        before: r.before ?? null,
        after: r.after ?? null,
        reason: r.reason,
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    },
  };
}
