// closeDaily unit tests — G10
// Tests pure helpers (dayBounds, varianceBand) without DB or network.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dayBounds, varianceBand } from "@/server/crons/close-daily";

// ─── varianceBand ─────────────────────────────────────────────────────────────

describe("varianceBand — T01 thresholds", () => {
  it("0% → ok", () => expect(varianceBand(0)).toBe("ok"));
  it("4.99% → ok", () => expect(varianceBand(4.99)).toBe("ok"));
  it("5% → investigate", () => expect(varianceBand(5)).toBe("investigate"));
  it("9.99% → investigate", () => expect(varianceBand(9.99)).toBe("investigate"));
  it("10% → critical", () => expect(varianceBand(10)).toBe("critical"));
  it("50% → critical", () => expect(varianceBand(50)).toBe("critical"));
});

// ─── dayBounds ────────────────────────────────────────────────────────────────

describe("dayBounds", () => {
  it("returns a YYYY-MM-DD date string in SAST", () => {
    // 2026-06-08 10:00 UTC = 12:00 SAST → date should be 2026-06-08
    const ref = new Date("2026-06-08T10:00:00Z");
    const { date } = dayBounds(ref);
    expect(date).toBe("2026-06-08");
  });

  it("00:30 SAST still belongs to same day", () => {
    // 2026-06-08 22:30 UTC = 00:30+1 SAST next day → date should be 2026-06-09
    const ref = new Date("2026-06-08T22:30:00Z");
    const { date } = dayBounds(ref);
    expect(date).toBe("2026-06-09");
  });

  it("23:59 UTC+2 crosses midnight correctly", () => {
    // 2026-06-07 21:59 UTC = 23:59 SAST on 2026-06-07 → date 2026-06-07
    const ref = new Date("2026-06-07T21:59:00Z");
    const { date } = dayBounds(ref);
    expect(date).toBe("2026-06-07");
  });

  it("start is before end", () => {
    const { start, end } = dayBounds(new Date("2026-06-08T10:00:00Z"));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it("span is exactly 24 hours minus 1ms", () => {
    const { start, end } = dayBounds(new Date("2026-06-08T10:00:00Z"));
    const diffMs = end.getTime() - start.getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it("start is exactly midnight SAST (22:00 UTC)", () => {
    const ref = new Date("2026-06-08T10:00:00Z");
    const { start } = dayBounds(ref);
    // 2026-06-08 00:00 SAST = 2026-06-07 22:00 UTC
    expect(start.toISOString()).toBe("2026-06-07T22:00:00.000Z");
  });
});

// ─── closeDaily — DB integration (mocked) ────────────────────────────────────

vi.mock("@db/index", () => {
  const db = { select: vi.fn(), execute: vi.fn(), transaction: vi.fn() };
  return { db };
});

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

const sendNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));

vi.mock("@/server/push/vapid", () => ({
  initVapid: vi.fn(),
}));

vi.mock("@/server/push/payload", () => ({
  isValidPushSubscription: (x: unknown) => x != null,
}));

// AT-207: the write-off sweep and the daily_closes row live in their own module
// (tested in close/write-offs.test.ts and close-daily-writeoffs.test.ts). Here
// they are stubbed to "nothing to write off, no close row yet" so these tests
// keep asserting the reconciliation and AT-193's idempotency unchanged.
vi.mock("@/server/close/write-offs", () => ({
  sweepWriteOffs: vi.fn().mockResolvedValue({ written: [], dayCount: 0, dayZar: 0 }),
  hasDailyClose: vi.fn().mockResolvedValue(false),
  recordDailyClose: vi.fn().mockResolvedValue(undefined),
  buildWriteOffAlert: vi.fn(),
}));
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: vi.fn() }));

const DAY = new Date("2026-06-08T10:00:00Z");
const ADMIN = { id: "staff-admin-1", pushSubscription: { endpoint: "https://push.example/1", keys: { p256dh: "x", auth: "y" } } };

/** db.select().from().where() resolving to `rows`. */
const selectResolving = (rows: unknown[]) =>
  ({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }) }) as unknown as ReturnType<typeof import("@db/index").db.select>;

/**
 * Queue the DB reads of one close, in order: inside the transaction the
 * advisory lock, the close-record check, revenue and payments; then, only on a
 * mismatch, the admin lookup for the push.
 */
async function mockClose(o: { closed?: boolean; revenue?: number; payments?: number; admins?: unknown[] }) {
  const { db } = await import("@db/index");
  vi.mocked(db.transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never);
  vi.mocked(db.execute).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof db.execute>>); // lock
  vi.mocked(db.select).mockReturnValueOnce(selectResolving(o.closed ? [{ day: "2026-06-08" }] : []));
  if (o.closed) return;
  vi.mocked(db.select).mockReturnValueOnce(selectResolving([{ total: o.revenue ?? 0 }]));
  vi.mocked(db.execute).mockResolvedValueOnce([{ total: String(o.payments ?? 0) }] as unknown as Awaited<ReturnType<typeof db.execute>>);
  if (o.admins) vi.mocked(db.select).mockReturnValueOnce(selectResolving(o.admins));
}

