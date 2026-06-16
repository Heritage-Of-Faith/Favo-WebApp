"use server";

// Sync conflict actions — G20 stubs built as part of AT-80.
// listSyncConflicts: paginated list (open first, then resolved-this-week)
// resolveSyncConflict: marks a conflict resolved with a note + audit row

import { eq, desc, gte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncConflicts } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";

export type SyncConflictRow = {
  id: string;
  kind: string;
  orderId: string | null;
  clientPayload: unknown;
  serverState: unknown;
  status: string;
  openedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

export async function listSyncConflicts(): Promise<
  ActionResult<{ open: SyncConflictRow[]; resolvedThisWeek: SyncConflictRow[] }>
> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(syncConflicts)
    .where(
      or(
        eq(syncConflicts.status, "open"),
        gte(syncConflicts.resolvedAt, weekAgo)
      )
    )
    .orderBy(desc(syncConflicts.openedAt))
    .limit(200);

  const mapped: SyncConflictRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    orderId: r.orderId,
    clientPayload: r.clientPayload,
    serverState: r.serverState,
    status: r.status,
    openedAt: r.openedAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolutionNote: r.resolutionNote,
  }));

  return {
    ok: true,
    data: {
      open: mapped.filter((r) => r.status === "open"),
      resolvedThisWeek: mapped.filter((r) => r.status !== "open"),
    },
  };
}

export async function resolveSyncConflict(
  id: string,
  note: string
): Promise<ActionResult<SyncConflictRow>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const [existing] = await db
    .select()
    .from(syncConflicts)
    .where(eq(syncConflicts.id, id))
    .limit(1);

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Conflict not found." };
  }
  if (existing.status !== "open") {
    return { ok: false, code: "CONFLICT", message: "Conflict is already resolved." };
  }

  const now = new Date();
  const [updated] = await db
    .update(syncConflicts)
    .set({
      status: "resolved",
      resolvedAt: now,
      resolvedBy: auth.session.id,
      resolutionNote: note.trim() || null,
    })
    .where(eq(syncConflicts.id, id))
    .returning();

  await writeAudit({
    actorId: auth.session.id,
    actorRole: auth.session.role,
    action: "sync_conflict.resolved",
    entityKind: "sync_conflict",
    entityId: id,
    after: { status: "resolved", note: note.trim() || null },
  });

  return {
    ok: true,
    data: {
      id: updated!.id,
      kind: updated!.kind,
      orderId: updated!.orderId,
      clientPayload: updated!.clientPayload,
      serverState: updated!.serverState,
      status: updated!.status,
      openedAt: updated!.openedAt.toISOString(),
      resolvedAt: updated!.resolvedAt?.toISOString() ?? null,
      resolutionNote: updated!.resolutionNote,
    },
  };
}
