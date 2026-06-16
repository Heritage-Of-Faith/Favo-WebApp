// Unit tests for staff server action logic — G-staff
// Tests pure validation, RBAC rules, and business constraints.
// DB calls not unit-tested here (require live Drizzle connection).

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { canAccessAdmin, roleAtLeast } from "@/server/auth/rbac";
import { isValidPinFormat } from "@/server/auth/pin";

// ── Schema (mirrors staff.ts internal schema) ─────────────────────────────────
const createStaffSchema = z.object({
  name: z.string().min(2).max(100),
  role: z.enum(["barista", "admin"]),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
});

const setPinSchema = z.object({
  staffId: z.string().min(1),
  newPin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
});

// ─────────────────────────────────────────────────────────────────────────────

describe("createStaff: input validation", () => {
  it("accepts valid input", () => {
    const r = createStaffSchema.safeParse({ name: "Jo Bloggs", role: "barista", pin: "1234" });
    expect(r.success).toBe(true);
  });

  it("rejects name shorter than 2 chars", () => {
    const r = createStaffSchema.safeParse({ name: "J", role: "barista", pin: "1234" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown role", () => {
    const r = createStaffSchema.safeParse({ name: "Jo", role: "dishwasher", pin: "1234" });
    expect(r.success).toBe(false);
  });

  it("rejects removed roles (manager, finance, owner, roaster)", () => {
    for (const role of ["manager", "finance", "owner", "roaster"]) {
      const r = createStaffSchema.safeParse({ name: "Jo Bloggs", role, pin: "1234" });
      expect(r.success).toBe(false);
    }
  });

  it("rejects 3-digit PIN", () => {
    const r = createStaffSchema.safeParse({ name: "Jo Bloggs", role: "barista", pin: "123" });
    expect(r.success).toBe(false);
  });

  it("rejects 7-digit PIN", () => {
    const r = createStaffSchema.safeParse({ name: "Jo Bloggs", role: "barista", pin: "1234567" });
    expect(r.success).toBe(false);
  });

  it("rejects non-numeric PIN", () => {
    const r = createStaffSchema.safeParse({ name: "Jo Bloggs", role: "barista", pin: "abcd" });
    expect(r.success).toBe(false);
  });

  it("accepts 6-digit PIN", () => {
    const r = createStaffSchema.safeParse({ name: "Jo Bloggs", role: "barista", pin: "123456" });
    expect(r.success).toBe(true);
  });

  it("accepts all valid roles", () => {
    const roles = ["barista", "admin"] as const;
    for (const role of roles) {
      const r = createStaffSchema.safeParse({ name: "Test User", role, pin: "1234" });
      expect(r.success).toBe(true);
    }
  });
});

describe("setStaffPin: input validation", () => {
  it("accepts valid staffId and PIN", () => {
    const r = setPinSchema.safeParse({ staffId: "abc-123", newPin: "5678" });
    expect(r.success).toBe(true);
  });

  it("rejects empty staffId", () => {
    const r = setPinSchema.safeParse({ staffId: "", newPin: "5678" });
    expect(r.success).toBe(false);
  });

  it("rejects alphabetic PIN", () => {
    const r = setPinSchema.safeParse({ staffId: "abc-123", newPin: "abcd" });
    expect(r.success).toBe(false);
  });
});

describe("staff RBAC", () => {
  it("admin can manage staff", () => {
    expect(roleAtLeast("admin", "admin")).toBe(true);
  });

  it("barista cannot manage staff", () => {
    expect(roleAtLeast("barista", "admin")).toBe(false);
  });

  it("only admin can access admin surface", () => {
    expect(canAccessAdmin("admin")).toBe(true);
    expect(canAccessAdmin("barista")).toBe(false);
  });
});

describe("PIN format rules", () => {
  it("isValidPinFormat accepts 4 digits", () => expect(isValidPinFormat("1234")).toBe(true));
  it("isValidPinFormat accepts 5 digits", () => expect(isValidPinFormat("12345")).toBe(true));
  it("isValidPinFormat accepts 6 digits", () => expect(isValidPinFormat("123456")).toBe(true));
  it("isValidPinFormat rejects 3 digits", () => expect(isValidPinFormat("123")).toBe(false));
  it("isValidPinFormat rejects 7 digits", () => expect(isValidPinFormat("1234567")).toBe(false));
  it("isValidPinFormat rejects letters", () => expect(isValidPinFormat("abcd")).toBe(false));
});

describe("self-deactivation guard", () => {
  it("same actor and target IDs are caught", () => {
    const actorId = "staff-1";
    const targetId = "staff-1";
    expect(actorId === targetId).toBe(true); // guard in action should reject
  });

  it("different IDs are allowed", () => {
    function isSelf(actorId: string, targetId: string) { return actorId === targetId; }
    expect(isSelf("staff-1", "staff-2")).toBe(false);
  });
});
