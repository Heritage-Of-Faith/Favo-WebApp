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
  it("ranks barista below manager below admin below owner", () => {
    expect(roleAtLeast("manager", "barista")).toBe(true);
    expect(roleAtLeast("admin", "manager")).toBe(true);
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("barista", "manager")).toBe(false);
  });

  it("treats equal ranks as at-least", () => {
    expect(roleAtLeast("barista", "barista")).toBe(true);
    expect(roleAtLeast("roaster", "barista")).toBe(true); // same rank
  });
});

describe("rbac: capabilities", () => {
  it("admin, owner, finance can reach the admin surface", () => {
    expect(canAccessAdmin("admin")).toBe(true);
    expect(canAccessAdmin("owner")).toBe(true);
    expect(canAccessAdmin("finance")).toBe(true);
  });

  it("barista, roaster, manager cannot reach the admin surface", () => {
    expect(canAccessAdmin("barista")).toBe(false);
    expect(canAccessAdmin("roaster")).toBe(false);
    expect(canAccessAdmin("manager")).toBe(false);
  });

  it("POS is operable by barista/manager/admin/owner, not finance/roaster", () => {
    expect(canProcessOrders("barista")).toBe(true);
    expect(canProcessOrders("manager")).toBe(true);
    expect(canProcessOrders("owner")).toBe(true);
    expect(canProcessOrders("finance")).toBe(false);
    expect(canProcessOrders("roaster")).toBe(false);
  });

  it("only admin/owner can approve refunds (rule L02)", () => {
    expect(canApproveRefund("admin")).toBe(true);
    expect(canApproveRefund("owner")).toBe(true);
    expect(canApproveRefund("manager")).toBe(false);
    expect(canApproveRefund("finance")).toBe(false);
    expect(canApproveRefund("barista")).toBe(false);
  });

  it("hasRole matches an explicit allow-list", () => {
    expect(hasRole("barista", ["barista", "manager"])).toBe(true);
    expect(hasRole("owner", ["barista", "manager"])).toBe(false);
  });
});