describe("closeDaily — reconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok band when revenue matches payments", async () => {
    await mockClose({ revenue: 100000, payments: 100000 });
    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(DAY);

    expect(result).toMatchObject({ alreadyClosed: false, band: "ok", variancePct: 0 });
  });

  it("returns critical band on >10% mismatch and pushes an alert to admin staff", async () => {
    // Payments only 80% of revenue → 20% variance
    await mockClose({ revenue: 100000, payments: 80000, admins: [ADMIN] });
    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(DAY);

    expect(result).toMatchObject({ band: "critical" });
    expect(sendNotification).toHaveBeenCalledOnce();
  });

  it("does NOT push an alert when band is ok", async () => {
    await mockClose({ revenue: 50000, payments: 50000 });
    const { closeDaily } = await import("@/server/crons/close-daily");
    await closeDaily(DAY);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("returns investigate band on 7% mismatch", async () => {
    // No admin recipients — the alert path just no-ops.
    await mockClose({ revenue: 100000, payments: 93000, admins: [] });
    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(DAY);

    expect(result).toMatchObject({ band: "investigate" });
    expect(result.alreadyClosed === false && result.variancePct).toBeCloseTo(7, 0);
  });

  it("writes an audit row on every run", async () => {
    await mockClose({});
    const { closeDaily } = await import("@/server/crons/close-daily");
    await closeDaily(DAY);

    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditCall.action).toBe("daily_close");
  });

  // AT-209 / L02: a paid order cancelled after start keeps its money. Revenue
  // adds the cancelled-with-successful-payment case to the non-cancelled rule
  // (#260), so it covers the same orders as the payments query and that order
  // raises no variance alert.
  it("revenue also counts a cancelled order holding a successful payment; no false alert", async () => {
    const { db } = await import("@db/index");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL } = await import("@/server/reports/revenue-scope");
    vi.mocked(db.transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn(db)) as never);
    vi.mocked(db.execute).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof db.execute>>); // lock
    vi.mocked(db.select).mockReturnValueOnce(selectResolving([])); // no close record yet
    let whereArg: unknown;
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn((w: unknown) => { whereArg = w; return Promise.resolve([{ total: 3000 }]); }),
      }),
    } as unknown as ReturnType<typeof db.select>);
    vi.mocked(db.execute).mockResolvedValueOnce([{ total: "3000" }] as unknown as Awaited<ReturnType<typeof db.execute>>);

    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(DAY);

    const rendered = new PgDialect().sqlToQuery(whereArg as import("drizzle-orm").SQL).sql;
    expect(rendered).toContain(`"orders"."state" <> $`);
    expect(rendered).toContain(` or ${CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL}`);
    expect(rendered).toContain(`"orders"."revenue_day" = $`);
    expect(result).toMatchObject({ alreadyClosed: false, band: "ok" });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

// ─── closeDaily — AT-193: idempotent, completed days only, catch-up recorded ─

describe("closeDaily — one close per revenue day (AT-193, §9.6.2 job 2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a second close of a closed day writes nothing and pushes nothing", async () => {
    await mockClose({ closed: true });
    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(DAY);

    expect(result).toEqual({ date: "2026-06-08", alreadyClosed: true });
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("takes the per-day lock before checking for a close record", async () => {
    await mockClose({});
    const { closeDaily } = await import("@/server/crons/close-daily");
    await closeDaily(DAY);

    const { db } = await import("@db/index");
    const lockQuery = JSON.stringify(vi.mocked(db.execute).mock.calls[0][0]);
    expect(lockQuery).toContain("pg_advisory_xact_lock");
    expect(lockQuery).toContain("daily_close:2026-06-08");
  });

  it("refuses a day that is not over yet, before touching the DB", async () => {
    const { closeDaily } = await import("@/server/crons/close-daily");
    await expect(closeDaily(DAY, { now: new Date("2026-06-08T21:59:00Z") })).rejects.toThrow(/not over yet/);
    const { db } = await import("@db/index");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("a catch-up close is recorded as one, naming the revenue day it closed", async () => {
    await mockClose({});
    const { closeDaily } = await import("@/server/crons/close-daily");
    const result = await closeDaily(DAY, { wasCatchUp: true });

    expect(result).toMatchObject({ alreadyClosed: false, wasCatchUp: true });
    const { writeAudit } = await import("@/server/audit");
    const row = vi.mocked(writeAudit).mock.calls[0][0];
    expect(row).toMatchObject({ entityKind: "system", entityId: "2026-06-08", actorRole: "system" });
    expect(row.after).toMatchObject({ revenueDay: "2026-06-08", wasCatchUp: true });
    expect(row.reason).toMatch(/catch-up.*2026-06-08/);
  });
});
