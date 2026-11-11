// The T10 server actions are Admin only (§10.7) and accept only a completed
// revenue day (§9.6.2 job 6: "for the completed revenue day").

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@db/index", () => ({ db: {} }));
vi.mock("@/server/auth/guard", () => ({ authorize: vi.fn() }));
vi.mock("@/server/reconciliation/import", () => ({ importYocoTransactions: vi.fn() }));
vi.mock("@/server/reconciliation/drizzle-store", () => ({ createDrizzleImportStore: vi.fn(() => ({})) }));
vi.mock("@/server/reconciliation/read", () => ({ readT10View: vi.fn(), openUnresolvedWriteOffs: vi.fn() }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { importYocoTransactions } from "@/server/reconciliation/import";
import { openUnresolvedWriteOffs, readT10View } from "@/server/reconciliation/read";
import { confirmNoYocoPayment, getT10, uploadYocoExport } from "@/server/actions/reconciliation";

const ADMIN = { id: "staff-admin", name: "Mia", role: "admin" as const };
const CSV = "Payment ID,Amount,Fee,Date\nyp_1,20,0.53,2026-08-16\n";

beforeEach(() => vi.clearAllMocks());

describe("admin-only guard", () => {
  it("a barista is refused before anything is read or written", async () => {
    vi.mocked(authorize).mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." });
    expect(await uploadYocoExport("2026-08-16", CSV)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await getT10("2026-08-16")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await confirmNoYocoPayment("o1", "2026-10-25", "Checked the Yoco portal")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(importYocoTransactions).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(readT10View).not.toHaveBeenCalled();
    expect(vi.mocked(authorize).mock.calls.every((c) => c.length === 1 && c[0] === "admin")).toBe(true);
  });
});

describe("uploadYocoExport", () => {
  beforeEach(() => vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN }));

  it("refuses today (not a completed revenue day) and a malformed day", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
    expect(await uploadYocoExport(today, CSV)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await uploadYocoExport("16/08/2026", CSV)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await uploadYocoExport("2026-08-16", "  ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(importYocoTransactions).not.toHaveBeenCalled();
  });

  it("refuses a file over the size cap", async () => {
    expect(await uploadYocoExport("2026-08-16", "x".repeat(600 * 1024))).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(importYocoTransactions).not.toHaveBeenCalled();
  });

  it("passes the file text and the Admin's id to the import", async () => {
    vi.mocked(importYocoTransactions).mockResolvedValue({ ok: false, code: "INVALID_EXPORT", message: "nope" });
    expect(await uploadYocoExport("2026-08-16", CSV)).toEqual({ ok: false, code: "INVALID_EXPORT", message: "nope" });
    expect(vi.mocked(importYocoTransactions).mock.calls[0][1]).toMatchObject({ revenueDay: "2026-08-16", csvText: CSV, uploadedByStaffId: "staff-admin" });
  });
});

describe("confirmNoYocoPayment — REQ-034's only way to close an item", () => {
  const OPEN = {
    orderId: "o1", revenueDay: "2026-10-25", totalZar: 4500,
    yocoPaymentIds: ["yp_1"], clientReferences: ["cu1:1"], confirmedNoPayment: false,
  };
  beforeEach(() => {
    vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN });
    vi.mocked(openUnresolvedWriteOffs).mockResolvedValue([OPEN]);
  });

  it("needs a reason of at least 3 characters; nothing is written without one", async () => {
    expect(await confirmNoYocoPayment("o1", "2026-10-25", "  ok ")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("writes one audit row, action t10_confirmed_no_payment, with the Admin as actor", async () => {
    expect(await confirmNoYocoPayment("o1", "2026-10-25", " Yoco portal shows no sale ")).toEqual({ ok: true, data: { orderId: "o1" } });
    expect(writeAudit).toHaveBeenCalledOnce();
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toEqual({
      entityKind: "order",
      entityId: "o1",
      action: "t10_confirmed_no_payment",
      actorId: "staff-admin",
      actorRole: "admin",
      reason: "Yoco portal shows no sale",
      after: { revenueDay: "2026-10-25", totalZar: 4500, yocoPaymentIds: ["yp_1"] },
    });
  });

  it("refuses (and audits) an order that is not an open write-off on that day, or one already confirmed", async () => {
    expect(await confirmNoYocoPayment("o1", "2026-10-26", "checked")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    vi.mocked(openUnresolvedWriteOffs).mockResolvedValue([{ ...OPEN, confirmedNoPayment: true }]);
    expect(await confirmNoYocoPayment("o1", "2026-10-25", "checked")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(vi.mocked(writeAudit).mock.calls.map((c) => c[0].action)).toEqual([
      "t10_confirm_no_payment_refused",
      "t10_confirm_no_payment_refused",
    ]);
  });
});
