// AT-207 — closeDaily()'s normative order (PRD v7.0 §6.0.5): the write-off
// sweep first and unconditionally, then the reconciliation, then the
// daily_closes record. A mismatch blocks only that record.
// REQ-007, REQ-035, REQ-036.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@db/index", () => {
  const db = { select: vi.fn(), execute: vi.fn(), transaction: vi.fn() };
  return { db };
});
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
const sendNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));
vi.mock("@/server/push/vapid", () => ({ initVapid: vi.fn() }));
vi.mock("@/server/push/payload", () => ({ isValidPushSubscription: (x: unknown) => x != null }));
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/close/write-offs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/close/write-offs")>();
  return {
    ...real,
    sweepWriteOffs: vi.fn(),
    hasDailyClose: vi.fn().mockResolvedValue(false),
    recordDailyClose: vi.fn().mockResolvedValue(undefined),
  };
});

import { db } from "@db/index";
import { writeAudit } from "@/server/audit";
import { alertAdmins } from "@/server/push/admin-alert";
import {
  hasDailyClose,
  recordDailyClose,
  setSundaySkipForTests,
  sweepWriteOffs,
  SUNDAY_ORDERS_NEVER_SWEPT_UNTIL_WEBPOS_LIVE,
  type SweepResult,
} from "@/server/close/write-offs";
import { closeDaily } from "@/server/crons/close-daily";

const DAY = new Date("2026-06-08T10:00:00Z");
const NOW = new Date("2026-06-08T22:05:00Z");
const dialect = new PgDialect();

const TWO_WRITE_OFFS: SweepResult = {
  written: [
    { orderId: "o-1", staffId: "staff-louis", valueZar: 2500, placedAt: NOW, reason: "deferred_unsettled" },
    { orderId: "o-2", staffId: "staff-nkuli", valueZar: 4500, placedAt: NOW, reason: "unresolved_at_close" },
  ],
  dayCount: 2,
  dayZar: 7000,
};
const NONE: SweepResult = { written: [], dayCount: 0, dayZar: 0 };

let revenueWhere: SQL | undefined;

/** lock, close-record check, revenue, payments — then admins only on a mismatch. */
function mockClose(o: { revenue: number; payments: number; sweep: SweepResult; admins?: unknown[] }) {
  vi.mocked(db.transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never);
  vi.mocked(db.execute).mockResolvedValueOnce([] as never); // lock
  vi.mocked(db.select).mockReturnValueOnce({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  } as never);
  vi.mocked(sweepWriteOffs).mockResolvedValueOnce(o.sweep);
  vi.mocked(db.select).mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn((w: SQL) => {
        revenueWhere = w;
        return Promise.resolve([{ total: o.revenue }]);
      }),
    }),
  } as never);
  vi.mocked(db.execute).mockResolvedValueOnce([{ total: String(o.payments) }] as never);
  if (o.admins) {
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(o.admins) }),
    } as never);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasDailyClose).mockResolvedValue(false);
  revenueWhere = undefined;
});

