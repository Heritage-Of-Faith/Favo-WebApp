// AT-209 — /admin/write-downs read (§7.3.1, REQ-059, REQ-124): admin only,
// three named per-barista figures read from audit_log, zero as 0 (never
// omitted), integer cents with no rounding, UNAVAILABLE (null) never 0.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

let authOk = true;
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async (...roles: string[]) =>
    authOk && roles.length === 1 && roles[0] === "admin"
      ? { ok: true, session: { id: "staff_admin", name: "Admin", role: "admin" } }
      : { ok: false, code: "FORBIDDEN", message: "Not allowed." }
  ),
}));
const mockExecute = vi.fn();
vi.mock("@/lib/db", () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));

import { getWriteDownsReport } from "@/server/actions/write-downs-report";
import { summarisePerBarista, weekContaining } from "@/server/write-downs/summary";
import { authorize } from "@/server/auth/guard";

const STAFF = [
  { id: "staff_louis", name: "Louis" },
  { id: "staff_thandeka", name: "Thandeka" },
  { id: "staff_nkuli", name: "Nkuli" },
];

// A week (Mon 19 – Sun 25 Oct 2026). Louis: two comps (R20 + R25), one
// abandoned order. Nkuli: three write-offs — Sat 24 Oct R30
// declined_not_retendered (day approved), Sun 25 Oct R35 unresolved_at_close
// and R20 deferred_unsettled (day NOT approved). Thandeka: nothing.
const RAW = [
  { kind: "write_off", audit_id: "a0", revenue_day: "2026-10-24", at: "2026-10-24T22:05:00Z", staff_id: "staff_nkuli", staff_name: "Nkuli", on_behalf_of_name: null, order_id: "o0", value_zar: "3000", reason: "declined_not_retendered" },
  { kind: "comp", audit_id: "a1", revenue_day: "2026-10-25", at: "2026-10-25T07:00:00Z", staff_id: "staff_louis", staff_name: "Louis", on_behalf_of_name: null, order_id: "o1", value_zar: "2000", reason: "spillage" },
  { kind: "comp", audit_id: "a2", revenue_day: "2026-10-25", at: "2026-10-25T07:30:00Z", staff_id: "staff_louis", staff_name: "Louis", on_behalf_of_name: "Mia", order_id: "o2", value_zar: 2500, reason: "wrong_drink" },
  { kind: "abandoned", audit_id: "a3", revenue_day: "2026-10-25", at: "2026-10-25T08:00:00Z", staff_id: "staff_louis", staff_name: "Louis", on_behalf_of_name: null, order_id: "o3", value_zar: null, reason: "customer left" },
  { kind: "write_off", audit_id: "a4", revenue_day: "2026-10-25", at: "2026-10-25T22:05:00Z", staff_id: "staff_nkuli", staff_name: "Nkuli", on_behalf_of_name: null, order_id: "o4", value_zar: "3500", reason: "unresolved_at_close" },
  { kind: "write_off", audit_id: "a5", revenue_day: "2026-10-25", at: "2026-10-25T22:05:00Z", staff_id: "staff_nkuli", staff_name: "Nkuli", on_behalf_of_name: null, order_id: "o5", value_zar: "2000", reason: "deferred_unsettled" },
];

// listUnapprovedWriteOffDays' rows: 25 Oct has no write_off_approved row.
const QUEUE = [
  { revenue_day: "2026-10-25", order_id: "o4", placed_at: "2026-10-25T08:00:00Z", total_zar: 3500, reason: "unresolved_at_close", staff_id: "staff_nkuli", barista_name: "Nkuli" },
  { revenue_day: "2026-10-25", order_id: "o5", placed_at: "2026-10-25T08:10:00Z", total_zar: 2000, reason: "deferred_unsettled", staff_id: "staff_nkuli", barista_name: "Nkuli" },
];

/** execute() call order: the approval queue, the write-downs, the active staff. */
function given(raw: unknown[], staff = STAFF, queue: unknown[] = QUEUE) {
  mockExecute.mockReset();
  mockExecute.mockResolvedValueOnce(queue).mockResolvedValueOnce(raw).mockResolvedValueOnce(staff);
}

