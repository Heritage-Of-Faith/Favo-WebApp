import { describe, it, expect } from "vitest";
import { isValidPinFormat, hashPin, verifyPin } from "@/server/auth/pin";
import {
  roleAtLeast,
  hasRole,
  canAccessAdmin,
  canProcessOrders,
  canApproveRefund,
} from "@/server/auth/rbac";

describe("pin: format", () => {
  it("accepts 4–6 digit PINs", () => {
    expect(isValidPinFormat("1234")).toBe(true);
    expect(isValidPinFormat("12345")).toBe(true);
    expect(isValidPinFormat("123456")).toBe(true);
  });

  it("rejects too-short, too-long, and non-numeric PINs", () => {
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("1234567")).toBe(false);
    expect(isValidPinFormat("12a4")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
    expect(isValidPinFormat(" 1234")).toBe(false);
  });
});

describe("pin: hashing", () => {
  it("hash is not the plain PIN and verifies correctly", async () => {
    const hash = await hashPin("1234");
    expect(hash).not.toBe("1234");
    expect(await verifyPin("1234", hash)).toBe(true);
  });

  it("rejects a wrong PIN against a real hash", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPin("0000", hash)).toBe(false);
  });

  it("produces distinct salted hashes for the same PIN", async () => {
    const a = await hashPin("4321");
    const b = await hashPin("4321");
    expect(a).not.toBe(b);
    expect(await verifyPin("4321", a)).toBe(true);
    expect(await verifyPin("4321", b)).toBe(true);
  });
});

describe("rbac: hierarchy", () => {
  it("barista ranks below admin", () => {
    expect(roleAtLeast("admin", "barista")).toBe(true);
    expect(roleAtLeast("barista", "admin")).toBe(false);
  });

  it("treats equal ranks as at-least", () => {
    expect(roleAtLeast("barista", "barista")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
  });
});

describe("rbac: capabilities", () => {
  it("only admin can reach the admin surface", () => {
    expect(canAccessAdmin("admin")).toBe(true);
    expect(canAccessAdmin("barista")).toBe(false);
  });

  it("POS is operable by both barista and admin", () => {
    expect(canProcessOrders("barista")).toBe(true);
    expect(canProcessOrders("admin")).toBe(true);
  });

  it("only admin can approve refunds (rule L02)", () => {
    expect(canApproveRefund("admin")).toBe(true);
    expect(canApproveRefund("barista")).toBe(false);
  });

  it("hasRole matches an explicit allow-list", () => {
    expect(hasRole("barista", ["barista", "admin"])).toBe(true);
    expect(hasRole("barista", ["admin"])).toBe(false);
  });
});
