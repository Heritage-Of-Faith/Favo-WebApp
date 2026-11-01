// AT-207 — the close's write-off sweep and the one definition of "unpaid".
// Spec: PRD v7.0 §6.0.5 T4, S3a, S4 step 5, L47; REQ-007, REQ-035, REQ-166.
//
// The SQL is exercised against real Postgres in tests/db/0048-up-down.test.ts.
// Here a fake client stands in for it: it answers the facts read with rows
// and applies the UPDATE's own guard (written_off_at IS NULL), so the sweep's
// decisions — what is written off, under which reason, with which actor, and
// that a re-run writes nothing — are asserted without a database.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

import { writeAudit } from "@/server/audit";
import {
  WEEKDAY_ORDERS_NEVER_SWEPT_UNTIL_S7A,
  WRITE_OFF_REASONS,
  buildWriteOffAlert,
  isSettled,
  isUnpaid,
  listBlockedDailyCloses,
  listUnpaidOrders,
  sweepWriteOffs,
  writeOffReason,
  type OrderSettlementFacts,
} from "@/server/close/write-offs";
import type { DB } from "@/lib/db";

const DAY = "2026-10-25"; // a Sunday — every card order pays
const NOW = new Date("2026-10-25T22:05:00.000Z"); // 00:05 SAST on the 26th

type FakeOrder = {
  id: string;
  staff_id: string;
  total_zar: number;
  state: string;
  payment_mode: string | null;
  written_off_at: string | null;
  has_successful_payment?: boolean;
  has_fund_spend?: boolean;
  latest_status?: string | null;
  latest_sent?: boolean | null;
};

const dialect = new PgDialect();

/** A fake DB answering only the statements the write-off module issues. */
function fakeClient(orders: FakeOrder[], revenueDay: string = DAY) {
  const statements: string[] = [];
  const execute = vi.fn(async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    statements.push(text);
    if (text.includes("LEFT JOIN LATERAL") && text.includes("has_fund_spend")) {
      return orders
        .filter((o) => o.state !== "cancelled" && o.written_off_at === null)
        .map((o) => ({
          id: o.id,
          staff_id: o.staff_id,
          total_zar: o.total_zar,
          placed_at: "2026-10-25T08:00:00.000Z",
          revenue_day: revenueDay,
          state: o.state,
          payment_mode: o.payment_mode,
          written_off: false,
          has_successful_payment: o.has_successful_payment ?? false,
          has_fund_spend: o.has_fund_spend ?? false,
          latest_status: o.latest_status ?? null,
          latest_sent: o.latest_sent ?? null,
        }));
    }
    if (text.startsWith("\n      UPDATE orders SET written_off_at") || text.includes("UPDATE orders SET written_off_at")) {
      const id = params[1] as string;
      const o = orders.find((x) => x.id === id);
      if (!o || o.written_off_at !== null) return [];
      o.written_off_at = params[0] as string;
      return [{ id }];
    }
    if (text.includes("COUNT(*)")) {
      const off = orders.filter((o) => o.written_off_at !== null);
      return [{ n: off.length, zar: off.reduce((s, o) => s + o.total_zar, 0) }];
    }
    throw new Error(`unexpected statement: ${text}`);
  });
  return { client: { execute } as unknown as DB, statements, orders };
}

const order = (o: Partial<FakeOrder> & { id: string }): FakeOrder => ({
  staff_id: "staff-louis",
  total_zar: 2500,
  state: "collected",
  payment_mode: "yoco",
  written_off_at: null,
  ...o,
});

const facts = (o: Partial<OrderSettlementFacts>): OrderSettlementFacts => ({
  id: "o1",
  staffId: "staff-louis",
  totalZar: 2500,
  placedAt: new Date("2026-10-25T08:00:00Z"),
  revenueDay: DAY,
  state: "collected",
  paymentMode: "yoco",
  writtenOff: false,
  hasSuccessfulPayment: false,
  hasFundSpend: false,
  latestAttempt: null,
  ...o,
});

beforeEach(() => vi.clearAllMocks());

// ─── The one definition of unpaid ─────────────────────────────────────────────