// PRD-literal reason names (WRITE_OFF_REASONS), each with zero as 0.
const ZERO_BY_REASON = {
  unresolved_at_close: { count: 0, zar: 0 },
  declined_not_retendered: { count: 0, zar: 0 },
  deferred_unsettled: { count: 0, zar: 0 },
};

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL);

beforeEach(() => {
  vi.clearAllMocks();
  authOk = true;
});

describe("getWriteDownsReport — admin only (§11.3: /admin/write-downs is admin ✔ only)", () => {
  it("authorizes 'admin' and nothing else, and reads nothing when refused", async () => {
    authOk = false;
    const res = await getWriteDownsReport({ from: "2026-10-19", to: "2026-10-25" });
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(authorize).toHaveBeenCalledWith("admin");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("refuses a malformed or inverted range without reading", async () => {
    expect(await getWriteDownsReport({ from: "25/10/2026", to: "2026-10-25" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await getWriteDownsReport({ from: "2026-10-26", to: "2026-10-25" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("refuses an impossible calendar day (2026-02-30) as INVALID_INPUT, before any read", async () => {
    expect(await getWriteDownsReport({ from: "2026-02-30", to: "2026-03-01" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await getWriteDownsReport({ from: "2026-02-01", to: "2026-13-01" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("REQ-124 — three named per-barista figures from audit_log", () => {
  it("comps (count + value), deferred write-offs (count + value, split by every reason), abandoned (count)", async () => {
    given(RAW);
    const res = await getWriteDownsReport({ from: "2026-10-19", to: "2026-10-25" });
    if (!res.ok) throw new Error(res.message);
    const by = Object.fromEntries(res.data.perBarista.map((b) => [b.name, b]));

    expect(by.Louis.comps).toEqual({ count: 2, zar: 4500 });
    expect(by.Louis.abandoned).toEqual({ count: 1 });
    expect(by.Louis.writeOffs).toEqual({ count: 0, zar: 0, byReason: ZERO_BY_REASON, unapproved: { count: 0, zar: 0 } });

    expect(by.Nkuli.writeOffs).toEqual({
      count: 3,
      zar: 8500,
      byReason: {
        unresolved_at_close: { count: 1, zar: 3500 },
        declined_not_retendered: { count: 1, zar: 3000 },
        deferred_unsettled: { count: 1, zar: 2000 },
      },
      // §6.0.5: only 25 Oct is still in the approval queue.
      unapproved: { count: 2, zar: 5500 },
    });
    expect(by.Nkuli.comps).toEqual({ count: 0, zar: 0 });
    expect(by.Nkuli.abandoned).toEqual({ count: 0 });
  });

  it("marks a write-off unapproved exactly while its revenue day is in the approval queue; never a comp or abandon", async () => {
    given(RAW);
    const res = await getWriteDownsReport({ from: "2026-10-19", to: "2026-10-25" });
    if (!res.ok) throw new Error(res.message);
    const flags = Object.fromEntries(res.data.rows.map((r) => [r.auditId, r.unapproved]));
    expect(flags).toEqual({ a0: false, a1: false, a2: false, a3: false, a4: true, a5: true });
    // The approval queue's reader is the first read.
    expect(render(mockExecute.mock.calls[0][0]).params).toContain("write_off_approved");
  });

  it("zero is 0, never omitted: a barista with nothing still has all three figures", async () => {
    given(RAW);
    const res = await getWriteDownsReport({ from: "2026-10-19", to: "2026-10-25" });
    if (!res.ok) throw new Error(res.message);
    expect(res.data.perBarista.map((b) => b.name)).toEqual(["Louis", "Thandeka", "Nkuli"]);
    expect(res.data.perBarista.find((b) => b.name === "Thandeka")).toEqual({
      staffId: "staff_thandeka",
      name: "Thandeka",
      comps: { count: 0, zar: 0 },
      writeOffs: { count: 0, zar: 0, byReason: ZERO_BY_REASON, unapproved: { count: 0, zar: 0 } },
      abandoned: { count: 0 },
    });
  });

  it("lists each act with date, barista, order, integer-cents value and reason; an abandoned order has no value", async () => {
    given(RAW);
    const res = await getWriteDownsReport({ from: "2026-10-19", to: "2026-10-25" });
    if (!res.ok) throw new Error(res.message);
    expect(res.data.rows).toHaveLength(6);
    expect(res.data.rows[2]).toEqual({
      kind: "comp", auditId: "a2", revenueDay: "2026-10-25", at: new Date("2026-10-25T07:30:00Z"),
      staffId: "staff_louis", staffName: "Louis", onBehalfOfName: "Mia", orderId: "o2", valueZar: 2500, reason: "wrong_drink",
      unapproved: false,
    });
    expect(res.data.rows[3]).toMatchObject({ kind: "abandoned", valueZar: null, reason: "customer left" });
    for (const r of res.data.rows) if (r.valueZar !== null) expect(Number.isInteger(r.valueZar)).toBe(true);
  });

  it("reads audit_log for the three acts, by the order's revenue day, inclusive range", async () => {
    given([]);
    await getWriteDownsReport({ from: "2026-10-19", to: "2026-10-25" });
    const q = render(mockExecute.mock.calls[1][0]);
    expect(q.sql).toContain("FROM audit_log a");
    expect(q.sql).toContain("a.entity_kind = 'order_item' AND a.action = 'comp'");
    expect(q.sql).toContain("(a.after->>'abandoned') = 'true'");
    expect(q.sql).toContain("a.actor_id");
    expect(q.sql).toContain("o.revenue_day BETWEEN");
    expect(q.params).toContain("write_off");
    expect(q.params).toContain("2026-10-19");
    expect(q.params).toContain("2026-10-25");
    expect(q.sql).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b|ROUND\(/i);
  });

  it("REQ-034: a write-off that was later reversed (written_off_at cleared) is not counted", async () => {
    given([]);
    await getWriteDownsReport({ from: "2026-10-19", to: "2026-10-25" });
    const q = render(mockExecute.mock.calls[1][0]);
    // The write_off branch, and only it, requires the order to still be written off.
    const branches = q.sql.split("UNION ALL");
    const writeOff = branches.find((b) => b.includes("'write_off'"));
    expect(writeOff).toContain("o.written_off_at IS NOT NULL");
    expect(branches.filter((b) => b.includes("o.written_off_at IS NOT NULL"))).toHaveLength(1);
  });

  it("defaults to the Monday–Sunday week containing today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z")); // Thursday
    given([]);
    const res = await getWriteDownsReport();
    vi.useRealTimers();
    expect(res).toMatchObject({ ok: true, data: { from: "2026-10-19", to: "2026-10-25" } });
  });
});

describe("summarisePerBarista — UNAVAILABLE is never 0", () => {
  it("a comp whose audit row has no integer value makes that barista's comps value null, count still counted", () => {
    const out = summarisePerBarista(
      [{ kind: "comp", auditId: "x", revenueDay: "2026-10-25", at: new Date(), staffId: "staff_louis", staffName: "Louis", onBehalfOfName: null, orderId: "o", valueZar: null, reason: "goodwill", unapproved: false }],
      STAFF
    );
    expect(out[0].comps).toEqual({ count: 1, zar: null });
    expect(out[1].comps).toEqual({ count: 0, zar: 0 });
  });

  it("an actor no longer active still appears, after the active staff", () => {
    const out = summarisePerBarista(
      [{ kind: "abandoned", auditId: "y", revenueDay: "2026-10-25", at: new Date(), staffId: "staff_old", staffName: "Sam", onBehalfOfName: null, orderId: "o", valueZar: null, reason: "left", unapproved: false }],
      STAFF
    );
    expect(out.map((b) => b.name)).toEqual(["Louis", "Thandeka", "Nkuli", "Sam"]);
    expect(out[3].abandoned).toEqual({ count: 1 });
  });
});

describe("weekContaining", () => {
  it("is Monday–Sunday", () => {
    expect(weekContaining("2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekContaining("2026-10-25")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekContaining("2026-11-02")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
  });
});
