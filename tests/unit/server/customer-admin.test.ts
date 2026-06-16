// Admin customer actions tests — AT-78 (A16)
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff-1", role: "admin" },
  }),
}));

vi.mock("@db/schema", () => ({
  customers: { id: "id", name: "name", email: "email", phone: "phone", loyaltyPoints: "loyalty_points", walletZar: "wallet_zar", createdAt: "created_at" },
  orders: { id: "id", customerId: "customer_id", state: "state", totalZar: "total_zar", placedAt: "placed_at" },
  loyaltyTransactions: { id: "id", customerId: "customer_id", delta: "delta", kind: "kind", orderId: "order_id", at: "at" },
  walletTransactions: { id: "id", customerId: "customer_id", deltaZar: "delta_zar", kind: "kind", description: "description", relatedOrderId: "related_order_id", at: "at" },
  coffeePacks: { id: "id", customerId: "customer_id", menuItemId: "menu_item_id", qtyOriginal: "qty_original", qtyRemaining: "qty_remaining", expiresAt: "expires_at" },
  menuItems: { id: "id", name: "name" },
}));

// Shared builder for Drizzle chain mocks
function buildDbMock(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
    innerJoin: vi.fn().mockReturnThis(),
  };
  return chain;
}

import { db } from "@/lib/db";

const CUSTOMER_ROW = {
  id: "cust-1",
  name: "Louis Dreyfus",
  email: "louis@test.com",
  phone: "0821234567",
  loyaltyPoints: 45,
  walletZar: 3500,
  createdAt: new Date("2026-01-15T08:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCustomers", () => {
  it("returns a list of customers", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([CUSTOMER_ROW]) as unknown as ReturnType<typeof db.select>
    );

    const { listCustomers } = await import("@/server/actions/customers");
    const res = await listCustomers();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0]!.name).toBe("Louis Dreyfus");
    }
  });

  it("maps walletZar to the list item", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([CUSTOMER_ROW]) as unknown as ReturnType<typeof db.select>
    );

    const { listCustomers } = await import("@/server/actions/customers");
    const res = await listCustomers();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0]!.walletZar).toBe(3500);
    }
  });

  it("returns UNAUTHORIZED when not admin+", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false,
      code: "UNAUTHORIZED",
      message: "Unauthorized.",
    });

    const { listCustomers } = await import("@/server/actions/customers");
    const res = await listCustomers();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });
});

describe("getCustomerDetail", () => {
  it("returns NOT_FOUND when customer does not exist", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([]) as unknown as ReturnType<typeof db.select>
    );

    const { getCustomerDetail } = await import("@/server/actions/customers");
    const res = await getCustomerDetail("ghost-id");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("includes loyalty and wallet txns in detail", async () => {
    const loyaltyRow = {
      id: "lt-1",
      customerId: "cust-1",
      delta: 10,
      kind: "earn",
      orderId: "ord-1",
      at: new Date("2026-06-01T10:00:00Z"),
    };
    const walletRow = {
      id: "wt-1",
      customerId: "cust-1",
      deltaZar: 5000,
      kind: "topup",
      description: "Counter top-up",
      relatedOrderId: null,
      at: new Date("2026-06-02T10:00:00Z"),
    };

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return buildDbMock([CUSTOMER_ROW]) as unknown as ReturnType<typeof db.select>;
      if (callCount === 2) return buildDbMock([loyaltyRow]) as unknown as ReturnType<typeof db.select>;
      if (callCount === 3) return buildDbMock([walletRow]) as unknown as ReturnType<typeof db.select>;
      if (callCount === 4) return buildDbMock([]) as unknown as ReturnType<typeof db.select>;
      return buildDbMock([]) as unknown as ReturnType<typeof db.select>;
    });

    const { getCustomerDetail } = await import("@/server/actions/customers");
    const res = await getCustomerDetail("cust-1");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.loyaltyTxns).toHaveLength(1);
      expect(res.data.walletTxns).toHaveLength(1);
      expect(res.data.walletTxns[0]!.deltaZar).toBe(5000);
    }
  });
});
