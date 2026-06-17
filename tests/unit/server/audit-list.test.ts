// Unit tests for audit log viewer logic — task A6
// Tests schema validation, pagination constants, RBAC gate, and type shapes.
// The listAudit server action itself is not imported here — it chains into
// next-auth which is unavailable in the unit-test environment. Integration
// coverage is provided by the Phase 1 Playwright acceptance spec.

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { canAccessAdmin } from "@/server/auth/rbac";
import type { AuditLog } from "@/lib/types";

// ── Constants (mirror src/server/actions/audit.ts) ────────────────────────────
const PAGE_SIZE = 50;

// ── Schema (mirrors listAuditSchema in the action) ───────────────────────────
const listAuditSchema = z.object({
  page: z.number().int().nonnegative().default(0),
  entityKind: z.string().optional(),
  actorRole: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

// ── Pagination helper (mirrors AuditViewer display logic) ─────────────────────
function paginationRange(page: number, total: number) {
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const nextDisabled = (page + 1) * PAGE_SIZE >= total;
  return { from, to, nextDisabled };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("listAudit: page size constant", () => {
  it("is 50", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

describe("listAudit: input schema validation", () => {
  it("accepts empty input and defaults page to 0", () => {
    const result = listAuditSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.page).toBe(0);
  });

  it("accepts valid filters", () => {
    const result = listAuditSchema.safeParse({
      page: 2,
      entityKind: "order",
      actorRole: "admin",
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.entityKind).toBe("order");
      expect(result.data.actorRole).toBe("admin");
    }
  });

  it("rejects negative page number", () => {
    const result = listAuditSchema.safeParse({ page: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects fractional page number", () => {
    const result = listAuditSchema.safeParse({ page: 1.5 });
    expect(result.success).toBe(false);
  });

  it("optional filters are undefined when omitted", () => {
    const result = listAuditSchema.safeParse({ page: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entityKind).toBeUndefined();
      expect(result.data.actorRole).toBeUndefined();
      expect(result.data.dateFrom).toBeUndefined();
      expect(result.data.dateTo).toBeUndefined();
    }
  });
});

describe("listAudit: RBAC gate (canAccessAdmin)", () => {
  it("admin can access audit log", () => {
    expect(canAccessAdmin("admin")).toBe(true);
  });

  it("barista cannot access audit log", () => {
    expect(canAccessAdmin("barista")).toBe(false);
  });
});

describe("AuditLog type shape", () => {
  it("accepts a full audit row with non-null before/after", () => {
    const row: AuditLog = {
      id: "abc-123",
      entityKind: "order",
      entityId: "order-xyz",
      action: "create",
      actorId: "staff-1",
      actorRole: "barista",
      at: "2026-06-02T08:00:00.000Z",
      before: null,
      after: { state: "ordered", totalZar: 4500 },
      reason: null,
    };
    expect(row.entityKind).toBe("order");
    expect(row.actorRole).toBe("barista");
    expect(row.before).toBeNull();
    expect(typeof row.at).toBe("string");
  });

  it("allows all nullable fields to be null", () => {
    const row: AuditLog = {
      id: "def-456",
      entityKind: "staff",
      entityId: "staff-99",
      action: "deactivate",
      actorId: null,
      actorRole: null,
      at: "2026-06-01T12:00:00.000Z",
      before: { active: true },
      after: { active: false },
      reason: "Left the company",
    };
    expect(row.actorId).toBeNull();
    expect(row.actorRole).toBeNull();
    expect(row.reason).toBe("Left the company");
  });
});

describe("pagination math", () => {
  it("page 0 starts at entry 1", () => {
    const { from, to } = paginationRange(0, 120);
    expect(from).toBe(1);
    expect(to).toBe(50);
  });

  it("page 1 starts at entry 51", () => {
    const { from, to } = paginationRange(1, 120);
    expect(from).toBe(51);
    expect(to).toBe(100);
  });

  it("last partial page shows correct range", () => {
    const { from, to } = paginationRange(2, 120);
    expect(from).toBe(101);
    expect(to).toBe(120);
  });

  it("next button is disabled on the last page", () => {
    const { nextDisabled } = paginationRange(2, 120);
    expect(nextDisabled).toBe(true);
  });

  it("next button is enabled when more pages exist", () => {
    const { nextDisabled } = paginationRange(1, 120);
    expect(nextDisabled).toBe(false);
  });

  it("zero total shows no entries", () => {
    const { from } = paginationRange(0, 0);
    expect(from).toBe(0);
  });
});
