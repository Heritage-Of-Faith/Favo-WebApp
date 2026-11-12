// T10's finishing actions (PRD v7.0 §6.8.3, §7.0.4, REQ-120, DEC-17): Admin
// only (§10.7). clearTipVariance records the Admin's review before any write;
// recordYocoPayout reads rands as text into integer cents and keeps the payout
// on an audit row (entity 'yoco_payout', id = day:device), never as a payment.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@db/index", () => ({ db: {} }));
vi.mock("@/server/auth/guard", () => ({ authorize: vi.fn() }));
vi.mock("@/server/reconciliation/import", () => ({ importYocoTransactions: vi.fn() }));
vi.mock("@/server/reconciliation/drizzle-store", () => ({
  createDrizzleImportStore: vi.fn(() => ({})),
  createDrizzleTipClearStore: vi.fn(() => ({ store: "tip" })),
  settledCardPaymentsOfDay: vi.fn(),
}));
vi.mock("@/server/reconciliation/read", () => ({
  readT10View: vi.fn(),
  openUnresolvedWriteOffs: vi.fn(),
  latestImports: vi.fn(),
  readT10Config: vi.fn(),
  readPayoutLines: vi.fn(),
}));
vi.mock("@/server/reconciliation/tip-clear", () => ({ clearTipVariance: vi.fn() }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { settledCardPaymentsOfDay } from "@/server/reconciliation/drizzle-store";
import { latestImports, readPayoutLines, readT10Config } from "@/server/reconciliation/read";
import { clearTipVariance as clearTipCore } from "@/server/reconciliation/tip-clear";
import { payoutCheck, payoutLine } from "@/server/reconciliation/payout";
import { clearTipVariance, confirmPayoutVariance, recordYocoPayout } from "@/server/actions/reconciliation";

const ADMIN = { id: "staff-admin", name: "Mia", role: "admin" as const };
const DAY = "2026-08-16";

beforeEach(() => vi.clearAllMocks());

describe("admin-only guard", () => {
  it("a barista is refused before anything is read or written", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." });
    expect(await clearTipVariance("p1", DAY, "checked the slip")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await recordYocoPayout(DAY, "dev-1", "340.73")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(clearTipCore).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(settledCardPaymentsOfDay).not.toHaveBeenCalled();
    expect(vi.mocked(authorize).mock.calls.every((c) => c.length === 1 && c[0] === "admin")).toBe(true);
  });
});

describe("clearTipVariance", () => {
  beforeEach(() => vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN }));

  it("needs a reason of at least 3 characters and a real day; nothing runs without them", async () => {
    expect(await clearTipVariance("p1", DAY, " ok ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await clearTipVariance("p1", "16/08/2026", "checked")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await clearTipVariance("", DAY, "checked")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(clearTipCore).not.toHaveBeenCalled();
  });

  // CHANGED (review item 4): the action no longer reads the import itself; the
  // core reads it inside the clear's transaction, after the row lock.
  it("hands the trimmed reason and the Admin as actor to the core, and reads no import outside its transaction", async () => {
    vi.mocked(clearTipCore).mockResolvedValue({ ok: true, data: { paymentId: "p1", written: true } });
    expect(await clearTipVariance("p1", DAY, "  slip shows R5 tip ")).toEqual({ ok: true, data: { paymentId: "p1", written: true } });
    expect(vi.mocked(clearTipCore).mock.calls[0][1]).toEqual({
      paymentId: "p1", revenueDay: DAY, reason: "slip shows R5 tip", actor: { actorId: "staff-admin", actorRole: "admin" },
    });
    expect(latestImports).not.toHaveBeenCalled();
  });

  it("a refusal from the core is passed back as is", async () => {
    vi.mocked(clearTipCore).mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "x" });
    expect(await clearTipVariance("p1", DAY, "checked")).toEqual({ ok: false, code: "NOT_FOUND", message: "x" });
  });
});

