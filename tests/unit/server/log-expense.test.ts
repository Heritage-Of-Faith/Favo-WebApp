// AT-205 — PRD §11.2 logExpense(category, amount_zar, incurred_at, note?):
// Admin only (role matrix L2686), integer cents, audited in the same
// transaction (L08/L12).

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const inserted: unknown[] = [];
  const returning = vi.fn(async () => [
    { id: "exp-1", category: "rent", amountZar: 250000, incurredAt: new Date("2026-09-30T22:00:00.000Z"), note: "October rent" },
  ]);
  const values = vi.fn((v: unknown) => {
    inserted.push(v);
    return { returning };
  });
  const tx = { insert: vi.fn(() => ({ values })) };
  const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  return { inserted, values, tx, transaction };
});

vi.mock("@/lib/db", () => ({ db: { transaction: h.transaction } }));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff-admin", name: "Admin", role: "admin" },
  }),
}));

const valid = { category: "rent", amountZar: 250000, incurredAt: "2026-10-01", note: "October rent" } as const;

describe("logExpense — role guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.inserted.length = 0;
  });

  it("asks for the admin role and nothing else", async () => {
    const { authorize } = await import("@/server/auth/guard");
    const { logExpense } = await import("@/server/actions/expenses");
    await logExpense(valid);
    expect(vi.mocked(authorize)).toHaveBeenCalledWith("admin");
  });

  it("a barista is refused and nothing is written", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." });
    const { logExpense } = await import("@/server/actions/expenses");
    const res = await logExpense(valid);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    expect(h.transaction).not.toHaveBeenCalled();
  });
});

describe("logExpense — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["a fractional amount (not integer cents)", { ...valid, amountZar: 2500.5 }],
    ["a zero amount", { ...valid, amountZar: 0 }],
    ["a negative amount", { ...valid, amountZar: -100 }],
    ["a category outside the enum", { ...valid, category: "not-a-category" }],
    ["a malformed date", { ...valid, incurredAt: "01/10/2026" }],
    ["an impossible date", { ...valid, incurredAt: "2026-02-30" }],
  ])("rejects %s", async (_label, input) => {
    const { logExpense } = await import("@/server/actions/expenses");
    const res = await logExpense(input as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
    expect(h.transaction).not.toHaveBeenCalled();
  });
});

describe("logExpense — write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.inserted.length = 0;
  });

  it("inserts integer cents, a SAST-midnight incurred_at, the note and the admin as logged_by", async () => {
    const { logExpense } = await import("@/server/actions/expenses");
    const res = await logExpense(valid);
    expect(res.ok).toBe(true);
    expect(h.inserted).toEqual([
      {
        category: "rent",
        amountZar: 250000,
        incurredAt: new Date("2026-09-30T22:00:00.000Z"),
        loggedBy: "staff-admin",
        note: "October rent",
      },
    ]);
  });

  it("a blank note is stored as NULL", async () => {
    const { logExpense } = await import("@/server/actions/expenses");
    await logExpense({ ...valid, note: "   " });
    expect((h.inserted[0] as { note: unknown }).note).toBeNull();
  });

  it("writes the audit row inside the same transaction", async () => {
    const { writeAudit } = await import("@/server/audit");
    const { logExpense } = await import("@/server/actions/expenses");
    await logExpense(valid);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "expense.logged",
        entityKind: "expense",
        entityId: "exp-1",
        actorId: "staff-admin",
        actorRole: "admin",
        after: { category: "rent", amountZar: 250000, incurredAt: "2026-09-30T22:00:00.000Z", note: "October rent" },
      }),
      h.tx
    );
  });
});
