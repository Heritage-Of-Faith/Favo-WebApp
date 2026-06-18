// Customer auth unit tests — customer-auth.ts (Supabase Auth)
// Covers input validation, EMAIL_TAKEN, INVALID_CREDENTIALS, and logout paths.
// Supabase client is mocked to keep unit tests fast and offline.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSignUp = vi.fn();
const mockSignIn = vi.fn();
const mockSignOut = vi.fn();
const mockResetPassword = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignIn,
      signOut: mockSignOut,
      resetPasswordForEmail: mockResetPassword,
    },
  }),
}));

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

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn().mockImplementation(chain),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "cust_new", name: "Louis" }]),
      }),
    }),
  },
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

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
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: "uuid-123" } }, error: null });
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "louis@favo.co.za", password: "12345678" });
    expect(result.ok).toBe(true);
  });
});

// ─── registerCustomer — EMAIL_TAKEN ──────────────────────────────────────────

describe("registerCustomer — EMAIL_TAKEN", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns EMAIL_TAKEN when Supabase reports email already registered", async () => {
    mockSignUp.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "User already registered" },
    });
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
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: "uuid-123" } }, error: null });
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "Louis@FAVO.co.za", password: "password1" });
    expect(result.ok).toBe(true);
    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "louis@favo.co.za" })
    );
  });
});

// ─── registerCustomer — phone ─────────────────────────────────────────────────

describe("registerCustomer — phone", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a malformed phone number when one is supplied", async () => {
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({
      name: "Louis", email: "louis@favo.co.za", password: "password1", phone: "123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("persists a valid phone number on the new customer row", async () => {
    mockSignUp.mockResolvedValueOnce({ data: { user: { id: "uuid-123" } }, error: null });
    const { db } = await import("@db/index");
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

  it("returns INVALID_CREDENTIALS for unknown email", async () => {
    mockSignIn.mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid credentials" } });
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "unknown@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns INVALID_CREDENTIALS for wrong password", async () => {
    mockSignIn.mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid login credentials" } });
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "louis@favo.co.za", password: "wrongpassword" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns INVALID_CREDENTIALS when customer row not found for auth user", async () => {
    mockSignIn.mockResolvedValueOnce({ data: { user: { id: "uuid-orphan" } }, error: null });
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "orphan@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_CREDENTIALS");
  });
});

// ─── logoutCustomer ───────────────────────────────────────────────────────────

describe("logoutCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("always returns ok", async () => {
    mockSignOut.mockResolvedValueOnce({ error: null });
    const { logoutCustomer } = await import("@/server/actions/customer-auth");
    const result = await logoutCustomer();
    expect(result.ok).toBe(true);
  });

  it("calls supabase.auth.signOut", async () => {
    mockSignOut.mockResolvedValueOnce({ error: null });
    const { logoutCustomer } = await import("@/server/actions/customer-auth");
    await logoutCustomer();
    expect(mockSignOut).toHaveBeenCalledOnce();
  });
});

// ─── requestPasswordReset ─────────────────────────────────────────────────────

describe("requestPasswordReset", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid email", async () => {
    const { requestPasswordReset } = await import("@/server/actions/customer-auth");
    const result = await requestPasswordReset("notanemail");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("returns ok without leaking whether the email exists", async () => {
    mockResetPassword.mockResolvedValueOnce({ error: null });
    const { requestPasswordReset } = await import("@/server/actions/customer-auth");
    const result = await requestPasswordReset("anyone@favo.co.za");
    expect(result.ok).toBe(true);
  });
});
