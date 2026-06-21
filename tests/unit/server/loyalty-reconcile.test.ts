// reconcileLoyalty unit tests — AT-124 / LOY-5
// Tests RBAC, no-drift, single-drift, zero-transaction customers.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      from: vi.fn(),
      where: vi.fn(),
      groupBy: vi.fn(),
    };
    for (const k of ["from", "where", "groupBy"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    (c as { then?: unknown }).then = (resolve: (v: unknown[]) => void) => resolve([]);
    return c;
  }

  return {
    db: {
      select: vi.fn().mockImplementation(chain),
    },
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_admin_mia", name: "Mia Admin", role: "admin" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockCustomerRow(id: string, name: string, loyaltyPoints: number) {
  return { id, name, loyaltyPoints };
}

function mockLedgerRow(customerId: string, ledgerSum: number) {
  return { customerId, ledgerSum };
}

/**
 * Sets up sequential responses for db.select() calls.
 * reconcileLoyalty() makes two selects:
 *   call 0 → all customers (from customers table, no groupBy)
 *   call 1 → ledger sums (from loyaltyTransactions, with groupBy)
 */
function setupSelectSequence(
  db: { select: ReturnType<typeof vi.fn> },
  rows: unknown[][]
) {
  let call = 0;
  db.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => ({
        then: (resolve: (v: unknown[]) => void) => resolve(rows[call++] ?? []),
        [Symbol.toStringTag]: "Promise",
      })),
      groupBy: vi.fn().mockImplementation(() => ({
        then: (resolve: (v: unknown[]) => void) => resolve(rows[call++] ?? []),
        [Symbol.toStringTag]: "Promise",
      })),
      // direct thenable for the customers query (no .where, no .groupBy chain)
      then: (resolve: (v: unknown[]) => void) => { resolve(rows[call++] ?? []); },
      [Symbol.toStringTag]: "Promise",
    }),
  }));
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe("reconcileLoyalty — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-admin caller with FORBIDDEN", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false,
      code: "FORBIDDEN",
      message: "You do not have permission to do that.",
    });
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    const res = await reconcileLoyalty();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("rejects unauthenticated caller with UNAUTHORIZED", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false,
      code: "UNAUTHORIZED",
      message: "You must be signed in.",
    });
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    const res = await reconcileLoyalty();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });
});

// ─── No drift ─────────────────────────────────────────────────────────────────

describe("reconcileLoyalty — no drift", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns drifted=0 and empty rows when all balances match", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      // customers query
      [
        mockCustomerRow("cust_a", "Alice", 100),
        mockCustomerRow("cust_b", "Bob", 200),
      ],
      // ledger sums query
      [
        mockLedgerRow("cust_a", 100),
        mockLedgerRow("cust_b", 200),
      ],
    ]);
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    const res = await reconcileLoyalty();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.checked).toBe(2);
      expect(res.data.drifted).toBe(0);
      expect(res.data.rows).toEqual([]);
    }
  });

  it("does not call writeAudit when no drift found", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockCustomerRow("cust_a", "Alice", 150)],
      [mockLedgerRow("cust_a", 150)],
    ]);
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    await reconcileLoyalty();
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled();
  });
});

// ─── One drift ────────────────────────────────────────────────────────────────

describe("reconcileLoyalty — one drift", () => {
  beforeEach(() => vi.clearAllMocks());

  it("detects drift when cached=100 but ledger sums to 80", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockCustomerRow("cust_drift", "Drifter Dave", 100)],
      [mockLedgerRow("cust_drift", 80)],
    ]);
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    const res = await reconcileLoyalty();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.checked).toBe(1);
      expect(res.data.drifted).toBe(1);
      expect(res.data.rows).toHaveLength(1);
      expect(res.data.rows[0]).toMatchObject({
        customerId: "cust_drift",
        name: "Drifter Dave",
        cached: 100,
        ledger: 80,
        delta: -20,
      });
    }
  });

  it("calls writeAudit once with correct before/after when drift detected", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockCustomerRow("cust_drift", "Drifter Dave", 100)],
      [mockLedgerRow("cust_drift", 80)],
    ]);
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    await reconcileLoyalty();
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const call = vi.mocked(writeAudit).mock.calls[0][0];
    expect(call.entityKind).toBe("loyalty_reconcile");
    expect(call.entityId).toBe("cust_drift");
    expect(call.action).toBe("drift_detected");
    expect(call.before).toMatchObject({ cached: 100 });
    expect(call.after).toMatchObject({ ledger: 80, delta: -20 });
  });

  it("checks multiple customers and only reports drifted ones", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [
        mockCustomerRow("cust_ok", "Clean Carol", 50),
        mockCustomerRow("cust_bad", "Drifter Dave", 100),
      ],
      [
        mockLedgerRow("cust_ok", 50),
        mockLedgerRow("cust_bad", 80),
      ],
    ]);
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    const res = await reconcileLoyalty();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.checked).toBe(2);
      expect(res.data.drifted).toBe(1);
      expect(res.data.rows[0].customerId).toBe("cust_bad");
    }
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
  });
});

// ─── Zero-transaction customers ───────────────────────────────────────────────

describe("reconcileLoyalty — zero-transaction customer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("treats missing ledger entry as ledgerSum=0 — no drift when cached=0", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockCustomerRow("cust_new", "New Nancy", 0)],
      [], // no ledger rows
    ]);
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    const res = await reconcileLoyalty();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.drifted).toBe(0);
      expect(res.data.rows).toEqual([]);
    }
  });

  it("detects drift when cached=10 but no ledger transactions (ledgerSum=0)", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockCustomerRow("cust_new", "New Nancy", 10)],
      [], // no ledger rows → ledgerSum defaults to 0
    ]);
    const { reconcileLoyalty } = await import("@/server/actions/loyalty");
    const res = await reconcileLoyalty();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.drifted).toBe(1);
      expect(res.data.rows[0]).toMatchObject({
        customerId: "cust_new",
        cached: 10,
        ledger: 0,
        delta: -10,
      });
    }
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
  });
});
