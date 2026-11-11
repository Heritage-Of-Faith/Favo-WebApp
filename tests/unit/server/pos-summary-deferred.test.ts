// REQ-133 / PRD §7.5 Day summary row "Deferred: open · settled · written off |
// orders.settled_at / written_off_at" — getPosToday splits the day's
// yoco_deferred orders by those two timestamps. Integer cents.

import { describe, it, expect, vi } from "vitest";

vi.mock("@db/index", () => ({ db: { execute: vi.fn() } }));
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff_louis", name: "Louis", role: "barista" } }),
}));
vi.mock("@/server/cogs/compute", () => ({ todaySast: vi.fn().mockReturnValue("2026-11-08") }));

describe("getPosToday — REQ-133 deferred split", () => {
  it("open R30.00 · settled R20.00 · written off R25.00, each read from its own timestamp", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ revenue_zar: "7500" }] as never)
      .mockResolvedValueOnce([{ n: "3" }] as never)
      .mockResolvedValueOnce([{ n: "0" }] as never)
      .mockResolvedValueOnce([{
        drinks: "3", card_gross_zar: "7500", topups_settled_zar: "0", fee_sum_zar: "0", fee_unknown: "0",
        written_off_zar: "2500", comps_zar: "0", entitlement_cups: "0", walk_in_cups: "0",
        deferred_open_zar: "3000", deferred_settled_zar: "2000", deferred_written_off_zar: "2500",
      }] as never);
    const { getPosToday } = await import("@/server/actions/pos-summary");
    const r = await getPosToday();
    if (!r.ok) throw new Error(r.message);
    expect(r.data).toMatchObject({ deferredOpenZar: 3000, deferredSettledZar: 2000, deferredWrittenOffZar: 2500 });

    const sql = vi.mocked(db.execute).mock.calls[3][0] as unknown as { queryChunks: unknown[] };
    const text = sql.queryChunks
      .map((c) => (c && typeof c === "object" && "value" in c ? (c as { value: string[] }).value.join("") : ""))
      .join(" ");
    expect(text).toContain("orders.payment_mode = 'yoco_deferred'");
    expect(text).toContain("orders.settled_at IS NULL AND orders.written_off_at IS NULL");
    expect(text).toContain("orders.state <> 'cancelled' AND orders.settled_at IS NOT NULL) AS deferred_settled_zar");
    expect(text).toContain("orders.written_off_at IS NOT NULL) AS deferred_written_off_zar");
  });
});