describe("closeDaily — write-off first, then reconcile, then daily_closes (AT-207)", () => {
  it("REQ-007: the sweep runs inside the close, before the reconciliation reads", async () => {
    mockClose({ revenue: 5000, payments: 5000, sweep: TWO_WRITE_OFFS });
    await closeDaily(DAY, { now: NOW });

    expect(sweepWriteOffs).toHaveBeenCalledWith(db, "2026-06-08", NOW);
    const sweepAt = vi.mocked(sweepWriteOffs).mock.invocationCallOrder[0];
    const revenueAt = vi.mocked(db.select).mock.invocationCallOrder[1];
    const paymentsAt = vi.mocked(db.execute).mock.invocationCallOrder[1];
    expect(sweepAt).toBeLessThan(revenueAt);
    expect(sweepAt).toBeLessThan(paymentsAt);
  });

  it("written-off orders are on neither side of the reconciliation", async () => {
    mockClose({ revenue: 5000, payments: 5000, sweep: TWO_WRITE_OFFS });
    await closeDaily(DAY, { now: NOW });

    expect(dialect.sqlToQuery(revenueWhere!).sql).toContain('"written_off_at" is null');
    const paymentsQuery = dialect.sqlToQuery(vi.mocked(db.execute).mock.calls[1][0] as SQL).sql;
    expect(paymentsQuery).toContain("o.written_off_at IS NULL");
  });

  it("writes daily_closes: the day's write-off count and value, payments_matched, closed_at, was_catch_up", async () => {
    mockClose({ revenue: 5000, payments: 5000, sweep: TWO_WRITE_OFFS });
    const res = await closeDaily(DAY, { now: NOW, wasCatchUp: true });

    expect(recordDailyClose).toHaveBeenCalledOnce();
    expect(vi.mocked(recordDailyClose).mock.calls[0]).toEqual([
      db,
      {
        revenueDay: "2026-06-08",
        writtenOffCount: 2,
        writtenOffZar: 7000,
        reconciliationStatus: "payments_matched",
        blockedReason: null,
        closedAt: NOW,
        wasCatchUp: true,
      },
    ]);
    expect(res).toMatchObject({ alreadyClosed: false, writtenOffCount: 2, writtenOffZar: 7000, reconciliationStatus: "payments_matched" });
  });

  it("REQ-036: a mismatch blocks only the close record — the write-off stands — and pushes the Admin", async () => {
    const ADMIN = { id: "a", pushSubscription: { endpoint: "https://push.example/1", keys: { p256dh: "x", auth: "y" } } };
    mockClose({ revenue: 100000, payments: 80000, sweep: TWO_WRITE_OFFS, admins: [ADMIN] });
    const res = await closeDaily(DAY, { now: NOW });

    expect(sweepWriteOffs).toHaveBeenCalledOnce();
    const row = vi.mocked(recordDailyClose).mock.calls[0][1];
    expect(row).toMatchObject({ reconciliationStatus: "blocked", writtenOffCount: 2, writtenOffZar: 7000 });
    expect(row.blockedReason).toMatch(/variance/);
    expect(res).toMatchObject({ band: "critical", reconciliationStatus: "blocked" });
    // The mismatch push (unchanged) and the write-off push both fire.
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(alertAdmins).toHaveBeenCalledOnce();
    // Ordering is unaffected: the close writes no order, payment or session —
    // the only writes are the sweep (mocked), one audit row and daily_closes.
    expect(writeAudit).toHaveBeenCalledOnce();
    expect(vi.mocked(db.execute).mock.calls.length).toBe(2); // lock + payments read
  });

  it("§6.0.5: the write-off push names the count, the value and the reasons — only when something was written off", async () => {
    mockClose({ revenue: 5000, payments: 5000, sweep: TWO_WRITE_OFFS });
    await closeDaily(DAY, { now: NOW });
    const [title, body, data] = vi.mocked(alertAdmins).mock.calls[0];
    expect(title).toContain("2026-06-08");
    expect(body).toContain("2 unpaid orders written off");
    expect(body).toMatch(/R 70[.,]00/);
    expect(body).toContain("1 deferred_unsettled");
    expect(body).toContain("1 unresolved_at_close");
    expect(data).toMatchObject({ count: 2, totalZar: 7000 });

    vi.clearAllMocks();
    mockClose({ revenue: 5000, payments: 5000, sweep: NONE });
    await closeDaily(DAY, { now: NOW });
    expect(alertAdmins).not.toHaveBeenCalled();
  });

  it("a day with a daily_closes row is closed: no sweep, no record, no push", async () => {
    vi.mocked(db.transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never);
    vi.mocked(db.execute).mockResolvedValueOnce([] as never);
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(hasDailyClose).mockResolvedValueOnce(true);

    const res = await closeDaily(DAY, { now: NOW });
    expect(res).toEqual({ date: "2026-06-08", alreadyClosed: true });
    expect(sweepWriteOffs).not.toHaveBeenCalled();
    expect(recordDailyClose).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(alertAdmins).not.toHaveBeenCalled();
  });

  it("the daily_close audit row carries the write-off totals and the reconciliation status", async () => {
    mockClose({ revenue: 5000, payments: 5000, sweep: TWO_WRITE_OFFS });
    await closeDaily(DAY, { now: NOW });
    expect(vi.mocked(writeAudit).mock.calls[0][0].after).toMatchObject({
      revenueDay: "2026-06-08",
      writtenOffCount: 2,
      writtenOffZar: 7000,
      reconciliationStatus: "payments_matched",
    });
  });
});

