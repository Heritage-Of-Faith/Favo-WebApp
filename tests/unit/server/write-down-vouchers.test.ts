// REQ-145 · REQ-124 — §7.3.1's Vouchers row, per barista: a count AND a
// value (§6.9.2a: "a barista whose slips average R38 against everyone else's
// R21 shows up in the same glance"). §7.0.2: voucher_cups counts LIVE rows
// (reversed excluded) on orders that reached in_progress; the value is the
// rows' discount_zar, integer cents. Zero prints as 0, never omitted.

import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { perBaristaWithVouchers, readVoucherTallies } from "@/server/write-downs/vouchers";

const STAFF = [
  { id: "staff_louis", name: "Louis" },
  { id: "staff_thandeka", name: "Thandeka" },
  { id: "staff_nkuli", name: "Nkuli" },
];

describe("readVoucherTallies", () => {
  it("counts live rows on orders that reached in_progress (or were abandoned), bucketed by revenue_day", async () => {
    const execute = vi.fn().mockResolvedValue([{ staff_id: "staff_louis", staff_name: "Louis", cups: "4", zar: "15200" }]);
    const out = await readVoucherTallies({ execute } as never, "2026-10-19", "2026-10-25");
    expect(out).toEqual([{ staffId: "staff_louis", staffName: "Louis", count: 4, zar: 15200 }]);

    const { sql, params } = new PgDialect().sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(sql).toContain("FROM voucher_redemptions vr");
    expect(sql).toContain("vr.reversed_at IS NULL");
    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain("SUM(vr.discount_zar)");
    expect(sql).toContain("vr.redeemed_by_staff_id");
    expect(sql).toContain("o.revenue_day BETWEEN");
    expect(sql).toContain("o.state IN ('in_progress', 'ready', 'collected')");
    expect(sql).toContain("(a.after->>'abandoned') = 'true'");
    expect(params).toEqual(["2026-10-19", "2026-10-25"]);
  });
});

describe("perBaristaWithVouchers", () => {
  it("vouchers appear as a count and a value per barista; a barista with none reads 0 · 0, never omitted", () => {
    const out = perBaristaWithVouchers([], STAFF, [
      { staffId: "staff_louis", staffName: "Louis", count: 4, zar: 15200 },
      { staffId: "staff_thandeka", staffName: "Thandeka", count: 4, zar: 8400 },
    ]);
    expect(out.map((b) => [b.name, b.vouchers])).toEqual([
      ["Louis", { count: 4, zar: 15200 }],
      ["Thandeka", { count: 4, zar: 8400 }],
      ["Nkuli", { count: 0, zar: 0 }],
    ]);
    // R38 a slip against R21 — readable from the two figures, without computing it on screen.
    expect(out[0].vouchers.zar! / out[0].vouchers.count).toBe(3800);
    expect(out[1].vouchers.zar! / out[1].vouchers.count).toBe(2100);
  });

  it("keeps the AT-209 figures alongside, and adds a voucher-only barista who is no longer active", () => {
    const out = perBaristaWithVouchers(
      [{ kind: "abandoned", auditId: "a1", revenueDay: "2026-10-25", at: new Date(), staffId: "staff_louis", staffName: "Louis", onBehalfOfName: null, orderId: "o1", valueZar: null, reason: null, unapproved: false }],
      STAFF,
      [{ staffId: "staff_sam", staffName: "Sam", count: 1, zar: 2000 }]
    );
    expect(out.map((b) => b.name)).toEqual(["Louis", "Thandeka", "Nkuli", "Sam"]);
    expect(out[0]).toMatchObject({ abandoned: { count: 1 }, vouchers: { count: 0, zar: 0 } });
    expect(out[3]).toMatchObject({ comps: { count: 0, zar: 0 }, vouchers: { count: 1, zar: 2000 } });
  });
});
