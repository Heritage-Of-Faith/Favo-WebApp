// The barista rota, Admin side (PRD §6.3, §10.2/§10.3 barista_shifts, §6.11.1
// COL-23, §11 access matrix: "Staff & PINs · barista rota · stock-alert
// recipients" — ✔ Admin only, ✖ Barista).
//
// listRota / addShift / removeShift are Admin-only. A shift is planned by
// date + slot; the same barista twice on one date + slot is refused; a past
// date, a non-barista and a shift whose session has opened are refused, and
// every refusal is audited (CLAUDE.md §5). The rota view covers 14 days.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuthorize = vi.fn();
vi.mock("@/server/auth/guard", () => ({ authorize: (...a: unknown[]) => mockAuthorize(...a) }));

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));

// 2026-11-11 is a Wednesday (SAST revenue day).
vi.mock("@/server/cogs/compute", () => ({ todaySast: () => "2026-11-11" }));

const selectQueue: unknown[][] = [];
const mockWhere = vi.fn();
function chain() {
  const rows = selectQueue.shift() ?? [];
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "orderBy", "limit"]) c[m] = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockImplementation((w: unknown) => { mockWhere(w); return c; });
  c.then = (resolve: (v: unknown[]) => void) => Promise.resolve(rows).then(resolve);
  return c;
}
const mockReturning = vi.fn();
const mockValues = vi.fn().mockImplementation(() => ({
  onConflictDoNothing: vi.fn().mockReturnValue({ returning: mockReturning }),
}));
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const tx = {
  select: vi.fn().mockImplementation(chain),
  insert: vi.fn().mockImplementation(() => ({ values: mockValues })),
  delete: vi.fn().mockImplementation(() => ({ where: mockDeleteWhere })),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockImplementation(chain),
    transaction: vi.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
  },
}));

import { listRota, addShift, removeShift } from "@/server/actions/rota";
import { rotaDates } from "@/lib/rota";

const ADMIN = { ok: true, session: { id: "staff_nikao", name: "Nikao", role: "admin" } };
const FORBIDDEN = { ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." };
const LOUIS = { id: "staff_louis", name: "Louis", role: "barista", active: true };

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  mockAuthorize.mockResolvedValue(ADMIN);
  mockReturning.mockResolvedValue([{ id: "bs_new" }]);
});

describe("access: Admin only (§11 matrix, barista rota ✖ for Barista)", () => {
  it("every rota action asks for the admin role and nothing else", async () => {
    mockAuthorize.mockResolvedValue(FORBIDDEN);
    expect(await listRota()).toEqual(FORBIDDEN);
    expect(await addShift({ staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1 })).toEqual(FORBIDDEN);
    expect(await removeShift("bs_1")).toEqual(FORBIDDEN);
    for (const call of mockAuthorize.mock.calls) expect(call).toEqual(["admin"]);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });
});

describe("rotaDates", () => {
  it("is today and the next 13 days, across a month end", () => {
    const d = rotaDates("2026-11-25");
    expect(d).toHaveLength(14);
    expect(d[0]).toBe("2026-11-25");
    expect(d[6]).toBe("2026-12-01");
    expect(d[13]).toBe("2026-12-08");
  });
});

describe("listRota", () => {
  it("returns the 14 days, the active baristas and the planned shifts", async () => {
    selectQueue.push([{ id: "staff_louis", name: "Louis" }, { id: "staff_nkuli", name: "Nkuli" }]);
    selectQueue.push([{
      id: "bs_1", staffId: "staff_nkuli", staffName: "Nkuli", shiftDate: "2026-11-15", slot: 2,
      sessionId: null, notifiedAt: null,
    }]);
    selectQueue.push([{ n: 1 }]); // sessions opened today (audited creates)
    const res = await listRota();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.today).toBe("2026-11-11");
    expect(res.data.openedToday).toBe(1);
    expect(res.data.dates).toHaveLength(14);
    expect(res.data.dates[13]).toBe("2026-11-24");
    expect(res.data.baristas).toEqual([{ id: "staff_louis", name: "Louis" }, { id: "staff_nkuli", name: "Nkuli" }]);
    expect(res.data.shifts).toEqual([{
      id: "bs_1", staffId: "staff_nkuli", staffName: "Nkuli", shiftDate: "2026-11-15", slot: 2,
      sessionOpened: false, notified: false,
    }]);
  });
});

