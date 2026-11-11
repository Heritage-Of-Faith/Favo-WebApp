// The POS recents grid — PRD §6.2.1, REQ-050, REQ-052, REQ-142.
// §6.2.1: "the office staff who have NOT yet claimed today's cup, most recent
// first, then the last 12 matched customers." REQ-052: "served tiles appear
// below, visibly marked, never in a primary slot". §6.2.1: "On a clean
// database the grid is empty". REQ-142: no email, no full phone number.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff-1", role: "barista" } }),
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { customers } from "@db/schema";
import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { getRecentsGrid } from "@/server/actions/recents";
import { buildRecentsGrid, readsAlikeKey, RECENTS_MATCHED_LIMIT, type RecentsRow } from "@/server/recents/grid";

const row = (id: string, name: string, surname: string | null = null, phone: string | null = null): RecentsRow => ({
  id, name, surname, phone,
});

describe("buildRecentsGrid — §6.2.1 ordering", () => {
  it("holds the last 12 matched customers (PRD literal 12)", () => {
    expect(RECENTS_MATCHED_LIMIT).toBe(12);
  });

  it("is empty on a clean database", () => {
    expect(buildRecentsGrid({ weekday: true, officeStaff: [], servedIds: new Set(), matched: [] })).toEqual([]);
    expect(buildRecentsGrid({ weekday: false, officeStaff: [], servedIds: new Set(), matched: [] })).toEqual([]);
  });

  it("weekday: unclaimed office staff first (most recent first), then matched customers, then served tiles marked", () => {
    const grid = buildRecentsGrid({
      weekday: true,
      officeStaff: [row("os-a", "Ayanda"), row("os-b", "Bongani"), row("os-c", "Carla")],
      servedIds: new Set(["os-b"]),
      matched: [row("cm-x", "Xolani"), row("cm-y", "Yusuf")],
    });
    expect(grid.map((t) => [t.id, t.served])).toEqual([
      ["os-a", false],
      ["os-c", false],
      ["cm-x", false],
      ["cm-y", false],
      ["os-b", true],
    ]);
  });

  it("never puts a served tile in a primary slot, even when every office staff member is served", () => {
    const grid = buildRecentsGrid({
      weekday: true,
      officeStaff: [row("os-a", "Ayanda"), row("os-b", "Bongani")],
      servedIds: new Set(["os-a", "os-b"]),
      matched: [row("cm-x", "Xolani")],
    });
    expect(grid[0]).toMatchObject({ id: "cm-x", served: false });
    expect(grid.slice(1).every((t) => t.served)).toBe(true);
  });

  it("caps the matched section at 12 and never repeats a customer", () => {
    const matched = Array.from({ length: 20 }, (_, i) => row(`cm-${i}`, `Name${i}`));
    const grid = buildRecentsGrid({
      weekday: true,
      officeStaff: [row("os-a", "Ayanda")],
      servedIds: new Set(),
      matched: [row("os-a", "Ayanda"), ...matched],
    });
    expect(grid).toHaveLength(1 + 12);
    expect(new Set(grid.map((t) => t.id)).size).toBe(grid.length);
    expect(grid.at(-1)!.id).toBe("cm-11");
  });

  it("not a weekday: no office-staff section and nothing marked served", () => {
    const grid = buildRecentsGrid({
      weekday: false,
      officeStaff: [row("os-a", "Ayanda")],
      servedIds: new Set(["cm-x"]),
      matched: [row("cm-x", "Xolani")],
    });
    expect(grid).toEqual([{ id: "cm-x", name: "Xolani", surname: null, phoneLast4: null, served: false }]);
  });

  it("owner decision: office staff who never ordered are listed (after those with a last order, in the order given)", () => {
    // The read orders them: last order DESC NULLS LAST, then surname, then name.
    const grid = buildRecentsGrid({
      weekday: true,
      officeStaff: [row("os-ordered", "Ayanda", "Nkosi"), row("os-new-1", "Bongani", "Mokoena"), row("os-new-2", "Carla", "Zulu")],
      servedIds: new Set(),
      matched: [],
    });
    expect(grid.map((t) => t.id)).toEqual(["os-ordered", "os-new-1", "os-new-2"]);
  });
});

describe("buildRecentsGrid — REQ-142 phone digits only where two tiles read alike", () => {
  it("unique names get phoneLast4 null", () => {
    const grid = buildRecentsGrid({
      weekday: true,
      officeStaff: [row("a", "Louis", "Botha", "+27821234567")],
      servedIds: new Set(),
      matched: [row("b", "Thandeka", "Dlamini", "0839876543")],
    });
    expect(grid.map((t) => t.phoneLast4)).toEqual([null, null]);
    // No phone digits at all (the only digit allowed is the "4" in the key "phoneLast4").
    expect(JSON.stringify(grid).replaceAll("phoneLast4", "")).not.toMatch(/\d/);
  });

  it("'André Botha' and 'Andre Botha' read alike: both get their last four digits", () => {
    const grid = buildRecentsGrid({
      weekday: true,
      officeStaff: [row("a", "André", "Botha", "+27821234567"), row("c", "Nkuli", "Zulu", "0711112222")],
      servedIds: new Set(["a"]),
      matched: [row("b", " andre ", "  BOTHA", "0839876543")],
    });
    const byId = Object.fromEntries(grid.map((t) => [t.id, t.phoneLast4]));
    expect(byId).toEqual({ a: "4567", b: "6543", c: null });
  });

  it("readsAlikeKey: NFD-stripped, case-insensitive, whitespace collapsed", () => {
    expect(readsAlikeKey("  André ", "Botha  ")).toBe("andre botha");
    expect(readsAlikeKey("Andre", "BOTHA")).toBe(readsAlikeKey("André", "Botha"));
  });
});

