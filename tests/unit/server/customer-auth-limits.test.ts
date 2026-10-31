// PRD §9.5.3 customer-side limits (replaces customer-auth-client-key.test.ts — CHANGED):
//   login per account: 10 failed / 15 min → 15-min cooldown, then the counter resets
//   login per IP: 30 attempts / 15 min → cooldown, audited
//   registration and password reset: 30 per IP per 15 min → cooldown, audited
// Every breach writes audit_log action='reject' with a reason, never the attempted value.
// The IP is the proxy-appended address, never the client-sent first entry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let forwardedFor = "203.0.113.77, 198.51.100.9";
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (n: string) => (n.toLowerCase() === "x-forwarded-for" ? forwardedFor : null),
  })),
}));

const { signInWithPassword, resetPasswordForEmail, signUp } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword, resetPasswordForEmail, signUp } }),
}));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

import { loginCustomer, registerCustomer, requestPasswordReset } from "@/server/actions/customer-auth";
import { _resetStoreForTest } from "@/server/rate-limit";
import { _resetAttemptsForTest } from "@/server/auth/attempts";
import { writeAudit } from "@/server/audit";

const WRONG = { data: { user: null }, error: { message: "Invalid login credentials" } };

beforeEach(() => {
  _resetStoreForTest();
  _resetAttemptsForTest();
  vi.clearAllMocks();
  forwardedFor = "203.0.113.77, 198.51.100.9";
  signInWithPassword.mockResolvedValue(WRONG);
  resetPasswordForEmail.mockResolvedValue({ error: null });
  signUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "nope" } });
});
afterEach(() => vi.useRealTimers());

const codeOf = (r: { ok: boolean }) => ("code" in r ? (r as { code: string }).code : undefined);

const rejects = () => vi.mocked(writeAudit).mock.calls.map((c) => c[0]).filter((a) => a.action === "reject");

describe("customer login — per account (10 failed / 15 min, 15-min cooldown)", () => {
  it("the 11th attempt on one account is cooled down even from a new IP, and audited", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.parse("2026-10-25T09:00:00+02:00");
    vi.setSystemTime(t0);
    for (let i = 0; i < 10; i++) {
      forwardedFor = `198.51.100.${i}`;
      const r = await loginCustomer({ email: "naledi@example.com", password: "wrongpass" });
      expect(r).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    }
    forwardedFor = "198.51.100.200";
    signInWithPassword.mockClear();
    const r = await loginCustomer({ email: "naledi@example.com", password: "rightpass" });
    expect(r).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(signInWithPassword).not.toHaveBeenCalled();
    const rows = rejects();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const a of rows) {
      expect(a.reason).toBeTruthy();
      expect(JSON.stringify(a)).not.toContain("rightpass");
      expect(JSON.stringify(a)).not.toContain("wrongpass");
    }

    // Another account is unaffected.
    expect((await loginCustomer({ email: "louis@example.com", password: "x" })).ok).toBe(false);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);

    // After 15 minutes the cooldown ends and the counter has reset.
    vi.setSystemTime(t0 + 15 * 60_000 + 1);
    signInWithPassword.mockClear();
    await loginCustomer({ email: "naledi@example.com", password: "rightpass" });
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("9 failures do not cool the account down", async () => {
    for (let i = 0; i < 9; i++) await loginCustomer({ email: "naledi@example.com", password: "w" });
    signInWithPassword.mockClear();
    await loginCustomer({ email: "naledi@example.com", password: "w" });
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });
});

describe("customer login — per IP (30 attempts / 15 min)", () => {
  it("allows 30, refuses the 31st, keyed on the proxy-appended address", async () => {
    for (let i = 0; i < 30; i++) {
      forwardedFor = `203.0.113.${i}, 198.51.100.9`; // rotating the spoofable part changes nothing
      const r = await loginCustomer({ email: `p${i}@example.com`, password: "w" });
      expect(codeOf(r)).not.toBe("RATE_LIMITED");
    }
    const r = await loginCustomer({ email: "p99@example.com", password: "w" });
    expect(r).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(rejects().some((a) => /per IP/i.test(a.reason ?? ""))).toBe(true);
  });
});

describe("registration and password reset — 30 per IP per 15 min", () => {
  const reg = (i: number) =>
    registerCustomer({ name: "Naledi", email: `n${i}@example.com`, password: "longenough1", status: "church_member" });

  it("registration: 31st from one IP is refused and audited", async () => {
    for (let i = 0; i < 30; i++) expect(codeOf(await reg(i))).not.toBe("RATE_LIMITED");
    expect(await reg(31)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(rejects().some((a) => /regist/i.test(a.reason ?? ""))).toBe(true);
  });

  it("password reset: 31st from one IP sends nothing, still answers ok (no leak), and is audited", async () => {
    for (let i = 0; i < 30; i++) await requestPasswordReset(`r${i}@example.com`);
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(30);
    const r = await requestPasswordReset("r31@example.com");
    expect(r).toEqual({ ok: true, data: null });
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(30);
    expect(rejects().some((a) => /reset/i.test(a.reason ?? ""))).toBe(true);
  });
});
