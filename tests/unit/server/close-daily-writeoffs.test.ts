// AT-207 — closeDaily()'s normative order (PRD v7.0 §6.0.5): the write-off
// sweep first and unconditionally, then the reconciliation, then the
// daily_closes record. A mismatch blocks only that record.
// REQ-007, REQ-035, REQ-036.

import { describe, it, expect, vi, beforeEach } from "vitest";
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
import { hasDailyClose, recordDailyClose, sweepWriteOffs, type SweepResult } from "@/server/close/write-offs";
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
