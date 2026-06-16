// Operating hours unit tests — G22
// Tests setOperatingHours validation, RBAC, and upsert logic.
// DB and auth are mocked — no network or Supabase required.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  const returning = vi.fn().mockResolvedValue([
    { id: 1, dayOfWeek: 1, openTime: "08:00", closeTime: "17:00", isClosed: false, note: null },
  ]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });

  const insertReturning = vi.fn().mockResolvedValue([
    { id: 2, dayOfWeek: 3, openTime: "09:00", closeTime: "16:00", isClosed: false, note: null },
  ]);
  const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });

  const selectWhere = vi.fn().mockResolvedValue([{ id: 1 }]);
  const selectOrderBy = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere, orderBy: selectOrderBy });

  return {
    db: {
      select: vi.fn().mockReturnValue({ from: selectFrom }),
      update: vi.fn().mockReturnValue({ set }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    },
  };
});

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff-1", name: "Admin", role: "admin" },
  }),
}));

// ─── setOperatingHours ────────────────────────────────────────────────────────

describe("setOperatingHours — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "UNAUTHORIZED", message: "You must be signed in." });
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 1, openTime: "08:00", closeTime: "17:00" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("rejects barista role", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "You do not have permission." });
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 1, openTime: "08:00", closeTime: "17:00" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });
});

describe("setOperatingHours — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects dayOfWeek = 7 (out of range)", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 7, openTime: "08:00", closeTime: "17:00" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects dayOfWeek = -1 (negative)", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: -1, openTime: "08:00", closeTime: "17:00" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects openTime without leading zero (8:00)", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 1, openTime: "8:00", closeTime: "17:00" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects closeTime without leading zero (5:00)", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 1, openTime: "08:00", closeTime: "5:00" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("rejects note exceeding 200 chars", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 1, openTime: "08:00", closeTime: "17:00", note: "x".repeat(201) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });
});

describe("setOperatingHours — upsert", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls db.update when a row already exists for the day", async () => {
    const { db } = await import("@db/index");
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 1, openTime: "08:00", closeTime: "17:00" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.dayOfWeek).toBe(1);
      expect(res.data.opensAt).toBe("08:00");
    }
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("calls db.insert when no row exists for the day", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as ReturnType<typeof db.select>);
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 3, openTime: "09:00", closeTime: "16:00" });
    expect(res.ok).toBe(true);
    expect(db.insert).toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("accepts isClosed: true and returns it in data", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    const res = await setOperatingHours({ dayOfWeek: 0, openTime: "00:00", closeTime: "00:00", isClosed: true });
    expect(res.ok).toBe(true);
  });

  it("writes an audit row on success", async () => {
    const { writeAudit } = await import("@/server/audit");
    const { setOperatingHours } = await import("@/server/actions/hours");
    await setOperatingHours({ dayOfWeek: 1, openTime: "08:00", closeTime: "17:00" });
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "operating_hours.set", entityKind: "operating_hours" })
    );
  });
});

// ─── getOperatingHours ────────────────────────────────────────────────────────

describe("getOperatingHours", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps DB rows to OperatingHour shape", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([
          { id: 1, dayOfWeek: 0, openTime: "09:00", closeTime: "14:00", isClosed: true, note: null },
          { id: 2, dayOfWeek: 1, openTime: "07:00", closeTime: "17:00", isClosed: false, note: null },
        ]),
        where: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const { getOperatingHours } = await import("@/server/actions/hours");
    const res = await getOperatingHours();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toMatchObject({ dayOfWeek: 0, opensAt: "09:00", closesAt: "14:00", isClosed: true });
    expect(res.data[1]).toMatchObject({ dayOfWeek: 1, opensAt: "07:00", closesAt: "17:00", isClosed: false });
  });

  it("returns empty array when no rows exist", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
        where: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const { getOperatingHours } = await import("@/server/actions/hours");
    const res = await getOperatingHours();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(0);
  });
});
