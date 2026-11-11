// REQ-034 (T4): "Given a write-off with reason `unresolved_at_close` · When
// the next reconciliation runs · Then it stays an open T10 item until Yoco's
// record confirms no payment or produces one".
// Owner-safe default (review, 11 Nov 2026): a CSV's missing row NEVER closes
// the item; only an Admin's t10_confirmed_no_payment does.

import { describe, it, expect } from "vitest";
import {
  readImportSummary,
  writeOffItems,
  writeOffStatus,
  type OpenWriteOffInput,
} from "@/server/reconciliation/t10-view";
import type { ImportSummary } from "@/server/reconciliation/import";
import type { T10Exception } from "@/server/reconciliation/t10";

const W: OpenWriteOffInput = {
  orderId: "o1", revenueDay: "2026-10-25", totalZar: 4500,
  yocoPaymentIds: ["yp_1"], clientReferences: ["cu1:1"], confirmedNoPayment: false,
};

type Facts = Pick<ImportSummary, "rowKeys" | "columns" | "exceptions">;
const CLEAN: Facts = { rowKeys: ["yp_other"], columns: ["yocoPaymentId", "amount", "fee", "date", "clientReference"], exceptions: [] };
const ex = (kind: T10Exception["kind"]): T10Exception => ({ kind, line: 3, yocoPaymentId: null, paymentId: null, orderId: null, amountZar: null, detail: "x" });

describe("REQ-034: an unresolved_at_close write-off on T10", () => {
  it("open while no export for its day has been uploaded", () => {
    expect(writeOffStatus(W, null)).toBe("waiting_for_export");
  });

  it("open when Yoco's export produces its payment, by Yoco id or by client reference", () => {
    expect(writeOffStatus(W, { ...CLEAN, rowKeys: ["yp_1"] })).toBe("yoco_shows_payment");
    expect(writeOffStatus(W, { ...CLEAN, rowKeys: ["cu1:1"] })).toBe("yoco_shows_payment");
  });

  it("(a) a key missing from a clean file keeps it OPEN: 'Export has no matching row: Admin to confirm'", () => {
    expect(writeOffStatus(W, CLEAN)).toBe("export_no_match");
    const [item] = writeOffItems([W], new Map([[W.revenueDay, CLEAN]]));
    expect(item.open).toBe(true);
  });

  it("(b) it closes only after an Admin confirmation", () => {
    const [item] = writeOffItems([{ ...W, confirmedNoPayment: true }], new Map([[W.revenueDay, CLEAN]]));
    expect(item).toMatchObject({ status: "confirmed_no_payment", open: false });
    // …and a later export that produces the payment re-opens it for attaching.
    expect(writeOffStatus({ ...W, confirmedNoPayment: true }, { ...CLEAN, rowKeys: ["yp_1"] })).toBe("yoco_shows_payment");
  });

  it("(c) a file with rejected rows or other-day rows can never rule it out", () => {
    expect(writeOffStatus(W, { ...CLEAN, exceptions: [ex("malformed")] })).toBe("export_inconclusive");
    expect(writeOffStatus(W, { ...CLEAN, exceptions: [ex("other_day")] })).toBe("export_inconclusive");
    expect(writeOffItems([W], new Map([[W.revenueDay, { ...CLEAN, exceptions: [ex("malformed")] }]]))[0].open).toBe(true);
  });

  it("(d) an order with only a client reference, against a file with no reference column, is inconclusive", () => {
    const refOnly = { ...W, yocoPaymentIds: [] };
    const noRefColumn = { ...CLEAN, columns: CLEAN.columns.filter((c) => c !== "clientReference") };
    expect(writeOffStatus(refOnly, noRefColumn)).toBe("export_inconclusive");
    expect(writeOffStatus(refOnly, CLEAN)).toBe("export_no_match");
    expect(writeOffStatus(W, noRefColumn)).toBe("export_no_match"); // it holds a Yoco id, which the file can show
  });

  it("an audit row that is not an import summary reads as none, never a guess", () => {
    expect(readImportSummary(null)).toBeNull();
    expect(readImportSummary({ version: 2, revenueDay: "x", rowKeys: [], exceptions: [], columns: [] })).toBeNull();
    expect(readImportSummary({ version: 1, revenueDay: "2026-10-25", rowKeys: [], exceptions: [] })).toBeNull();
    expect(readImportSummary({ version: 1, revenueDay: "2026-10-25", rowKeys: [], exceptions: [], columns: [] })).not.toBeNull();
  });
});
