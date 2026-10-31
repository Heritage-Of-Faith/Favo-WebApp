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
  customers: { id: "id", name: "name", email: "email", phone: "phone", surname: "surname", status: "status", createdAt: "created_at" },
  orders: { id: "id", customerId: "customer_id", state: "state", totalZar: "total_zar", placedAt: "placed_at" },
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
  name: "Louis",
  surname: "Dreyfus",
  status: "office_staff",
  email: "louis@test.com",
  phone: "0821234567",
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
      expect(res.data[0]!.name).toBe("Louis");
    }
  });

  it("carries surname, status and last-4 phone, with no email and no full phone (REQ-142)", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([CUSTOMER_ROW]) as unknown as ReturnType<typeof db.select>
    );
    const { listCustomers } = await import("@/server/actions/customers");
    const res = await listCustomers();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]).toMatchObject({ surname: "Dreyfus", status: "office_staff", phoneLast4: "4567" });
    const json = JSON.stringify(res.data);
    expect(json).not.toContain("louis@test.com");
    expect(json).not.toContain("0821234567");
    expect(res.data[0]).not.toHaveProperty("email");
    expect(res.data[0]).not.toHaveProperty("phone");
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

  it("detail carries no email and no full phone (REQ-142)", async () => {
    let n = 0;
    vi.mocked(db.select).mockImplementation(() => {
      n++;
      return buildDbMock(n === 1 ? [CUSTOMER_ROW] : []) as unknown as ReturnType<typeof db.select>;
    });
    const { getCustomerDetail } = await import("@/server/actions/customers");
    const res = await getCustomerDetail("cust-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const json = JSON.stringify(res.data);
    expect(json).not.toContain("louis@test.com");
    expect(json).not.toContain("0821234567");
    expect(res.data.phoneLast4).toBe("4567");
  });

  it("includes recent orders in detail", async () => {
    const orderRow = {
      id: "ord-1",
      state: "collected",
      totalZar: 4500,
      placedAt: new Date("2026-06-01T10:00:00Z"),
    };

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return buildDbMock([CUSTOMER_ROW]) as unknown as ReturnType<typeof db.select>;
      if (callCount === 2) return buildDbMock([orderRow]) as unknown as ReturnType<typeof db.select>;
      return buildDbMock([]) as unknown as ReturnType<typeof db.select>;
    });

    const { getCustomerDetail } = await import("@/server/actions/customers");
    const res = await getCustomerDetail("cust-1");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.recentOrders).toHaveLength(1);
      expect(res.data.recentOrders[0]!.id).toBe("ord-1");
    }
  });
});
