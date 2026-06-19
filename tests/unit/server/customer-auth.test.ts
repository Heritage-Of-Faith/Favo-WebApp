// Customer auth unit tests — customer-auth.ts (Supabase Auth)
// Covers input validation, phone deduplication, legacy re-link, email verification,
// EMAIL_TAKEN, INVALID_CREDENTIALS, EMAIL_NOT_VERIFIED, logout paths, and rate limiting.
// Supabase client and rate limiter are mocked to keep tests fast and offline.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSignUp = vi.fn();
const mockSignIn = vi.fn();
const mockSignOut = vi.fn();
const mockGetUser = vi.fn();
const mockResetPassword = vi.fn();
const mockResend = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignIn,
      signOut: mockSignOut,
      getUser: mockGetUser,
      resetPasswordForEmail: mockResetPassword,
      resend: mockResend,
    },
  }),
}));

// next/headers is not available in unit tests — mock with a static IP
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: () => "1.2.3.4" }),
}));

// Rate limiter: default to allowed so existing tests are unaffected.
// Individual tests override this to simulate rate-limited state.
const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: true });
vi.mock("@/server/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

function chain(result: unknown[] = []) {
  const c: Record<string, unknown> = {
    then: (resolve: (v: unknown[]) => void) => resolve(result),
    from: vi.fn(), where: vi.fn(),
  };
  for (const k of ["from", "where"]) {
    (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
  }
  return c;
}

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn().mockImplementation(() => chain()),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "cust_new", name: "Louis" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "cust_migrated", name: "Gian" }]),
        }),
      }),
    }),
  },
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

// Supabase signUp response with an active session (email confirmation disabled)
const signedInResponse = { data: { user: { id: "uuid-123" }, session: { access_token: "tok" } }, error: null };
// Supabase signUp response without a session (email confirmation enabled)
const pendingResponse = { data: { user: { id: "uuid-123" }, session: null }, error: null };

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
    mockSignUp.mockResolvedValueOnce(signedInResponse);
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
    mockSignUp.mockResolvedValueOnce(signedInResponse);
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
    mockSignUp.mockResolvedValueOnce(signedInResponse);
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

// ─── registerCustomer — PHONE_TAKEN ──────────────────────────────────────────

describe("registerCustomer — PHONE_TAKEN", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns PHONE_TAKEN when another customer already uses that number", async () => {
    const { db } = await import("@db/index");
    // First db.select call (phone check) returns an existing customer
    vi.mocked(db.select).mockImplementationOnce(() => chain([{ id: "cust_existing" }]) as never);
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({
      name: "Gian", email: "gian@work.co.za", password: "password1", phone: "082 999 0000",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PHONE_TAKEN");
  });

  it("does not call Supabase signUp when the phone is taken", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockImplementationOnce(() => chain([{ id: "cust_existing" }]) as never);
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    await registerCustomer({
      name: "Gian", email: "gian@work.co.za", password: "password1", phone: "082 999 0000",
    });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("allows legacy customer with same email+phone to bypass PHONE_TAKEN and re-link", async () => {
    mockSignUp.mockResolvedValueOnce(signedInResponse);
    const { db } = await import("@db/index");
    // Phone check: same phone, same email, null auth_id → legacy row → skip PHONE_TAKEN
    vi.mocked(db.select).mockImplementationOnce(
      () => chain([{ id: "cust_legacy", email: "gian@favo.co.za", authId: null }]) as never
    );
    // Email/re-link check: returns the same legacy row
    vi.mocked(db.select).mockImplementationOnce(
      () => chain([{ id: "cust_legacy", name: "Gian", authId: null }]) as never
    );
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({
      name: "Gian", email: "gian@favo.co.za", password: "password1", phone: "082 999 0000",
    });
    expect(result.ok).toBe(true);
    expect(vi.mocked(db.update)).toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });
});

// ─── registerCustomer — legacy re-link ───────────────────────────────────────

describe("registerCustomer — legacy customer re-link", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links auth user to existing customers row instead of inserting a duplicate", async () => {
    mockSignUp.mockResolvedValueOnce(signedInResponse);
    const { db } = await import("@db/index");
    // No phone provided → phone check is skipped. Only the email check select runs.
    vi.mocked(db.select).mockImplementationOnce(
      () => chain([{ id: "cust_legacy", name: "Gian", authId: null }]) as never
    );
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Gian", email: "gian@favo.co.za", password: "password1" });
    expect(result.ok).toBe(true);
    expect(vi.mocked(db.update)).toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it("returns the migrated customer id on re-link", async () => {
    mockSignUp.mockResolvedValueOnce(signedInResponse);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockImplementationOnce(
      () => chain([{ id: "cust_legacy", name: "Gian", authId: null }]) as never
    );
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Gian", email: "gian@favo.co.za", password: "password1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.customerId).toBe("cust_migrated");
  });
});

