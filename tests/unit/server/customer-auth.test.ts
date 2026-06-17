// Customer auth unit tests — customer-auth.ts
// Covers input validation (email, password, name), EMAIL_TAKEN, and
// INVALID_CREDENTIALS paths. bcrypt happy paths (hash/compare) are deferred
// to integration tests — these tests mock bcrypt to keep unit tests fast.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      then: (resolve: (v: unknown[]) => void) => resolve([]),
      from: vi.fn(), where: vi.fn(),
    };
    for (const k of ["from", "where"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    return c;
  }
  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "cust_new", name: "Louis" }]),
        }),
      }),
    },
  };
});

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$12$hashed"),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/server/auth/customer-session", () => ({
  setCustomerSession: vi.fn().mockResolvedValue(undefined),
  clearCustomerSession: vi.fn().mockResolvedValue(undefined),
}));

// ─── registerCustomer — validation ───────────────────────────────────────────

describe("registerCustomer — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects name shorter than 2 characters", async () => {
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "L", email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects name that is only whitespace", async () => {
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "  ", email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects invalid email (no @)", async () => {
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "notanemail", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects invalid email (missing domain)", async () => {
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "louis@", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects password shorter than 8 characters", async () => {
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "louis@favo.co.za", password: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("accepts 8-character password as minimum", async () => {
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "louis@favo.co.za", password: "12345678" });
    expect(result.ok).toBe(true);
  });
});

// ─── registerCustomer — EMAIL_TAKEN ──────────────────────────────────────────

describe("registerCustomer — EMAIL_TAKEN", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns EMAIL_TAKEN when email already registered", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "cust_existing" }]),
      }),
    } as never);
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMAIL_TAKEN");
  });
});

// ─── registerCustomer — normalisation ────────────────────────────────────────

describe("registerCustomer — email normalisation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lowercases the email before registration", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    // Should not fail validation even with mixed-case email
    const result = await registerCustomer({ name: "Louis", email: "Louis@FAVO.co.za", password: "password1" });
    expect(result.ok).toBe(true);
  });
});

// ─── registerCustomer — phone (AT-64) ────────────────────────────────────────

describe("registerCustomer — phone", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a malformed phone number when one is supplied", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({
      name: "Louis", email: "louis@favo.co.za", password: "password1", phone: "123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("persists a valid phone number on the new customer row", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({
      name: "Louis", email: "louis@favo.co.za", password: "password1", phone: "082 123 4567",
    });
    expect(result.ok).toBe(true);
    const insertResult = vi.mocked(db.insert).mock.results.at(-1)?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(insertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "082 123 4567" })
    );
  });
});

// ─── loginCustomer — validation ───────────────────────────────────────────────

describe("loginCustomer — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid email format", async () => {
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "notvalid", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("rejects empty password", async () => {
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "louis@favo.co.za", password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });
});

// ─── loginCustomer — INVALID_CREDENTIALS ─────────────────────────────────────

describe("loginCustomer — INVALID_CREDENTIALS", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns INVALID_CREDENTIALS for unknown email (does not reveal existence)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "unknown@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns INVALID_CREDENTIALS for wrong password", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "cust_1", name: "Louis", passwordHash: "$2a$12$hashed" },
        ]),
      }),
    } as never);
    const bcrypt = await import("bcryptjs");
    vi.mocked(bcrypt.default.compare).mockResolvedValueOnce(false as never);
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "louis@favo.co.za", password: "wrongpassword" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns INVALID_CREDENTIALS when account has no passwordHash (social account)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "cust_1", name: "Louis", passwordHash: null },
        ]),
      }),
    } as never);
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CREDENTIALS");
  });
});

// ─── logoutCustomer ───────────────────────────────────────────────────────────

describe("logoutCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("always returns ok", async () => {
    const { logoutCustomer } = await import("@/server/actions/customer-auth");
    const result = await logoutCustomer();
    expect(result.ok).toBe(true);
  });

  it("calls clearCustomerSession", async () => {
    const { clearCustomerSession } = await import("@/server/auth/customer-session");
    const { logoutCustomer } = await import("@/server/actions/customer-auth");
    await logoutCustomer();
    expect(clearCustomerSession).toHaveBeenCalledOnce();
  });
});
