// SEC-1 — loginWithPin throttle cannot be reset by the client.
// (a) the per-client key comes from the trusted proxy hop, so rotating a
//     client-supplied X-Forwarded-For value does not give a fresh bucket;
// (b) a global failed-attempt budget across ALL clients locks PIN login even
//     when every attempt arrives with a different key;
// (c) "Incorrect PIN." stays the one message for any wrong PIN.
import { describe, it, expect, vi, beforeEach } from "vitest";

let forwardedFor: string | null = null;
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? forwardedFor : null),
  })),
}));

const STAFF_ROW = { id: "staff-olivia", name: "Olivia Owner", role: "admin", pinHash: "hash", active: true };
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve([STAFF_ROW]) }),
    })),
  },
}));

vi.mock("@/server/auth/pin", () => ({
  isValidPinFormat: (pin: string) => /^\d{4,6}$/.test(pin),
  verifyPin: vi.fn(async (pin: string) => pin === "1111"),
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../../../auth", () => ({
  signIn: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  mintLoginAttestation: vi.fn(() => "attest"),
}));

import { loginWithPin } from "@/server/actions/auth";
import { _resetStoreForTest } from "@/server/rate-limit";
import { verifyPin } from "@/server/auth/pin";

const PROXY_SEEN = "198.51.100.9";

beforeEach(() => {
  _resetStoreForTest();
  vi.mocked(verifyPin).mockClear();
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("loginWithPin — per-client throttle keys on the trusted hop", () => {
  it("rotating the client-supplied first X-Forwarded-For entry does not reset the counter", async () => {
    for (let i = 0; i < 5; i++) {
      forwardedFor = `203.0.113.${i}, ${PROXY_SEEN}`;
      const r = await loginWithPin("9998");
      expect(r).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." });
    }
    // A fresh spoofed value, same real (proxy-seen) address — still blocked,
    // and the correct PIN does not get in.
    forwardedFor = `203.0.113.78, ${PROXY_SEEN}`;
    const blocked = await loginWithPin("1111");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("RATE_LIMITED");
      expect(blocked.message).toMatch(/^Too many attempts\. Try again in \d+s\.$/);
    }
  });
});

describe("loginWithPin — global failed-attempt budget", () => {
  it("locks PIN login for everyone after 10 failures in 15 minutes, even with a new key per attempt", async () => {
    for (let i = 0; i < 10; i++) {
      forwardedFor = `198.51.100.${100 + i}`; // a different trusted key every time
      const r = await loginWithPin("9998");
      expect(r).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." });
    }

    forwardedFor = "198.51.100.250"; // a never-seen key
    vi.mocked(verifyPin).mockClear();
    const r = await loginWithPin("1111"); // the correct PIN
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("RATE_LIMITED");
      expect(r.message).toMatch(/^Too many attempts\. Try again in \d+s\.$/);
    }
    // No PIN comparison is attempted while locked.
    expect(verifyPin).not.toHaveBeenCalled();
  });

  it("the lockout lifts once the 15-minute window has passed", async () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date("2026-10-26T08:00:00+02:00").getTime();
      vi.setSystemTime(t0);
      for (let i = 0; i < 10; i++) {
        forwardedFor = `198.51.100.${100 + i}`;
        await loginWithPin("9998");
      }
      forwardedFor = "198.51.100.251";
      expect((await loginWithPin("1111")).ok).toBe(false);

      vi.setSystemTime(t0 + 15 * 60_000 + 1);
      forwardedFor = "198.51.100.252";
      const r = await loginWithPin("1111");
      expect(r.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("successful logins and badly formatted input do not spend the failure budget", async () => {
    for (let i = 0; i < 12; i++) {
      forwardedFor = `198.51.100.${i}`;
      expect((await loginWithPin("1111")).ok).toBe(true);
      forwardedFor = `198.51.101.${i}`;
      expect((await loginWithPin("12")).ok).toBe(false);
    }
    forwardedFor = "198.51.102.1";
    expect((await loginWithPin("1111")).ok).toBe(true);
  });
});