// ─── registerCustomer — email verification ────────────────────────────────────

describe("registerCustomer — email verification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns verificationSent: false when Supabase issues a session immediately", async () => {
    mockSignUp.mockResolvedValueOnce(signedInResponse);
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.verificationSent).toBe(false);
  });

  it("returns verificationSent: true when email confirmation is required (no session)", async () => {
    mockSignUp.mockResolvedValueOnce(pendingResponse);
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.verificationSent).toBe(true);
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

// ─── loginCustomer — RATE_LIMITED ────────────────────────────────────────────

describe("loginCustomer — RATE_LIMITED (SEC-4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns RATE_LIMITED when the IP limit is exceeded", async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSecs: 42 });
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });

  it("does not call Supabase signIn when rate-limited", async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSecs: 10 });
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    await loginCustomer({ email: "louis@favo.co.za", password: "password1" });
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

// ─── registerCustomer — RATE_LIMITED ─────────────────────────────────────────

describe("registerCustomer — RATE_LIMITED (SEC-4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns RATE_LIMITED when the IP limit is exceeded", async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfterSecs: 30 });
    const { registerCustomer } = await import("@/server/actions/customer-auth");
    const result = await registerCustomer({ name: "Louis", email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
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

// ─── loginCustomer — EMAIL_NOT_VERIFIED ──────────────────────────────────────

describe("loginCustomer — EMAIL_NOT_VERIFIED", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns EMAIL_NOT_VERIFIED when Supabase reports email not confirmed", async () => {
    mockSignIn.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Email not confirmed" },
    });
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMAIL_NOT_VERIFIED");
  });
});

// ─── loginCustomer — audit ────────────────────────────────────────────────────

describe("loginCustomer — audit on success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes a customer.login audit row on successful login (SEC-1)", async () => {
    mockSignIn.mockResolvedValueOnce({ data: { user: { id: "uuid-123" } }, error: null });
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "cust_123", name: "Louis" }]),
      }),
    } as never);
    const { writeAudit } = await import("@/server/audit");
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    const result = await loginCustomer({ email: "louis@favo.co.za", password: "password1" });
    expect(result.ok).toBe(true);
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.login", entityId: "cust_123" })
    );
  });

  it("does not call writeAudit when credentials are wrong", async () => {
    mockSignIn.mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid login credentials" } });
    const { writeAudit } = await import("@/server/audit");
    const { loginCustomer } = await import("@/server/actions/customer-auth");
    await loginCustomer({ email: "louis@favo.co.za", password: "wrong" });
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled();
  });
});

// ─── logoutCustomer ───────────────────────────────────────────────────────────

describe("logoutCustomer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no authenticated session (logout still succeeds; audit skipped)
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("always returns ok", async () => {
    const { logoutCustomer } = await import("@/server/actions/customer-auth");
    const result = await logoutCustomer();
    expect(result.ok).toBe(true);
  });

  it("calls signOut({ scope: 'global' }) to revoke all devices (SEC-1)", async () => {
    const { logoutCustomer } = await import("@/server/actions/customer-auth");
    await logoutCustomer();
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("writes a customer.logout audit row when customer is found (SEC-1)", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "uuid-123" } } });
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "cust_123" }]),
      }),
    } as never);
    const { writeAudit } = await import("@/server/audit");
    const { logoutCustomer } = await import("@/server/actions/customer-auth");
    await logoutCustomer();
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.logout", entityId: "cust_123" })
    );
  });

  it("does not fail logout when no session exists (anonymous call)", async () => {
    // mockGetUser already returns { data: { user: null } } via beforeEach default
    const { logoutCustomer } = await import("@/server/actions/customer-auth");
    const result = await logoutCustomer();
    expect(result.ok).toBe(true);
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

// ─── resendVerificationEmail ──────────────────────────────────────────────────

describe("resendVerificationEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid email", async () => {
    const { resendVerificationEmail } = await import("@/server/actions/customer-auth");
    const result = await resendVerificationEmail("notanemail");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });

  it("returns ok and calls supabase.auth.resend", async () => {
    mockResend.mockResolvedValueOnce({ error: null });
    const { resendVerificationEmail } = await import("@/server/actions/customer-auth");
    const result = await resendVerificationEmail("louis@favo.co.za");
    expect(result.ok).toBe(true);
    expect(mockResend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "signup", email: "louis@favo.co.za" })
    );
  });
});