describe("isSettled / isUnpaid — S3a and L47 (REQ-007, REQ-166)", () => {
  it("an order with no successful payment and an amount owed is unpaid", () => {
    expect(isUnpaid(facts({}))).toBe(true);
    expect(isUnpaid(facts({ paymentMode: "yoco_deferred" }))).toBe(true);
    expect(isUnpaid(facts({ paymentMode: null }))).toBe(true);
  });

  it("a successful payment settles it", () => {
    expect(isSettled(facts({ hasSuccessfulPayment: true }))).toBe(true);
    expect(isUnpaid(facts({ hasSuccessfulPayment: true }))).toBe(false);
  });

  it("REQ-166: a fund-paid order is settled — by payment_mode donor_fund, and by a spend entry alone", () => {
    expect(isUnpaid(facts({ paymentMode: "donor_fund" }))).toBe(false);
    expect(isUnpaid(facts({ paymentMode: "yoco", hasFundSpend: true }))).toBe(false);
  });

  it("S3a: a `free` order is never unpaid, whatever it totals", () => {
    expect(isUnpaid(facts({ paymentMode: "free", totalZar: 2000 }))).toBe(false);
  });

  it("a cancelled order, an R0 order and an already written-off order are not unpaid", () => {
    expect(isUnpaid(facts({ state: "cancelled" }))).toBe(false);
    expect(isUnpaid(facts({ totalZar: 0 }))).toBe(false);
    expect(isUnpaid(facts({ writtenOff: true }))).toBe(false);
  });
});

describe("writeOffReason — S3a's distinguishing reasons", () => {
  it("S4 step 5: a sent attempt still unresolved is `unresolved_at_close`", () => {
    expect(writeOffReason(facts({ latestAttempt: { status: "unresolved", sent: true } }))).toBe("unresolved_at_close");
    expect(writeOffReason(facts({ latestAttempt: { status: "pending", sent: true } }))).toBe("unresolved_at_close");
  });

  it("…and that wins over a deferred mode: the terminal may hold the money", () => {
    expect(
      writeOffReason(facts({ paymentMode: "yoco_deferred", latestAttempt: { status: "unresolved", sent: true } }))
    ).toBe("unresolved_at_close");
  });

  it("a declined, never re-tendered order is `declined_not_retendered`", () => {
    expect(writeOffReason(facts({ latestAttempt: { status: "declined", sent: true } }))).toBe("declined_not_retendered");
  });

  it("a deferred order, or a yoco order with nothing sent, is `deferred_unsettled`", () => {
    expect(writeOffReason(facts({ paymentMode: "yoco_deferred" }))).toBe("deferred_unsettled");
    expect(writeOffReason(facts({ paymentMode: "yoco", latestAttempt: null }))).toBe("deferred_unsettled");
    // A closed-out, never-sent attempt (unresolved with nothing sent).
    expect(writeOffReason(facts({ latestAttempt: { status: "unresolved", sent: false } }))).toBe("deferred_unsettled");
  });

  it("the names live in one constant", () => {
    expect(Object.values(WRITE_OFF_REASONS).sort()).toEqual(
      ["declined_not_retendered", "deferred_unsettled", "unresolved_at_close"]
    );
  });
});

// ─── The sweep ────────────────────────────────────────────────────────────────