describe("recordYocoPayout (REQ-120)", () => {
  const PAYS = [
    { paymentId: "a", deviceId: "dev-khumo", chargedAmountZar: 2000, feeZar: 53 },
    { paymentId: "b", deviceId: "dev-khumo", chargedAmountZar: 5000, feeZar: 132 },
  ];
  beforeEach(() => {
    vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN });
    vi.mocked(settledCardPaymentsOfDay).mockResolvedValue(PAYS);
    vi.mocked(readT10Config).mockResolvedValue({ webposDeviceId: "dev-khumo", expectedFeeRate: undefined });
  });

  it("rands typed as text become integer cents; an OK check is recorded on a yoco_payout audit row", async () => {
    const r = await recordYocoPayout(DAY, "", "R 68.15");
    expect(r).toEqual({ ok: true, data: { state: "ok", deviceId: "dev-khumo", payoutZar: 6815, expectedZar: 6815, differenceZar: 0, count: 2 } });
    expect(writeAudit).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toEqual({
      entityKind: "yoco_payout",
      entityId: "2026-08-16:dev-khumo",
      action: "yoco_payout_recorded",
      actorId: "staff-admin",
      actorRole: "admin",
      after: {
        version: 1, revenueDay: DAY, deviceId: "dev-khumo", payoutZar: 6815, enteredByStaffId: "staff-admin",
        checkAtEntry: { state: "ok", deviceId: "dev-khumo", payoutZar: 6815, expectedZar: 6815, differenceZar: 0, count: 2 },
      },
    });
  });

  it("a tip that came through is an open variance (DEC-17)", async () => {
    expect(await recordYocoPayout(DAY, "dev-khumo", "73.15")).toMatchObject({ ok: true, data: { state: "variance", differenceZar: 500 } });
  });

  it("a payment without its fee → UNAVAILABLE naming the count, and still recorded", async () => {
    vi.mocked(settledCardPaymentsOfDay).mockResolvedValue([{ ...PAYS[0], feeZar: null }, PAYS[1]]);
    expect(await recordYocoPayout(DAY, "dev-khumo", "68.15")).toMatchObject({ ok: true, data: { state: "unavailable", missingFee: 1 } });
    expect(writeAudit).toHaveBeenCalledOnce();
  });

  it("refuses an unreadable or negative amount, today, and no device at all — nothing recorded", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
    expect(await recordYocoPayout(DAY, "dev-khumo", "68.155")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await recordYocoPayout(DAY, "dev-khumo", "-68.15")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await recordYocoPayout(DAY, "dev-khumo", "abc")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await recordYocoPayout(today, "dev-khumo", "68.15")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    vi.mocked(readT10Config).mockResolvedValue({ webposDeviceId: null, expectedFeeRate: undefined });
    expect(await recordYocoPayout(DAY, " ", "68.15")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("confirmPayoutVariance (REQ-120: an Admin closes a payout variance)", () => {
  const PAYS = [
    { paymentId: "a", deviceId: "dev-khumo", chargedAmountZar: 2000, feeZar: 53 },
    { paymentId: "b", deviceId: "dev-khumo", chargedAmountZar: 5000, feeZar: 132 },
  ];
  const T0 = "2026-08-17T07:00:00.000Z";
  const lines = (check: ReturnType<typeof payoutCheck>, confirmation = null as Parameters<typeof payoutLine>[3]) => ({
    lines: [payoutLine(T0, check, 1, confirmation)], settled: PAYS, clearedTipIds: ["a"],
  });
  beforeEach(() => vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN }));

  it("barista refused; nothing read or written", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "no" });
    expect(await confirmPayoutVariance(DAY, "dev-khumo", "the slip shows a tip")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(readPayoutLines).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("needs a reason of at least 3 characters, a real day and a device", async () => {
    expect(await confirmPayoutVariance(DAY, "dev-khumo", " ok ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await confirmPayoutVariance("16/08/2026", "dev-khumo", "checked")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await confirmPayoutVariance(DAY, " ", "checked")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("audits the Admin's explanation (reason, actor, the figures — no tip figure) and so closes the line", async () => {
    vi.mocked(readPayoutLines).mockResolvedValue(lines(payoutCheck(7315, PAYS, "dev-khumo")));
    expect(await confirmPayoutVariance(DAY, "dev-khumo", "  Slip shows one tip, cleared above ")).toEqual({ ok: true, data: { deviceId: "dev-khumo" } });
    expect(writeAudit).toHaveBeenCalledOnce();
    const row = vi.mocked(writeAudit).mock.calls[0][0];
    expect(row).toEqual({
      entityKind: "yoco_payout",
      entityId: "2026-08-16:dev-khumo",
      action: "yoco_payout_variance_confirmed",
      actorId: "staff-admin",
      actorRole: "admin",
      reason: "Slip shows one tip, cleared above",
      after: { revenueDay: DAY, deviceId: "dev-khumo", payoutZar: 7315, expectedZar: 6815, differenceZar: 500 },
    });
    expect(JSON.stringify(row)).not.toMatch(/tip\w*zar/i);
  });

  it("refuses (audited) a line that is not an open variance: none entered, OK, UNAVAILABLE, already confirmed", async () => {
    vi.mocked(readPayoutLines).mockResolvedValue({ lines: [], settled: PAYS, clearedTipIds: [] });
    expect(await confirmPayoutVariance(DAY, "dev-khumo", "checked")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    vi.mocked(readPayoutLines).mockResolvedValue(lines(payoutCheck(6815, PAYS, "dev-khumo")));
    expect(await confirmPayoutVariance(DAY, "dev-khumo", "checked")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    vi.mocked(readPayoutLines).mockResolvedValue(lines(payoutCheck(7315, [{ ...PAYS[0], feeZar: null }], "dev-khumo")));
    expect(await confirmPayoutVariance(DAY, "dev-khumo", "checked")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    vi.mocked(readPayoutLines).mockResolvedValue(
      lines(payoutCheck(7315, PAYS, "dev-khumo"), { reason: "x", payoutZar: 7315, expectedZar: 6815, at: "2026-08-17T08:00:00.000Z" })
    );
    expect(await confirmPayoutVariance(DAY, "dev-khumo", "checked")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(vi.mocked(writeAudit).mock.calls.map((c) => [c[0].action, c[0].reason])).toEqual([
      ["yoco_payout_variance_confirm_refused", "no_payout_entered"],
      ["yoco_payout_variance_confirm_refused", "not_a_variance"],
      ["yoco_payout_variance_confirm_refused", "not_a_variance"],
      ["yoco_payout_variance_confirm_refused", "already_confirmed"],
    ]);
  });
});
