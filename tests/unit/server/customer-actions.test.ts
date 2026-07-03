// Customer data server-action unit tests — G18/G19
// Tests RBAC (no session → UNAUTHORIZED), shape mapping, and profile validation.
// DB and session are mocked — no network required.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

// Customer reads now run inside withCustomerScope (RLS, F2/L13). For unit tests
// we bypass the real transaction/role switch and run the callback against the
// mocked db — DB-layer isolation is covered separately in tests/db/.
vi.mock("@/lib/db-rls", async () => {
  const { db } = await import("@db/index");
  return {
    withCustomerScope: (_customerId: string, fn: (tx: unknown) => unknown) => fn(db),
  };
});

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/auth/customer-session", () => ({
  getCustomerSession: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSelectChain(rows: unknown[]) {
  const thenable = {
    then: (resolve: (v: unknown[]) => void) => { resolve(rows); return thenable; },
    catch: (reject: (e: unknown) => void) => { void reject; return thenable; },
    finally: () => thenable,
    [Symbol.toStringTag]: "Promise",
  };
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    leftJoin: vi.fn(),
    ...thenable,
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  chain.leftJoin.mockReturnValue(chain);
  return chain;
}

const CUSTOMER_ID = "cust_louis";

// ─── getCustomerSummary ───────────────────────────────────────────────────────

describe("getCustomerSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns UNAUTHORIZED when no session cookie", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(null);
    const { getCustomerSummary } = await import("@/server/actions/customer");
    const res = await getCustomerSummary();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("returns summary with loyalty points and pack count", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);

    const { db } = await import("@db/index");

    // first select → customer row
    vi.mocked(db.select)
      .mockReturnValueOnce(makeSelectChain([
        { id: CUSTOMER_ID, name: "Louis", loyaltyPoints: 45 },
      ]) as unknown as ReturnType<typeof db.select>)
      // second select → active pack count
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 2 }]),
        }),
      } as unknown as ReturnType<typeof db.select>);

    const { getCustomerSummary } = await import("@/server/actions/customer");
    const res = await getCustomerSummary();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.name).toBe("Louis");
    expect(res.data.loyaltyPoints).toBe(45);
    expect(res.data.activePackCount).toBe(2);
  });

  it("returns NOT_FOUND when customer row is missing", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as unknown as ReturnType<typeof db.select>);

    const { getCustomerSummary } = await import("@/server/actions/customer");
    const res = await getCustomerSummary();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });
});

// ─── listCustomerOrders ───────────────────────────────────────────────────────

describe("listCustomerOrders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns UNAUTHORIZED when no session", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(null);
    const { listCustomerOrders } = await import("@/server/actions/customer");
    const res = await listCustomerOrders();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("returns empty array when customer has no orders", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as unknown as ReturnType<typeof db.select>);

    const { listCustomerOrders } = await import("@/server/actions/customer");
    const res = await listCustomerOrders();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(0);
  });

  it("maps orders to CustomerOrder shape with ISO timestamps", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);

    const { db } = await import("@db/index");
    const placed = new Date("2026-06-12T07:00:00Z");
    const completed = new Date("2026-06-12T07:05:00Z");

    vi.mocked(db.select)
      .mockReturnValueOnce(makeSelectChain([
        { id: "ord-1", state: "collected", placedAt: placed, completedAt: completed, totalZar: 4500 },
      ]) as unknown as ReturnType<typeof db.select>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: "oi-1", orderId: "ord-1", menuItemId: "mi-1", menuItemName: "Cappuccino", quantity: 1, unitPriceZar: 4500, modifications: [] },
            ]),
          }),
        }),
      } as unknown as ReturnType<typeof db.select>);

    const { listCustomerOrders } = await import("@/server/actions/customer");
    const res = await listCustomerOrders();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(1);
    const order = res.data[0]!;
    expect(order.id).toBe("ord-1");
    expect(order.placedAt).toBe(placed.toISOString());
    expect(order.completedAt).toBe(completed.toISOString());
    expect(order.items).toHaveLength(1);
    expect(order.items[0]!.menuItemName).toBe("Cappuccino");
  });
});

// ─── getPacks ─────────────────────────────────────────────────────────────────

describe("getPacks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns UNAUTHORIZED when no session", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(null);
    const { getPacks } = await import("@/server/actions/customer");
    const res = await getPacks();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("splits packs into active and expired correctly", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);

    const { db } = await import("@db/index");
    const futureExpiry = new Date(Date.now() + 30 * 86400_000);
    const pastExpiry = new Date(Date.now() - 30 * 86400_000);
    const created = new Date("2026-05-01T00:00:00Z");

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: "pack-1", menuItemId: "mi-1", itemName: "Cappuccino", qtyOriginal: 10, qtyRemaining: 5, expiresAt: futureExpiry, createdAt: created },
              { id: "pack-2", menuItemId: "mi-2", itemName: "Americano", qtyOriginal: 10, qtyRemaining: 0, expiresAt: pastExpiry, createdAt: created },
            ]),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const { getPacks } = await import("@/server/actions/customer");
    const res = await getPacks();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.active).toHaveLength(1);
    expect(res.data.active[0]!.id).toBe("pack-1");
    expect(res.data.active[0]!.itemName).toBe("Cappuccino");
    expect(res.data.expired).toHaveLength(1);
    expect(res.data.expired[0]!.id).toBe("pack-2");
  });
});

// ─── updateCustomerProfile ────────────────────────────────────────────────────

describe("updateCustomerProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns UNAUTHORIZED when no session", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(null);
    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ name: "Bob" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("rejects empty input (no fields to update)", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects name shorter than 2 chars", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ name: "X" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("updates name successfully and writes audit row", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);

    const { db } = await import("@db/index");
    const { writeAudit } = await import("@/server/audit");

    const returningMock = vi.fn().mockResolvedValue([{ id: CUSTOMER_ID }]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.update).mockReturnValue({ set: setMock } as unknown as ReturnType<typeof db.update>);

    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ name: "Louis V" });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(CUSTOMER_ID);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.profile_update", entityKind: "customers" })
    );
  });

  it("rejects phone number shorter than 7 chars", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ phone: "123" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });
});

// ─── getCustomerProfile ───────────────────────────────────────────────────────

describe("getCustomerProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns UNAUTHORIZED when no session", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(null);
    const { getCustomerProfile } = await import("@/server/actions/customer");
    const res = await getCustomerProfile();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("returns NOT_FOUND when customer row is missing", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([]) as unknown as ReturnType<typeof db.select>);
    const { getCustomerProfile } = await import("@/server/actions/customer");
    const res = await getCustomerProfile();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("returns id, name, email, phone for authenticated customer", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { db } = await import("@db/index");
    const profileRow = makeSelectChain([{ id: CUSTOMER_ID, name: "Louis", email: "louis@favo.co.za", phone: "082 111 2222" }]);
    vi.mocked(db.select).mockReturnValueOnce(profileRow as unknown as ReturnType<typeof db.select>);
    const { getCustomerProfile } = await import("@/server/actions/customer");
    const res = await getCustomerProfile();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe(CUSTOMER_ID);
      expect(res.data.name).toBe("Louis");
      expect(res.data.email).toBe("louis@favo.co.za");
      expect(res.data.phone).toBe("082 111 2222");
    }
  });
});