describe("sweepWriteOffs — REQ-007 / REQ-035 / REQ-166", () => {
  function day() {
    return fakeClient([
      order({ id: "o-yoco-declined", total_zar: 2500, state: "ordered", latest_status: "declined", latest_sent: true }),
      order({ id: "o-deferred", total_zar: 3000, payment_mode: "yoco_deferred", staff_id: "staff-thandeka" }),
      order({ id: "o-unresolved", total_zar: 4500, latest_status: "unresolved", latest_sent: true, staff_id: "staff-nkuli" }),
      order({ id: "o-paid", total_zar: 2500, has_successful_payment: true, latest_status: "successful", latest_sent: true }),
      order({ id: "o-free", total_zar: 2000, payment_mode: "free" }),
      order({ id: "o-cancelled", total_zar: 2500, state: "cancelled" }),
      order({ id: "o-fund-mode", total_zar: 2500, payment_mode: "donor_fund", has_fund_spend: true }),
      order({ id: "o-fund-spend-only", total_zar: 2500, payment_mode: "yoco", has_fund_spend: true }),
      order({ id: "o-r0", total_zar: 0 }),
    ]);
  }

  it("writes off exactly the unpaid yoco, deferred and unresolved orders — never free, cancelled, fund-settled, paid or R0", async () => {
    const f = day();
    const res = await sweepWriteOffs(f.client, DAY, NOW);

    expect(res.written.map((w) => w.orderId).sort()).toEqual(["o-deferred", "o-unresolved", "o-yoco-declined"]);
    const off = f.orders.filter((o) => o.written_off_at !== null).map((o) => o.id).sort();
    expect(off).toEqual(["o-deferred", "o-unresolved", "o-yoco-declined"]);
    // Integer cents: R25.00 + R30.00 + R45.00 = R100.00.
    expect(res.dayCount).toBe(3);
    expect(res.dayZar).toBe(10000);
    expect(f.orders.find((o) => o.id === "o-deferred")!.written_off_at).toBe(NOW.toISOString());
  });

  it("each write-off is audited: actor = the barista who took the order, actor role 'system', a reason", async () => {
    const f = day();
    await sweepWriteOffs(f.client, DAY, NOW);

    const rows = vi.mocked(writeAudit).mock.calls.map((c) => c[0]);
    expect(rows).toHaveLength(3);
    const byId = Object.fromEntries(rows.map((r) => [r.entityId, r]));
    expect(byId["o-yoco-declined"]).toMatchObject({ entityKind: "order", action: "write_off", actorId: "staff-louis", actorRole: "system", reason: "declined_not_retendered" });
    expect(byId["o-deferred"]).toMatchObject({ actorId: "staff-thandeka", actorRole: "system", reason: "deferred_unsettled" });
    expect(byId["o-unresolved"]).toMatchObject({ actorId: "staff-nkuli", actorRole: "system", reason: "unresolved_at_close" });
    expect(byId["o-unresolved"].after).toMatchObject({ revenueDay: DAY, valueZar: 4500 });
    // Every audit write joins the sweep's transaction.
    for (const c of vi.mocked(writeAudit).mock.calls) expect(c[1]).toBe(f.client);
  });

  it("is idempotent: a re-run writes nothing, audits nothing, and the day's totals do not move", async () => {
    const f = day();
    await sweepWriteOffs(f.client, DAY, NOW);
    vi.mocked(writeAudit).mockClear();

    const again = await sweepWriteOffs(f.client, DAY, new Date("2026-10-26T04:00:00Z"));
    expect(again.written).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(again.dayCount).toBe(3);
    expect(again.dayZar).toBe(10000);
    expect(f.orders.find((o) => o.id === "o-deferred")!.written_off_at).toBe(NOW.toISOString());
  });

  it("locks the day's orders FOR UPDATE and never touches payments", async () => {
    const f = day();
    await sweepWriteOffs(f.client, DAY, NOW);
    expect(f.statements[0]).toContain("FOR UPDATE OF o");
    for (const s of f.statements) expect(s).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+payments/i);
  });

  it("the unpaid-orders read and the sweep agree on the same day", async () => {
    const listed = (await listUnpaidOrders(day().client, { revenueDay: DAY })).map((o) => o.id).sort();
    const swept = (await sweepWriteOffs(day().client, DAY, NOW)).written.map((w) => w.orderId).sort();
    expect(listed).toEqual(swept);
  });

  it("REQ-166: ten fund-paid orders → zero write-offs and an empty unpaid list", async () => {
    const funded = () =>
      fakeClient(
        Array.from({ length: 10 }, (_, i) =>
          order({ id: `o-fund-${i}`, payment_mode: "donor_fund", has_fund_spend: true })
        )
      );
    expect(await listUnpaidOrders(funded().client)).toEqual([]);
    const res = await sweepWriteOffs(funded().client, DAY, NOW);
    expect(res.written).toEqual([]);
    expect(res.dayCount).toBe(0);
  });
});

