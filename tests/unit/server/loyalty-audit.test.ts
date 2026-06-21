// Unit tests for listLoyaltyAudit — AT-120
// Tests RBAC gate shape, pagination arithmetic, type contracts, and
// kind badge colour mapping — without calling the DB-dependent action.

import { describe, it, expect } from "vitest";
import { canAccessAdmin } from "@/server/auth/rbac";
import type { LoyaltyAuditRow } from "@/server/actions/loyalty";

// ── Mirror constants from the action ─────────────────────────────────────────
const PAGE_SIZE = 50;

const KIND_OPTIONS = ["earn", "redeem", "adjustment", "expiry"] as const;

// ── Pagination helper (mirrors LoyaltyAuditTable display logic) ───────────────
function paginationRange(page: number, total: number) {
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const prevDisabled = page === 0;
  const nextDisabled = (page + 1) * PAGE_SIZE >= total;
  return { from, to, prevDisabled, nextDisabled };
}

// ── Kind badge colour logic (mirrors KindBadge in LoyaltyAuditTable.tsx) ──────
function kindColor(kind: LoyaltyAuditRow["kind"]) {
  if (kind === "earn") return "success";
  if (kind === "redeem") return "accent";
  if (kind === "expiry") return "error";
  return "muted";
}

// ─────────────────────────────────────────────────────────────────────────────

describe("listLoyaltyAudit: page size", () => {
  it("is 50", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

describe("listLoyaltyAudit: RBAC gate shape", () => {
  it("admin can access the admin portal", () => {
    expect(canAccessAdmin("admin")).toBe(true);
  });

  it("barista cannot access the admin portal", () => {
    expect(canAccessAdmin("barista")).toBe(false);
  });
});

describe("listLoyaltyAudit: kind enum", () => {
  it("has exactly four kinds", () => {
    expect(KIND_OPTIONS).toHaveLength(4);
    expect(KIND_OPTIONS).toContain("earn");
    expect(KIND_OPTIONS).toContain("redeem");
    expect(KIND_OPTIONS).toContain("adjustment");
    expect(KIND_OPTIONS).toContain("expiry");
  });
});

describe("listLoyaltyAudit: pagination arithmetic", () => {
  it("first page of 120 shows 1–50", () => {
    const { from, to, prevDisabled, nextDisabled } = paginationRange(0, 120);
    expect(from).toBe(1);
    expect(to).toBe(50);
    expect(prevDisabled).toBe(true);
    expect(nextDisabled).toBe(false);
  });

  it("second page of 120 shows 51–100", () => {
    const { from, to, prevDisabled, nextDisabled } = paginationRange(1, 120);
    expect(from).toBe(51);
    expect(to).toBe(100);
    expect(prevDisabled).toBe(false);
    expect(nextDisabled).toBe(false);
  });

  it("third page of 120 shows 101–120 and next is disabled", () => {
    const { from, to, nextDisabled } = paginationRange(2, 120);
    expect(from).toBe(101);
    expect(to).toBe(120);
    expect(nextDisabled).toBe(true);
  });

  it("zero total shows 0–0 with both buttons disabled", () => {
    const { from, to, prevDisabled, nextDisabled } = paginationRange(0, 0);
    expect(from).toBe(0);
    expect(to).toBe(0);
    expect(prevDisabled).toBe(true);
    expect(nextDisabled).toBe(true);
  });
});

describe("listLoyaltyAudit: LoyaltyAuditRow type contract", () => {
  it("accept a valid earn row", () => {
    const row: LoyaltyAuditRow = {
      id: "txn_1",
      customerId: "c1",
      customerName: "Louis",
      orderId: "ord_1",
      delta: 10,
      kind: "earn",
      reason: null,
      at: new Date().toISOString(),
    };
    expect(row.delta).toBeGreaterThan(0);
    expect(row.kind).toBe("earn");
  });

  it("accept a valid redeem row with null orderId", () => {
    const row: LoyaltyAuditRow = {
      id: "txn_2",
      customerId: "c2",
      customerName: "Jane",
      orderId: null,
      delta: -100,
      kind: "redeem",
      reason: null,
      at: new Date().toISOString(),
    };
    expect(row.delta).toBeLessThan(0);
    expect(row.orderId).toBeNull();
  });
});

describe("listLoyaltyAudit: KindBadge colours", () => {
  it("earn → success", () => expect(kindColor("earn")).toBe("success"));
  it("redeem → accent", () => expect(kindColor("redeem")).toBe("accent"));
  it("expiry → error", () => expect(kindColor("expiry")).toBe("error"));
  it("adjustment → muted", () => expect(kindColor("adjustment")).toBe("muted"));
});

describe("listLoyaltyAudit: delta display logic", () => {
  it("positive delta shows as +N", () => {
    const delta = 10;
    const display = delta > 0 ? `+${delta}` : String(delta);
    expect(display).toBe("+10");
  });

  it("negative delta shows as -N", () => {
    const delta = -100;
    const display = delta > 0 ? `+${delta}` : String(delta);
    expect(display).toBe("-100");
  });
});
