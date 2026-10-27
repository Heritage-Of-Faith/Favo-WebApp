// SEC-1 redesigned to PRD §9.5.3 / REQ-062 / L36:
// - the barista till session is NEVER rate-limited: no refusal, no lockout;
//   failed PINs only add a growing delay (250 ms per recent failure, capped at 3 s);
// - the Admin PIN rule: 5 failed attempts → a 5-minute cooldown on admin PINs
//   plus an immediate Admin alert; a correct admin PIN does not get past it;
// - every breach writes audit_log action='reject', never the attempted PIN;
// - "Incorrect PIN." stays the one message for any wrong PIN.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

let forwardedFor: string | null = null;
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? forwardedFor : null),
  })),
}));

const ROWS = [
  { id: "staff-olivia", name: "Olivia Owner", role: "admin", pinHash: "h1", active: true },
  { id: "staff-louis", name: "Louis", role: "barista", pinHash: "h2", active: true },
];
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve(ROWS) }),
    })),
  },
}));

const PINS: Record<string, string> = { h1: "1111", h2: "2222" };
vi.mock("@/server/auth/pin", () => ({
  isValidPinFormat: (pin: string) => /^\d{4,6}$/.test(pin),
  verifyPin: vi.fn(async (pin: string, hash: string) => PINS[hash] === pin),
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../../../auth", () => ({
  signIn: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  mintLoginAttestation: vi.fn(() => "attest"),
}));

import { loginWithPin } from "@/server/actions/auth";
import { timing, _resetAttemptsForTest } from "@/server/auth/attempts";
import { writeAudit } from "@/server/audit";
import { alertAdmins } from "@/server/push/admin-alert";

let sleep: MockInstance<(ms: number) => Promise<void>>;

beforeEach(() => {
  _resetAttemptsForTest();
  vi.clearAllMocks();
  sleep = vi.spyOn(timing, "sleep").mockResolvedValue(undefined);
  forwardedFor = "198.51.100.9";
  delete process.env.TRUSTED_PROXY_HOPS;
});

afterEach(() => {
  sleep.mockRestore();
  vi.useRealTimers();
});

const rejectRows = () =>
  vi.mocked(writeAudit).mock.calls.map((c) => c[0]).filter((a) => a.action === "reject");

describe("till PIN login is never refused (L36)", () => {
  it("50 wrong PINs, from one key or many, never lock the till: the right barista PIN still signs in", async () => {
    for (let i = 0; i < 50; i++) {
      forwardedFor = i % 2 ? "198.51.100.9" : `198.51.100.${i}`;
      const r = await loginWithPin("9998");
      expect(r).toEqual({ ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." });
    }
    forwardedFor = "198.51.100.9";
    const ok = await loginWithPin("2222");
    expect(ok).toMatchObject({ ok: true, data: { staffId: "staff-louis", role: "barista" } });
  });

  it("each recent failure adds 250 ms of delay, capped at 3 s — a delay, never a refusal", async () => {
    const delays: number[] = [];
    for (let i = 0; i < 15; i++) {
      sleep.mockClear();
      await loginWithPin("9998");
      delays.push((sleep.mock.calls[0]?.[0] as number | undefined) ?? 0);
    }
    expect(delays.slice(0, 5)).toEqual([0, 250, 500, 750, 1000]);
    expect(Math.max(...delays)).toBe(3000);
    expect(delays.at(-1)).toBe(3000);
  });

  it("the same slowdown applies globally, so a new key does not start from zero", async () => {
    for (let i = 0; i < 4; i++) {
      forwardedFor = `198.51.100.${i}`;
      await loginWithPin("9998");
    }
    forwardedFor = "198.51.100.250";
    sleep.mockClear();
    await loginWithPin("2222");
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("an attempt slowed to the 3 s cap is audited as action='reject' without the PIN", async () => {
    for (let i = 0; i < 13; i++) await loginWithPin("9998");
    const rows = rejectRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.reason).toMatch(/slowed/i);
      expect(JSON.stringify(r)).not.toContain("9998");
    }
  });
});

describe("Admin PIN: 5 attempts → 5-minute cooldown + immediate Admin alert", () => {
  it("fewer than 5 recent failures: the admin PIN signs in", async () => {
    for (let i = 0; i < 4; i++) await loginWithPin("9998");
    const r = await loginWithPin("1111");
    expect(r).toMatchObject({ ok: true, data: { role: "admin" } });
    expect(alertAdmins).not.toHaveBeenCalled();
  });

  it("after 5 failures the correct admin PIN is cooled down, alerted once, audited; baristas unaffected", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-25T08:10:00+02:00").getTime();
    vi.setSystemTime(t0);

    for (let i = 0; i < 5; i++) await loginWithPin("9998");

    // CHANGED: the cooled-down admin PIN answers exactly like a wrong PIN, so
    // the response cannot reveal that the PIN was a correct admin one.
    const wrong = await loginWithPin("9997");
    const r = await loginWithPin("1111");
    expect(r).toEqual({ ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." });
    expect(r).toEqual(wrong);
    expect(Object.keys(r).sort()).toEqual(Object.keys(wrong).sort());
    expect(alertAdmins).toHaveBeenCalledTimes(1);
    const rows = rejectRows().filter((a) => /admin pin/i.test(a.reason ?? ""));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const a of rows) expect(JSON.stringify(a)).not.toContain("1111");

    // The till is untouched.
    expect((await loginWithPin("2222")).ok).toBe(true);

    // Still cooling down 4 min later: refused again, no second alert.
    vi.setSystemTime(t0 + 4 * 60_000);
    vi.mocked(writeAudit).mockClear();
    expect(await loginWithPin("1111")).toEqual({ ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." });
    expect(alertAdmins).toHaveBeenCalledTimes(1);
    // Still refused AND audited as a reject (never the PIN).
    const during = rejectRows().filter((a) => /admin pin/i.test(a.reason ?? ""));
    expect(during).toHaveLength(1);
    expect(JSON.stringify(during)).not.toContain("1111");
    // A barista PIN during the admin cooldown is never refused.
    expect((await loginWithPin("2222")).ok).toBe(true);

    // After the 5-minute cooldown the counter has reset: the admin gets in.
    vi.setSystemTime(t0 + 5 * 60_000 + 1);
    expect((await loginWithPin("1111")).ok).toBe(true);
  });
});
