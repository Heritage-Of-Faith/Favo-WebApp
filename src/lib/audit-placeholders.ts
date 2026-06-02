// ⚠️ PLACEHOLDER DATA — owner: Mia (task A6)
// ───────────────────────────────────────────────────────────────────────────
// Gian's `listAudit` Server Action does not exist on `main` yet (CLAUDE.md).
// This module fakes it IN THE BROWSER so the A6 viewer is fully reviewable now.
//
// `AuditEntry` mirrors the db `audit_log` columns (db/schema.ts). The
// `listAudit` signature + `ActionResult<T>` shape match what Gian's real action
// will use, so wiring it later is a one-line import swap:
//     import { listAudit } from "@/lib/audit-placeholders"; ← drop
//     import { listAudit } from "@/server/actions/audit";   ← use
// Then delete this file. Audit is append-only + read-only here.
// ───────────────────────────────────────────────────────────────────────────

import type { ActionResult } from "@/lib/types";

// One row of the audit_log table (db/schema.ts → auditLog).
export type AuditEntry = {
  id: string;
  entityKind: string;
  entityId: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  at: string; // ISO timestamp
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
};

export type ListAuditParams = {
  page: number; // 1-based
  pageSize: number;
  entityKind?: string; // filter, empty/undefined = all
  action?: string; // filter, empty/undefined = all
};

export type ListAuditResult = {
  rows: AuditEntry[];
  total: number; // total matching rows (for pagination)
};

// A representative spread of audit rows across entities + actions.
const ALL: AuditEntry[] = [
  {
    id: "audit_0007",
    entityKind: "order",
    entityId: "order_1042",
    action: "transition",
    actorId: "staff_barista_sam",
    actorRole: "barista",
    at: "2026-06-01T09:14:00+02:00",
    before: { state: "in_progress" },
    after: { state: "ready" },
    reason: null,
  },
  {
    id: "audit_0006",
    entityKind: "menu_item",
    entityId: "menu_cappuccino",
    action: "price_change",
    actorId: "staff_manager_mia",
    actorRole: "admin",
    at: "2026-06-01T08:02:00+02:00",
    before: { currentPriceZar: 3500 },
    after: { currentPriceZar: 3800 },
    reason: "Bean cost increase",
  },
  {
    id: "audit_0005",
    entityKind: "staff",
    entityId: "staff_barista_thandi",
    action: "create",
    actorId: "staff_owner_olivia",
    actorRole: "owner",
    at: "2026-05-31T16:40:00+02:00",
    before: null,
    after: { name: "Thandi Barista", role: "barista", active: true },
    reason: null,
  },
  {
    id: "audit_0004",
    entityKind: "order",
    entityId: "order_1039",
    action: "cancel",
    actorId: "staff_manager_mia",
    actorRole: "admin",
    at: "2026-05-31T12:05:00+02:00",
    before: { state: "ordered" },
    after: { state: "cancelled" },
    reason: "Customer changed mind",
  },
  {
    id: "audit_0003",
    entityKind: "staff",
    entityId: "staff_barista_sam",
    action: "pin_change",
    actorId: "staff_owner_olivia",
    actorRole: "owner",
    at: "2026-05-30T18:20:00+02:00",
    before: null,
    after: null,
    reason: "Routine rotation",
  },
  {
    id: "audit_0002",
    entityKind: "order",
    entityId: "order_1031",
    action: "create",
    actorId: "staff_barista_sam",
    actorRole: "barista",
    at: "2026-05-30T10:11:00+02:00",
    before: null,
    after: { state: "ordered", totalZar: 4400, customerName: "Louis" },
    reason: null,
  },
  {
    id: "audit_0001",
    entityKind: "menu_item",
    entityId: "menu_latte",
    action: "price_change",
    actorId: "staff_manager_mia",
    actorRole: "admin",
    at: "2026-05-29T08:00:00+02:00",
    before: { currentPriceZar: 4000 },
    after: { currentPriceZar: 4200 },
    reason: null,
  },
];

function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Distinct values for the filter dropdowns. */
export const ENTITY_KINDS = ["order", "menu_item", "staff"] as const;
export const ACTIONS = [
  "create",
  "transition",
  "cancel",
  "price_change",
  "pin_change",
] as const;

export async function listAudit(
  params: ListAuditParams
): Promise<ActionResult<ListAuditResult>> {
  const { page, pageSize, entityKind, action } = params;
  const filtered = ALL.filter(
    (r) =>
      (!entityKind || r.entityKind === entityKind) &&
      (!action || r.action === action)
  );
  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);
  return delay({ ok: true, data: { rows, total: filtered.length } });
}