describe("weekday fail-safe until S7a (L19, S3a)", () => {
  const FRI = "2026-10-23";
  const SAT = "2026-10-24";
  const SUN = "2026-10-25";
  const MON = "2026-10-26";
  // Two weekday cups, one free: R20.00 owed by the model, payment_mode NULL, no payment.
  const twoCups = () => order({ id: "o-two-cups", total_zar: 2000, payment_mode: null });

  it("the switch is on and lives in one exported constant", () => {
    expect(WEEKDAY_ORDERS_NEVER_SWEPT_UNTIL_S7A).toBe(true);
  });

  it("a weekday R20 order with no payment is neither listed nor written off (Monday and Friday)", async () => {
    for (const day of [MON, FRI]) {
      expect(isUnpaid(facts({ revenueDay: day, totalZar: 2000, paymentMode: null }))).toBe(false);
      expect(await listUnpaidOrders(fakeClient([twoCups()], day).client, { revenueDay: day })).toEqual([]);
      const f = fakeClient([twoCups()], day);
      const res = await sweepWriteOffs(f.client, day, NOW);
      expect(res.written).toEqual([]);
      expect(f.orders[0].written_off_at).toBeNull();
    }
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("the same order on a Sunday or a Saturday IS listed and written off", async () => {
    for (const day of [SUN, SAT]) {
      expect(isUnpaid(facts({ revenueDay: day, totalZar: 2000, paymentMode: null }))).toBe(true);
      expect((await listUnpaidOrders(fakeClient([twoCups()], day).client, { revenueDay: day })).map((o) => o.id)).toEqual(["o-two-cups"]);
      const res = await sweepWriteOffs(fakeClient([twoCups()], day).client, day, NOW);
      expect(res.written.map((w) => w.orderId)).toEqual(["o-two-cups"]);
    }
  });

  it("boundaries: Friday excluded / Saturday swept; Sunday swept / Monday excluded", () => {
    const owed = (day: string) => isUnpaid(facts({ revenueDay: day, totalZar: 2000, paymentMode: null }));
    expect([owed(FRI), owed(SAT)]).toEqual([false, true]);
    expect([owed(SUN), owed(MON)]).toEqual([true, false]);
  });
});

describe("listBlockedDailyCloses — REQ-036's in-app alert", () => {
  it("reads only blocked rows and maps them", async () => {
    const execute = vi.fn(async () => [
      { revenue_day: DAY, blocked_reason: "variance", closed_at: "2026-10-25T22:05:00+00:00" },
    ]);
    const rows = await listBlockedDailyCloses({ execute } as unknown as DB);
    expect(rows).toEqual([{ revenueDay: DAY, blockedReason: "variance", closedAt: new Date("2026-10-25T22:05:00Z") }]);
    const text = dialect.sqlToQuery((execute.mock.calls[0] as unknown as [SQL])[0]).sql;
    expect(text).toContain("FROM daily_closes");
    expect(text).toContain("reconciliation_status = 'blocked'");
  });
});

describe("buildWriteOffAlert — §6.0.5's 00:05 push", () => {
  it("names the count, the value and the reason for each", () => {
    const a = buildWriteOffAlert(DAY, [
      { orderId: "a", staffId: "s1", valueZar: 2500, placedAt: NOW, reason: "deferred_unsettled" },
      { orderId: "b", staffId: "s1", valueZar: 3000, placedAt: NOW, reason: "deferred_unsettled" },
      { orderId: "c", staffId: "s2", valueZar: 4500, placedAt: NOW, reason: "unresolved_at_close" },
    ]);
    expect(a.title).toContain(DAY);
    expect(a.body).toContain("3 unpaid orders written off");
    // formatZarField uses the en-ZA locale, whose decimal mark is ICU-dependent.
    expect(a.body).toMatch(/R 100[.,]00/);
    expect(a.body).toContain("2 deferred_unsettled");
    expect(a.body).toContain("1 unresolved_at_close");
    expect(a.data).toMatchObject({ count: 3, totalZar: 10000 });
    expect((a.data.items as Array<{ reason: string }>).map((i) => i.reason)).toEqual([
      "deferred_unsettled",
      "deferred_unsettled",
      "unresolved_at_close",
    ]);
  });
});