describe("closeDaily — Sunday card sales outside FAVO until the Web POS is live (Nikao, 3 Nov 2026)", () => {
  const SUN = new Date("2026-06-07T10:00:00Z"); // a Sunday
  const SUN_NOW = new Date("2026-06-07T22:05:00Z"); // 00:05 SAST on Monday

  /** As mockClose, plus the Sunday-outside-FAVO count after the payments read. */
  function mockSundayClose(o: { revenue: number; payments: number; outside: { n: number; zar: number }; admins?: unknown[] }) {
    mockClose({ revenue: o.revenue, payments: o.payments, sweep: NONE });
    vi.mocked(db.execute).mockResolvedValueOnce([{ n: o.outside.n, zar: String(o.outside.zar) }] as never);
    if (o.admins) {
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(o.admins) }),
      } as never);
    }
  }

  afterEach(() => setSundaySkipForTests(SUNDAY_ORDERS_NEVER_SWEPT_UNTIL_WEBPOS_LIVE));

  it("flag on: three unpaid FAVO orders (R114.00) with no FAVO payment — nothing written off, no variance, and the close names them as taken outside FAVO", async () => {
    setSundaySkipForTests(true);
    // The revenue read now holds only Sunday orders with a successful FAVO payment: none.
    mockSundayClose({ revenue: 0, payments: 0, outside: { n: 3, zar: 11400 } });
    const res = await closeDaily(SUN, { now: SUN_NOW });

    const revenueSql = dialect.sqlToQuery(revenueWhere!).sql;
    expect(revenueSql).toContain("EXISTS (SELECT 1 FROM payments sp WHERE sp.order_id = \"orders\".\"id\" AND sp.status = 'successful')");
    const outsideSql = dialect.sqlToQuery(vi.mocked(db.execute).mock.calls[2][0] as SQL).sql;
    expect(outsideSql).toContain("NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'successful')");
    expect(outsideSql).toContain("o.written_off_at IS NULL");
    expect(outsideSql).toContain("o.payment_mode IS DISTINCT FROM 'donor_fund'");
    expect(outsideSql).toContain("o.payment_mode IS DISTINCT FROM 'free'");

    expect(res).toMatchObject({ revenueZar: 0, paymentsZar: 0, variancePct: 0, band: "ok", writtenOffCount: 0, writtenOffZar: 0 });
    expect(vi.mocked(writeAudit).mock.calls[0][0].after).toMatchObject({
      revenueDay: "2026-06-07",
      revenueZar: 0,
      paymentsZar: 0,
      writtenOffCount: 0,
      writtenOffZar: 0,
      sundayCardSalesOutsideFavo: { orderCount: 3, orderZar: 11400 },
    });
    expect(vi.mocked(recordDailyClose).mock.calls[0][1]).toMatchObject({ writtenOffCount: 0, writtenOffZar: 0, blockedReason: null });
    // No phantom variance push, and no write-off push.
    expect(sendNotification).not.toHaveBeenCalled();
    expect(alertAdmins).not.toHaveBeenCalled();
  });

  it("flag on: a Sunday attempt SENT to the terminal and never resolved is not absorbed — swept as unresolved_at_close (R45.00), kept in the revenue read, left out of the outside-FAVO line", async () => {
    setSundaySkipForTests(true);
    const SENT_UNRESOLVED: SweepResult = {
      written: [{ orderId: "o-sun-unres", staffId: "staff-nkuli", valueZar: 4500, placedAt: SUN_NOW, reason: "unresolved_at_close" }],
      dayCount: 1,
      dayZar: 4500,
    };
    vi.mocked(db.transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never);
    vi.mocked(db.execute).mockResolvedValueOnce([] as never); // lock
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(sweepWriteOffs).mockResolvedValueOnce(SENT_UNRESOLVED);
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn((w: SQL) => {
          revenueWhere = w;
          return Promise.resolve([{ total: 0 }]);
        }),
      }),
    } as never);
    vi.mocked(db.execute).mockResolvedValueOnce([{ total: "0" }] as never); // payments
    vi.mocked(db.execute).mockResolvedValueOnce([{ n: 0, zar: "0" }] as never); // outside FAVO

    const res = await closeDaily(SUN, { now: SUN_NOW });

    // Revenue keeps a Sunday order whose latest attempt was sent; the outside line excludes it.
    expect(dialect.sqlToQuery(revenueWhere!).sql).toContain(
      "EXISTS (SELECT 1 FROM (SELECT la.sent_at FROM payments la WHERE la.order_id = \"orders\".\"id\" ORDER BY la.attempt DESC LIMIT 1) latest WHERE latest.sent_at IS NOT NULL)"
    );
    const outsideSql = dialect.sqlToQuery(vi.mocked(db.execute).mock.calls[2][0] as SQL).sql;
    expect(outsideSql).toContain("NOT EXISTS (\n            SELECT 1 FROM (SELECT la.sent_at FROM payments la WHERE la.order_id = o.id ORDER BY la.attempt DESC LIMIT 1) latest");
    // Written off and pushed under its own reason (S4 step 5), on neither side of the reconciliation (S2a).
    expect(res).toMatchObject({ writtenOffCount: 1, writtenOffZar: 4500 });
    expect(alertAdmins).toHaveBeenCalledOnce();
    expect(vi.mocked(alertAdmins).mock.calls[0][1]).toContain("1 unresolved_at_close");
    expect(vi.mocked(writeAudit).mock.calls[0][0].after).toMatchObject({
      sundayCardSalesOutsideFavo: { orderCount: 0, orderZar: 0 },
    });
  });

  it("flag on: a Sunday FAVO-paid order is still reconciled — R38.00 against R30.00 blocks the close", async () => {
    setSundaySkipForTests(true);
    const ADMIN = { id: "a", pushSubscription: { endpoint: "https://push.example/1", keys: { p256dh: "x", auth: "y" } } };
    mockSundayClose({ revenue: 3800, payments: 3000, outside: { n: 0, zar: 0 }, admins: [ADMIN] });
    const res = await closeDaily(SUN, { now: SUN_NOW });
    expect(res).toMatchObject({ revenueZar: 3800, paymentsZar: 3000, band: "critical", reconciliationStatus: "blocked" });
    expect(sendNotification).toHaveBeenCalledOnce();
  });

  it("flag off: the Sunday close reads every order, issues no outside-FAVO read and records no outside-FAVO line", async () => {
    setSundaySkipForTests(false);
    mockClose({ revenue: 5000, payments: 5000, sweep: TWO_WRITE_OFFS });
    await closeDaily(SUN, { now: SUN_NOW });
    expect(dialect.sqlToQuery(revenueWhere!).sql).not.toContain("payments sp");
    expect(vi.mocked(db.execute).mock.calls.length).toBe(2); // lock + payments read
    expect(vi.mocked(writeAudit).mock.calls[0][0].after).not.toHaveProperty("sundayCardSalesOutsideFavo");
  });

  it("flag on: a weekday close is unchanged — no outside-FAVO read", async () => {
    setSundaySkipForTests(true);
    mockClose({ revenue: 5000, payments: 5000, sweep: NONE });
    await closeDaily(DAY, { now: NOW });
    expect(dialect.sqlToQuery(revenueWhere!).sql).not.toContain("payments sp");
    expect(vi.mocked(db.execute).mock.calls.length).toBe(2);
  });
});

