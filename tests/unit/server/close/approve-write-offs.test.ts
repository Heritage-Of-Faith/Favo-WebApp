// AT-207 — REQ-035: the day's write-offs report as `unapproved` until an
// Admin clears them with a PIN. One approval per revenue day (PRD §6.0.5).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@db/index", () => {
  const db = { select: vi.fn(), execute: vi.fn(), transaction: vi.fn() };
  return { db };
});
vi.mock("@/server/auth/guard", () => ({ authorize: vi.fn() }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/auth/pin", () => ({
  isValidPinFormat: (p: string) => /^\d{4,6}$/.test(p),
  verifyPin: vi.fn(async (pin: string, hash: string) => hash === `hash:${pin}`),
}));
vi.mock("@/server/close/write-offs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/close/write-offs")>();
  return { ...real, dayWriteOffStatus: vi.fn(), listUnapprovedWriteOffDays: vi.fn(), listBlockedDailyCloses: vi.fn() };
});

import { db } from "@db/index";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { dayWriteOffStatus, listBlockedDailyCloses, listUnapprovedWriteOffDays } from "@/server/close/write-offs";
import { approveDayWriteOffs, listBlockedCloses, listWriteOffApprovalQueue } from "@/server/actions/write-offs";
import { _resetStoreForTest } from "@/server/rate-limit";

const DAY = "2026-10-25";
const ADMIN = { id: "staff-admin", name: "Mia", role: "admin" as const };

function asAdmin(row: { pinHash: string; active?: boolean; role?: string } = { pinHash: "hash:2468" }) {
  vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN });
  vi.mocked(db.select).mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ active: true, role: "admin", ...row }]),
    }),
  } as never);
  vi.mocked(db.transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never);
  vi.mocked(db.execute).mockResolvedValue([] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetStoreForTest();
  vi.mocked(dayWriteOffStatus).mockResolvedValue({ count: 2, totalZar: 7000, orderIds: ["o-1", "o-2"], approved: false });
});

describe("approveDayWriteOffs — REQ-035", () => {
  it("a correct Admin PIN clears the day, audited with the Admin as actor", async () => {
    asAdmin();
    const res = await approveDayWriteOffs(DAY, "2468");

    expect(res).toEqual({ ok: true, data: { revenueDay: DAY, count: 2, totalZar: 7000 } });
    expect(writeAudit).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({
      entityKind: "daily_close",
      entityId: DAY,
      action: "write_off_approved",
      actorId: "staff-admin",
      actorRole: "admin",
      after: { revenueDay: DAY, count: 2, totalZar: 7000, orderIds: ["o-1", "o-2"] },
    });
  });

  it("a wrong PIN is refused and audited, and nothing is approved", async () => {
    asAdmin();
    const res = await approveDayWriteOffs(DAY, "1111");

    expect(res).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(writeAudit).toHaveBeenCalledOnce();
    const row = vi.mocked(writeAudit).mock.calls[0][0];
    expect(row).toMatchObject({ entityKind: "daily_close", entityId: DAY, action: "write_off_approval_refused", actorId: "staff-admin" });
    expect(JSON.stringify(row)).not.toContain("1111");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("a non-admin is refused before any PIN check or write", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." });
    const res = await approveDayWriteOffs(DAY, "2468");

    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(authorize).toHaveBeenCalledWith("admin");
    expect(db.select).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("an inactive admin row is refused even with the right PIN", async () => {
    asAdmin({ pinHash: "hash:2468", active: false });
    expect(await approveDayWriteOffs(DAY, "2468")).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
  });

  it("a day already approved is not approved twice", async () => {
    asAdmin();
    vi.mocked(dayWriteOffStatus).mockResolvedValueOnce({ count: 2, totalZar: 7000, orderIds: ["o-1", "o-2"], approved: true });
    expect(await approveDayWriteOffs(DAY, "2468")).toMatchObject({ ok: false, code: "ALREADY_APPROVED" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a day with nothing written off has nothing to approve", async () => {
    asAdmin();
    vi.mocked(dayWriteOffStatus).mockResolvedValueOnce({ count: 0, totalZar: 0, orderIds: [], approved: false });
    expect(await approveDayWriteOffs(DAY, "2468")).toMatchObject({ ok: false, code: "NOTHING_TO_APPROVE" });
  });

  it("rejects a malformed day or PIN without touching the DB", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN });
    expect(await approveDayWriteOffs("25/10/2026", "2468")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await approveDayWriteOffs(DAY, "12")).toMatchObject({ ok: false, code: "INVALID_PIN_FORMAT" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rate-limits repeated attempts per admin", async () => {
    for (let i = 0; i < 5; i++) {
      asAdmin();
      await approveDayWriteOffs(DAY, "1111");
    }
    vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN });
    expect(await approveDayWriteOffs(DAY, "2468")).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("listBlockedCloses (REQ-036)", () => {
  it("is admin only", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "x" });
    expect(await listBlockedCloses()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(listBlockedDailyCloses).not.toHaveBeenCalled();
  });

  it("returns the blocked close records", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN });
    const row = { revenueDay: DAY, blockedReason: "variance", closedAt: new Date("2026-10-25T22:05:00Z") };
    vi.mocked(listBlockedDailyCloses).mockResolvedValueOnce([row]);
    expect(await listBlockedCloses()).toEqual({ ok: true, data: [row] });
  });
});

describe("listWriteOffApprovalQueue", () => {
  it("is admin only", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "x" });
    expect(await listWriteOffApprovalQueue()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(listUnapprovedWriteOffDays).not.toHaveBeenCalled();
  });

  it("returns the unapproved days", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN });
    vi.mocked(listUnapprovedWriteOffDays).mockResolvedValueOnce([{ revenueDay: DAY, count: 0, totalZar: 0, items: [] }]);
    expect(await listWriteOffApprovalQueue()).toEqual({ ok: true, data: [{ revenueDay: DAY, count: 0, totalZar: 0, items: [] }] });
  });
});