describe("addShift", () => {
  it("plans a barista on a date + slot, and audits it in the same transaction", async () => {
    selectQueue.push([LOUIS]);
    const res = await addShift({ staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1 });
    expect(res).toEqual({ ok: true, data: { shiftId: "bs_new" } });
    expect(mockValues).toHaveBeenCalledWith({
      staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1, createdByStaffId: "staff_nikao",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityKind: "barista_shift", entityId: "bs_new", action: "create",
        actorId: "staff_nikao", actorRole: "admin",
        after: { staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1 },
      }),
      tx
    );
  });

  it("today is allowed for a slot whose session has not opened yet", async () => {
    selectQueue.push([LOUIS], [{ n: 1 }]); // one session opened today → slot 2 is still open to plan
    const res = await addShift({ staffId: "staff_louis", shiftDate: "2026-11-11", slot: 2 });
    expect(res.ok).toBe(true);
  });

  it("refuses today's slot whose session has already opened (the audit counter, so a deleted session still counts), audited", async () => {
    selectQueue.push([LOUIS], [{ n: 1 }]);
    const res = await addShift({ staffId: "staff_louis", shiftDate: "2026-11-11", slot: 1 });
    expect(res).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityKind: "barista_shift", action: "reject", reason: "STALE_STATE",
      after: expect.objectContaining({ why: "session_opened", shiftDate: "2026-11-11", slot: 1 }),
    }));
  });

  it.each([
    [{ staffId: "staff_louis", shiftDate: "15/11/2026", slot: 1 }],
    [{ staffId: "staff_louis", shiftDate: "2026-02-30", slot: 1 }],
    [{ staffId: "staff_louis", shiftDate: "2026-11-15", slot: 0 }],
    [{ staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1.5 }],
    [{ staffId: "", shiftDate: "2026-11-15", slot: 1 }],
  ])("refuses malformed input %j with INVALID_INPUT", async (input) => {
    const res = await addShift(input);
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("refuses a past date, audited", async () => {
    const res = await addShift({ staffId: "staff_louis", shiftDate: "2026-11-10", slot: 1 });
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityKind: "barista_shift", action: "reject", reason: "INVALID_INPUT",
      after: expect.objectContaining({ why: "past_date" }),
    }));
  });

  it("refuses someone who is not an active barista, audited", async () => {
    selectQueue.push([{ ...LOUIS, role: "admin" }]);
    const res = await addShift({ staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1 });
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "reject", after: expect.objectContaining({ why: "not_an_active_barista" }),
    }));

    vi.clearAllMocks();
    selectQueue.push([{ ...LOUIS, active: false }]);
    expect(await addShift({ staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1 }))
      .toMatchObject({ ok: false, code: "INVALID_INPUT" });

    vi.clearAllMocks();
    selectQueue.push([]);
    expect(await addShift({ staffId: "staff_nobody", shiftDate: "2026-11-15", slot: 1 }))
      .toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("the same barista twice on one date + slot is CONFLICT, audited, not a 500", async () => {
    selectQueue.push([LOUIS]);
    mockReturning.mockResolvedValue([]); // ON CONFLICT DO NOTHING → no row
    const res = await addShift({ staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1 });
    expect(res).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "reject", reason: "CONFLICT", after: expect.objectContaining({ why: "already_on_this_slot" }),
    }));
  });
});

describe("removeShift", () => {
  it("removes a planned shift and audits it", async () => {
    selectQueue.push([{ id: "bs_1", staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1, sessionId: null }]);
    const res = await removeShift("bs_1");
    expect(res).toEqual({ ok: true, data: undefined });
    expect(mockDeleteWhere).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityKind: "barista_shift", entityId: "bs_1", action: "delete",
        before: { staffId: "staff_louis", shiftDate: "2026-11-15", slot: 1 }, after: null,
      }),
      tx
    );
  });

  it("is NOT_FOUND for an unknown shift", async () => {
    selectQueue.push([]);
    const res = await removeShift("bs_zzz");
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("refuses a shift whose session has opened (it is the record of who was on), audited", async () => {
    selectQueue.push([{ id: "bs_1", staffId: "staff_louis", shiftDate: "2026-11-11", slot: 1, sessionId: "os_1" }]);
    const res = await removeShift("bs_1");
    expect(res).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(tx.delete).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "bs_1", action: "reject", after: expect.objectContaining({ why: "session_opened" }),
    }));
  });
});