// DEC-28 (b) (owner, Mia, 11 Nov 2026): a paid event on a Thursday (or a
// Saturday social) takes its cards on the same Yoco machine while the Web POS
// is not live. The close treats those orders as it treats a Sunday's: on
// neither side of the reconciliation, and named on the close record.
describe("closeDaily — paid-event card sales outside FAVO (DEC-28 b)", () => {
  const THU = new Date("2026-06-11T10:00:00Z"); // a Thursday
  const THU_NOW = new Date("2026-06-11T22:05:00Z"); // 00:05 SAST on Friday
  const revenueFields = () => vi.mocked(db.select).mock.calls[1][0] as Record<string, SQL>;

  afterEach(() => setSundaySkipForTests(SUNDAY_ORDERS_NEVER_SWEPT_UNTIL_WEBPOS_LIVE));

  it("flag on: two R38.00 paid-event orders with no FAVO payment — no variance, named eventCardSalesOutsideFavo", async () => {
    setSundaySkipForTests(true);
    vi.mocked(db.transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never);
    vi.mocked(db.execute).mockResolvedValueOnce([] as never); // lock
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    vi.mocked(sweepWriteOffs).mockResolvedValueOnce(NONE);
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 2000, eventOutsideCount: 2, eventOutsideZar: "7600" }]),
      }),
    } as never);
    vi.mocked(db.execute).mockResolvedValueOnce([{ total: "2000" }] as never); // payments: R20.00 paid in FAVO

    const res = await closeDaily(THU, { now: THU_NOW });

    const f = revenueFields();
    expect(dialect.sqlToQuery(f.total).sql).toContain("FILTER (WHERE NOT (EXISTS (SELECT 1 FROM event_windows ew");
    expect(dialect.sqlToQuery(f.total).sql).toContain("ew.payment_posture IN ('standard', 'override')");
    expect(dialect.sqlToQuery(f.eventOutsideCount).sql).toContain("IS DISTINCT FROM 'free'");
    expect(res).toMatchObject({ revenueZar: 2000, paymentsZar: 2000, variancePct: 0, band: "ok", reconciliationStatus: "payments_matched" });
    expect(vi.mocked(writeAudit).mock.calls[0][0].after).toMatchObject({
      revenueDay: "2026-06-11",
      eventCardSalesOutsideFavo: { orderCount: 2, orderZar: 7600 },
    });
    expect(vi.mocked(writeAudit).mock.calls[0][0].after).not.toHaveProperty("sundayCardSalesOutsideFavo");
    expect(vi.mocked(db.execute).mock.calls.length).toBe(2); // lock + payments: no extra read
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("flag off (Web POS live): the weekday close reads every order and names no outside-FAVO line", async () => {
    setSundaySkipForTests(false);
    mockClose({ revenue: 5000, payments: 5000, sweep: NONE });
    await closeDaily(DAY, { now: NOW });
    expect(Object.keys(revenueFields())).toEqual(["total"]);
    expect(dialect.sqlToQuery(revenueFields().total).sql).not.toContain("event_windows");
    expect(vi.mocked(writeAudit).mock.calls[0][0].after).not.toHaveProperty("eventCardSalesOutsideFavo");
  });

  it("a Sunday keeps DEC-21's own read; no event line is added (the Sunday line already covers its events)", async () => {
    setSundaySkipForTests(true);
    mockClose({ revenue: 0, payments: 0, sweep: NONE });
    vi.mocked(db.execute).mockResolvedValueOnce([{ n: 1, zar: "3800" }] as never);
    await closeDaily(new Date("2026-06-07T10:00:00Z"), { now: new Date("2026-06-07T22:05:00Z") });
    expect(Object.keys(revenueFields())).toEqual(["total"]);
    expect(vi.mocked(writeAudit).mock.calls[0][0].after).not.toHaveProperty("eventCardSalesOutsideFavo");
  });
});
