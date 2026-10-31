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

const execute = vi.fn().mockResolvedValue(undefined);

vi.mock("@db/index", () => {
  const db: Record<string, unknown> = {
    select: vi.fn().mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve(activeRows),
      }),
    })),
    insert: vi.fn().mockImplementation(() => ({ values: insertValues })),
    update: vi.fn().mockImplementation(() => ({ set: updateSet })),
    execute: (...a: unknown[]) => execute(...a),
  };
  db.transaction = async (cb: (tx: unknown) => Promise<unknown>) => cb(db);
  return { db };
});

const writeAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));
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

  // QA R2-6: reactivation refuses the member's OWN old PIN, with the generic wording.
  it("reactivate refuses the member's own old PIN, without saying why", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    // The mocked lookup returns Sam's row (PIN 1234) as the member being reactivated.
    const res = await setStaffPin({ staffId: "staff_barista_sam", newPin: "1234", reactivate: true });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PIN_REUSED");
      expect(res.message).toBe("That PIN can't be used. Choose a different PIN.");
    }
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("reactivate with a new PIN switches the member on", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    const res = await setStaffPin({ staffId: "staff_barista_sam", newPin: "5555", reactivate: true });
    expect(res.ok).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it("refusals are audited, with no PIN material in the row", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    await setStaffPin({ staffId: "staff_barista_sam", newPin: "1234", reactivate: true });
    activeRows.push({ id: "staff_admin_olivia", name: "Olivia", pinHash: await hashPin("1111") });
    await setStaffPin({ staffId: "staff_admin_olivia", newPin: "1234" }); // Sam's PIN
    const rows = writeAudit.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(rows[0]).toMatchObject({ entityId: "staff_barista_sam", action: "reactivate_refused", reason: "PIN_REUSED" });
    expect(rows[1]).toMatchObject({ entityId: "staff_admin_olivia", action: "set_pin_refused", reason: "PIN_TAKEN" });
    expect(JSON.stringify(rows)).not.toMatch(/1234|1111|pinHash|\$2[aby]\$/);
  });

  it("reactivate on an already-active member is refused with ALREADY_ACTIVE", async () => {
    activeRows[0] = { ...activeRows[0]!, active: true } as (typeof activeRows)[number];
    const { setStaffPin } = await import("@/server/actions/staff");
    const res = await setStaffPin({ staffId: "staff_barista_sam", newPin: "5555", reactivate: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ALREADY_ACTIVE");
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("takes the PIN-write advisory lock before checking uniqueness", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    await setStaffPin({ staffId: "staff_barista_sam", newPin: "5555" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  // QA R2-5: a plain PIN reset never changes active.
  it("plain reset PIN does not touch active", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    const res = await setStaffPin({ staffId: "staff_barista_sam", newPin: "5555" });
    expect(res.ok).toBe(true);
    const arg = updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("active");
  });
});
