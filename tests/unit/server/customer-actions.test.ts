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

  it("returns the customer's summary (name + push subscription flag)", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);

    const { db } = await import("@db/index");

    vi.mocked(db.select).mockReturnValueOnce(makeSelectChain([
      { id: CUSTOMER_ID, name: "Louis", hasPushSubscription: false },
    ]) as unknown as ReturnType<typeof db.select>);

    const { getCustomerSummary } = await import("@/server/actions/customer");
    const res = await getCustomerSummary();

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.name).toBe("Louis");
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

// ─── updateCustomerProfile — surname (AT-211, §6.4 drift rule) ────────────────
// Status is NOT editable here: PRD §10.3 sets it at self-registration only.

describe("updateCustomerProfile — surname (AT-211)", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockUpdate(db: { update: unknown }) {
    const returningMock = vi.fn().mockResolvedValue([{ id: CUSTOMER_ID }]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.update as () => unknown).mockReturnValue({ set: setMock });
    return setMock;
  }

  it("writes the surname from the account page and audits it", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { db } = await import("@db/index");
    const { writeAudit } = await import("@/server/audit");
    const setMock = mockUpdate(db);

    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ surname: "Mokoena" });

    expect(res.ok).toBe(true);
    expect(setMock).toHaveBeenCalledWith({ surname: "Mokoena" });
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.profile_update", after: { surname: "Mokoena" } })
    );
  });

  it("a blank surname clears it (null)", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { db } = await import("@db/index");
    const setMock = mockUpdate(db);

    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ name: "Thandeka", surname: "   " });

    expect(res.ok).toBe(true);
    expect(setMock).toHaveBeenCalledWith({ name: "Thandeka", surname: null });
  });

  it("never writes status — §10.3 sets it at self-registration only", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { db } = await import("@db/index");
    const setMock = mockUpdate(db);

    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ surname: "Mokoena", status: "office_staff" } as never);

    expect(res.ok).toBe(true);
    expect(setMock).toHaveBeenCalledWith({ surname: "Mokoena" });
    expect(setMock.mock.calls[0]?.[0]).not.toHaveProperty("status");
  });

  it("a status-only call is not an update at all", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { db } = await import("@db/index");
    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ status: "office_staff" } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it.each([
    ["a zero-width space", "Mo​koena"],
    ["a zero-width joiner", "Mokoena‍"],
    // A leading/trailing BOM is whitespace to String.trim() and is stripped; inside the name it is refused.
    ["an embedded byte-order mark", "Mo﻿koena"],
    ["a control character", "Mo\u0007koena"],
    ["a bidi override", "‮Mokoena"],
  ])("refuses a surname containing %s", async (_label, surname) => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { db } = await import("@db/index");
    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ surname });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
    expect(vi.mocked(db.update)).not.toHaveBeenCalled();
  });

  it("accepts accented and hyphenated surnames", async () => {
    const { surnameSchema } = await import("@/lib/customer/identity");
    for (const s of ["Botha-Mokoena", "Müller", "du Plessis", "O'Brien"]) {
      expect(surnameSchema.safeParse(s)).toEqual({ success: true, data: s });
    }
  });

  it("validates against the SAME surname schema registration uses — one rule, not two (§6.4)", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValue(CUSTOMER_ID);
    const { customerIdentitySchema, surnameSchema } = await import("@/lib/customer/identity");
    expect(customerIdentitySchema.shape.surname).toBe(surnameSchema);
    const expected = surnameSchema.safeParse("Mo​koena");
    expect(expected.success).toBe(false);

    const { updateCustomerProfile } = await import("@/server/actions/customer");
    const res = await updateCustomerProfile({ surname: "Mo​koena" });
    expect(res.ok).toBe(false);
    if (!res.ok && !expected.success) expect(res.message).toBe(expected.error.issues[0]?.message);
  });

  it("the identity schema's statuses are exactly the customer_status enum", async () => {
    const { CUSTOMER_STATUSES } = await import("@/lib/customer/identity");
    const { customerStatus } = await import("@db/enums");
    expect([...CUSTOMER_STATUSES]).toEqual([...customerStatus.enumValues]);
  });
});
