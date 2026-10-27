// QA r1-admin P1-3: a new staff member (or a PIN reset) must not take a PIN
// already held by another ACTIVE staff member — login matches by PIN alone,
// so two holders make login and audit attribution ambiguous. The refusal
// message must not reveal whose PIN it is.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashPin } from "@/server/auth/pin";

const activeRows: { id: string; name: string; pinHash: string }[] = [];

const insertValues = vi.fn().mockReturnValue({
  returning: vi.fn().mockResolvedValue([{ id: "staff_new", name: "QA Temp", role: "barista", active: true }]),
});
const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve(activeRows),
      }),
    })),
    insert: vi.fn().mockImplementation(() => ({ values: insertValues })),
    update: vi.fn().mockImplementation(() => ({ set: updateSet })),
  },
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_admin_mia", name: "Mia", role: "admin" },
  }),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  activeRows.length = 0;
  activeRows.push({ id: "staff_barista_sam", name: "Sam Barista", pinHash: await hashPin("1234") });
});

describe("createStaff — PIN already held by an active staff member", () => {
  it("refuses PIN 1234 when Sam (active) holds it, without naming Sam", async () => {
    const { createStaff } = await import("@/server/actions/staff");
    const res = await createStaff({ name: "QA Temp", role: "barista", pin: "1234" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PIN_TAKEN");
      expect(res.message).not.toMatch(/sam/i);
    }
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("accepts a PIN nobody active holds (9876)", async () => {
    const { createStaff } = await import("@/server/actions/staff");
    const res = await createStaff({ name: "QA Temp", role: "barista", pin: "9876" });
    expect(res.ok).toBe(true);
  });
});

describe("setStaffPin — PIN already held by another active staff member", () => {
  it("refuses resetting Olivia to Sam's PIN", async () => {
    activeRows.push({ id: "staff_admin_olivia", name: "Olivia", pinHash: await hashPin("1111") });
    const { setStaffPin } = await import("@/server/actions/staff");
    const res = await setStaffPin({ staffId: "staff_admin_olivia", newPin: "1234" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PIN_TAKEN");
      expect(res.message).not.toMatch(/sam/i);
    }
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("does not count the staff member's own row as 'another' holder", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    const res = await setStaffPin({ staffId: "staff_barista_sam", newPin: "1234" });
    expect(res.ok).toBe(true);
  });
});

describe("switching a staff member back on", () => {
  it("reactivateStaff alone is refused: a new PIN is required", async () => {
    const { reactivateStaff } = await import("@/server/actions/staff");
    const res = await reactivateStaff("staff_old");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PIN_REQUIRED");
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("setStaffPin with reactivate refuses a PIN another active member holds", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    const res = await setStaffPin({ staffId: "staff_old", newPin: "1234", reactivate: true });
    expect(res.ok).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
