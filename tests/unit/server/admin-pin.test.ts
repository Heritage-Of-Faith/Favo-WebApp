// AT-209 / §9.5.3, REQ-063: the single-action admin PIN override.
//   "Admin PIN | 5 attempts | A 5-minute cooldown and an immediate Admin alert"
//   REQ-063: "no admin session exists, the barista's is not extended".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const admins = [{ id: "staff_admin", pinHash: "hash-of-9999" }];
let selectedRoleFilter = false;
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => { selectedRoleFilter = true; return admins; },
      }),
    }),
  },
}));
vi.mock("@/server/auth/pin", () => ({
  isValidPinFormat: (p: string) => /^\d{4,6}$/.test(p),
  verifyPin: async (pin: string, hash: string) => {
    verifyCalls += 1;
    await new Promise((r) => setTimeout(r, 1));
    return hash === `hash-of-${pin}`;
  },
}));
let verifyCalls = 0;
const mockAlert = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: (...a: unknown[]) => mockAlert(...a) }));

import { verifyAdminPin, _resetAdminPinForTest, ADMIN_PIN_COOLDOWN_MS } from "@/server/auth/admin-pin";

const BARISTA = { id: "staff_louis", name: "Louis" };
const T0 = 1_800_000_000_000;

beforeEach(() => {
  _resetAdminPinForTest();
  mockAlert.mockClear();
  selectedRoleFilter = false;
  verifyCalls = 0;
});

describe("verifyAdminPin", () => {
  it("a correct admin PIN returns which admin, and nothing else", async () => {
    expect(await verifyAdminPin("9999", BARISTA, T0)).toEqual({ ok: true, adminStaffId: "staff_admin" });
    expect(selectedRoleFilter).toBe(true);
  });

  it("a wrong PIN is INVALID_CREDENTIALS; a malformed one INVALID_PIN_FORMAT", async () => {
    expect(await verifyAdminPin("1234", BARISTA, T0)).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(await verifyAdminPin("12", BARISTA, T0)).toMatchObject({ ok: false, code: "INVALID_PIN_FORMAT" });
  });

  it("5 failed attempts → a 5-minute cooldown in which even the right PIN is refused, and one Admin alert", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await verifyAdminPin("1234", BARISTA, T0)).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    }
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(await verifyAdminPin("9999", BARISTA, T0 + 1000)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(ADMIN_PIN_COOLDOWN_MS).toBe(5 * 60_000);
    expect(await verifyAdminPin("9999", BARISTA, T0 + ADMIN_PIN_COOLDOWN_MS)).toEqual({ ok: true, adminStaffId: "staff_admin" });
  });

  it("10 parallel wrong guesses: at most 5 are checked, the rest are refused as cooldown, one alert", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyAdminPin("1234", BARISTA, T0)));
    const codes = results.map((r) => (r.ok ? "OK" : r.code));
    expect(codes.filter((c) => c === "INVALID_CREDENTIALS")).toHaveLength(5);
    expect(codes.filter((c) => c === "RATE_LIMITED")).toHaveLength(5);
    expect(verifyCalls).toBe(5);
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(await verifyAdminPin("9999", BARISTA, T0 + 1000)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("4 failures then the right PIN clears the count", async () => {
    for (let i = 0; i < 4; i++) await verifyAdminPin("1234", BARISTA, T0);
    expect(await verifyAdminPin("9999", BARISTA, T0)).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++) await verifyAdminPin("1234", BARISTA, T0);
    expect(await verifyAdminPin("9999", BARISTA, T0)).toMatchObject({ ok: true });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("REQ-063: the override never signs anyone in (no signIn, no session code in the module)", () => {
    const src = readFileSync(resolve(process.cwd(), "src/server/auth/admin-pin.ts"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/signIn|mintLoginAttestation|next-auth|cookies\(/);
  });
});