// A chainable query-builder stub that resolves to `rows` when awaited.
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "groupBy", "orderBy", "limit"]) c[m] = vi.fn(() => c);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
  return c;
}

describe("getRecentsGrid — the server read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  const LOUIS = { id: "cust-louis", name: "Louis", surname: "Botha", phone: "+27821234567", email: "louis@example.com", status: "office_staff" };
  const THANDI = { id: "cust-thandi", name: "Thandeka", surname: "Dlamini", phone: "0839876543", email: "t@example.com", status: "church_member" };

  it("REQ-142: the response JSON carries no email, no full phone and no status", async () => {
    vi.setSystemTime(new Date("2026-11-10T08:00:00+02:00")); // a Tuesday in SAST
    vi.mocked(db.select)
      .mockReturnValueOnce(chain([LOUIS]) as never)
      .mockReturnValueOnce(chain([]) as never)
      .mockReturnValueOnce(chain([THANDI]) as never);

    const r = await getRecentsGrid();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify(r);
    for (const leak of ["louis@example.com", "t@example.com", "+27821234567", "821234567", "0839876543", "office_staff", "church_member", "email", "\"phone\"", "status"]) {
      expect(json).not.toContain(leak);
    }
    // Unique names: no phone digits of any kind in the payload.
    // (the only digit allowed is the "4" in the key "phoneLast4")
    expect(json.replaceAll("phoneLast4", "")).not.toMatch(/\d/);
    for (const t of r.data) expect(Object.keys(t).sort()).toEqual(["id", "name", "phoneLast4", "served", "surname"]);
    expect(r.data).toEqual([
      { id: "cust-louis", name: "Louis", surname: "Botha", phoneLast4: null, served: false },
      { id: "cust-thandi", name: "Thandeka", surname: "Dlamini", phoneLast4: null, served: false },
    ]);
    // email and status are never even selected
    for (const call of vi.mocked(db.select).mock.calls) {
      const keys = Object.keys((call[0] ?? {}) as object);
      expect(keys).not.toContain("email");
      expect(keys).not.toContain("status");
    }
  });

  it("REQ-052: an office staff member with today's entitlement is marked served and placed last", async () => {
    vi.setSystemTime(new Date("2026-11-10T08:00:00+02:00"));
    vi.mocked(db.select)
      .mockReturnValueOnce(chain([LOUIS]) as never)
      .mockReturnValueOnce(chain([{ customerId: "cust-louis" }]) as never)
      .mockReturnValueOnce(chain([THANDI]) as never);

    const r = await getRecentsGrid();
    if (!r.ok) throw new Error(r.message);
    expect(r.data.map((t) => [t.id, t.served])).toEqual([["cust-thandi", false], ["cust-louis", true]]);
  });

  it("on a Sunday reads only the matched customers (one query, limit 12)", async () => {
    vi.setSystemTime(new Date("2026-11-15T09:00:00+02:00")); // a Sunday in SAST
    const q = chain([THANDI]);
    vi.mocked(db.select).mockReturnValueOnce(q as never);
    const r = await getRecentsGrid();
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(q.limit).toHaveBeenCalledWith(12);
    expect(r).toEqual({ ok: true, data: [{ id: "cust-thandi", name: "Thandeka", surname: "Dlamini", phoneLast4: null, served: false }] });
  });

  it("owner decision: the weekday office-staff read starts from customers with a LEFT join, so never-ordered staff are included", async () => {
    vi.setSystemTime(new Date("2026-11-10T08:00:00+02:00"));
    const staffQ = chain([LOUIS]);
    vi.mocked(db.select)
      .mockReturnValueOnce(staffQ as never)
      .mockReturnValueOnce(chain([]) as never)
      .mockReturnValueOnce(chain([]) as never);
    await getRecentsGrid();
    expect(staffQ.from).toHaveBeenCalledWith(customers);
    expect(staffQ.leftJoin).toHaveBeenCalledTimes(1);
    expect(staffQ.innerJoin).not.toHaveBeenCalled();
    const orderArgs = (staffQ.orderBy as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const first = new PgDialect().sqlToQuery(orderArgs[0] as SQL).sql;
    expect(first).toContain("DESC NULLS LAST");
    expect(orderArgs).toHaveLength(3); // then surname, then name
  });

  it("is gated to barista and admin, and a refusal touches no data", async () => {
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "no" });
    const r = await getRecentsGrid();
    expect(r).toEqual({ ok: false, code: "FORBIDDEN", message: "no" });
    expect(db.select).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledWith("barista", "admin");
  });
});
