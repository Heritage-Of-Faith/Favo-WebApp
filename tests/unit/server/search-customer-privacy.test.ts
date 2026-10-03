// AT-185 / REQ-142 — searchCustomer must not leak email or the full phone.
// REQ-142: "Given any search response · When its payload is inspected · Then it
// carries no email address and no full phone number, and two results sharing a
// given name are distinguishable by surname or by four phone digits".
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff-1", role: "barista" },
  }),
}));

function buildDbMock(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
}

import { db } from "@/lib/db";
import { searchCustomer } from "@/server/actions/customers";

// The row as the database holds it. The mock deliberately returns email and the
// full phone even if the action does not ask for them, so the test proves the
// action strips them rather than relying on the select alone.
const LOUIS_ROW = {
  id: "cust-louis",
  name: "Louis Botha",
  phone: "+27821234567",
  email: "louis@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchCustomer — REQ-142 payload privacy", () => {
  it("returns no email and no full phone, only the last four digits", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([LOUIS_ROW]) as unknown as ReturnType<typeof db.select>
    );

    const result = await searchCustomer("Lou");

    // (a)
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);

    // (b) no result object carries an email or phone key
    for (const r of result.data) {
      expect(r).not.toHaveProperty("email");
      expect(r).not.toHaveProperty("phone");
    }

    // (c) the serialised payload contains neither value, nor the national number
    const payload = JSON.stringify(result);
    expect(payload).not.toContain("louis@example.com");
    expect(payload).not.toContain("+27821234567");
    expect(payload).not.toContain("821234567");

    // (d)
    expect(result.data[0]).toEqual({ id: "cust-louis", name: "Louis Botha", phoneLast4: "4567" });
  });

  it("does not request email in the select projection", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([LOUIS_ROW]) as unknown as ReturnType<typeof db.select>
    );

    await searchCustomer("Lou");

    // phone is still read server-side to derive the last four digits; it is
    // stripped before the response (asserted above). email is never read.
    const projection = vi.mocked(db.select).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(projection).toBeDefined();
    expect(Object.keys(projection ?? {})).not.toContain("email");
  });

  it("(e) two results both named Louis are distinguishable by four phone digits", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([
        { id: "c1", name: "Louis", phone: "+27821234567", email: null },
        { id: "c2", name: "Louis", phone: "+27839876543", email: null },
      ]) as unknown as ReturnType<typeof db.select>
    );

    const result = await searchCustomer("Louis");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.phoneLast4)).toEqual(["4567", "6543"]);
    expect(result.data[0]!.phoneLast4).not.toBe(result.data[1]!.phoneLast4);
  });

  it("phoneLast4 is null when there is no phone or fewer than four digits", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([
        { id: "c1", name: "Thandeka", phone: null, email: "t@example.com" },
        { id: "c2", name: "Nkuli", phone: "123", email: null },
      ]) as unknown as ReturnType<typeof db.select>
    );

    const result = await searchCustomer("ka");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.phoneLast4)).toEqual([null, null]);
    expect(JSON.stringify(result)).not.toContain("t@example.com");
  });
});
