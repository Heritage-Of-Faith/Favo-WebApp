// AT-202 part 1 — an offline order replayed through applyOutboxItem carries
// its per-line `shots` and is priced by the same server arithmetic as
// createOrder (§7.0.2 surcharge_zar, per unit). The mode is the one in force
// on the server's receipt day; a line above that day's ceiling is refused,
// never silently re-priced without its surcharge.
//
// Literal values: a R20.00 cappuccino at 3 shots on a Sunday is R30.00
// (PRD §15 "Shot pricing, at every step"); extra_shot_zar default 1000.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { outboxLog, orders, orderItems, menuItems, openingSessions, eventWindows, appConfig, recipeIngredients } from "@db/schema";

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const inserts: { table: unknown; values: unknown }[] = [];

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "limit", "orderBy", "innerJoin"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    selectDistinct: () => selectChain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Object.assign(Promise.resolve(), { returning: async () => [{ id: "log-1" }] });
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));

import { applyOutboxItem, outboxItemSchema } from "@/server/sync/apply-outbox";
import { writeAudit } from "@/server/audit";

const CAPP = { id: "mi-capp", name: "Cappuccino", currentPriceZar: 2000, active: true, recipeId: "rec_capp" };
const CHOC = { id: "mi-choc", name: "Hot Chocolate", currentPriceZar: 2000, active: true, recipeId: "rec_choc" };
const SUNDAY = new Date("2026-10-11T09:00:00+02:00");
const MONDAY = new Date("2026-10-12T09:00:00+02:00");

/** A mode string, or a session row bound to an event window (`window`). */
type GivenSession = string | { mode: "event"; window: Row };

function given(sessions: GivenSession[]) {
  const windows = sessions.flatMap((s) => (typeof s === "string" ? [] : [s.window]));
  rows = new Map<unknown, Row[]>([
    [outboxLog, []],
    [menuItems, [CAPP, CHOC]],
    // The coffee-recipe lookup (ingredient kind 'bean'): only the cappuccino holds coffee.
    [recipeIngredients, [{ recipeId: "rec_capp" }]],
    [openingSessions, sessions.map((s) => (typeof s === "string" ? { mode: s } : { mode: s.mode, eventWindowId: s.window.id }))],
    [eventWindows, windows],
    [appConfig, []],
  ]);
}

/** An event window 08:00–12:00 SAST on the given date, with the given posture. */
function eventOn(date: string, paymentPosture: "free" | "standard"): { mode: "event"; window: Row } {
  return {
    mode: "event",
    window: {
      id: `evw_${date}_${paymentPosture}`, name: paymentPosture === "free" ? "Discipleship 101" : "Youth Social",
      startsAt: new Date(`${date}T08:00:00+02:00`), endsAt: new Date(`${date}T12:00:00+02:00`),
      menuScope: "full", paymentPosture, consumesCupLid: true, audience: "both",
      extraShotSurcharge: paymentPosture !== "free", voucherKinds: [],
    },
  };
}

function entry(shots: number | undefined, clientTotalZar: number) {
  return {
    clientUuid: "22222222-2222-2222-2222-222222222222",
    staffId: "staff-1",
    items: [{ menuItemId: CAPP.id, quantity: 1, modifications: [] as string[], ...(shots === undefined ? {} : { shots }) }],
    paymentMode: "yoco_deferred" as const,
    clientTotalZar,
    clientTimestamp: "2026-10-11T07:00:00Z",
  };
}

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);

beforeEach(() => {
  inserts.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY);
});
afterEach(() => vi.useRealTimers());

describe("applyOutboxItem — shots (AT-202)", () => {
  it("a Sunday triple replayed on the Sunday is R30.00, and the line carries shots 3 + surcharge 1000", async () => {
    given(["sunday"]);
    const res = await applyOutboxItem(entry(3, 3000));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 3000 });
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 3000 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).toMatchObject({ shots: 3, surchargeZar: 1000 });
  });

  it("a client total without the surcharge is an amount mismatch — the server total is authoritative", async () => {
    given(["sunday"]);
    const res = await applyOutboxItem(entry(3, 2000));
    expect(res).toEqual({ outcome: "rejected", reason: "amount_mismatch" });
    expect(insertsInto(orders)).toEqual([]);
  });

  it("a Sunday triple replayed on a weekday is refused, never re-priced without its surcharge", async () => {
    vi.setSystemTime(MONDAY);
    given(["weekday"]);
    const res = await applyOutboxItem(entry(3, 3000));
    expect(res).toEqual({ outcome: "rejected", reason: "shots_above_ceiling" });
    expect(insertsInto(orders)).toEqual([]);
    expect(insertsInto(outboxLog)).toHaveLength(1); // the receipt is still recorded
  });

  it("with no session on the receipt day, a triple fails closed", async () => {
    given([]);
    const res = await applyOutboxItem(entry(3, 3000));
    expect(res).toEqual({ outcome: "rejected", reason: "shots_above_ceiling" });
  });

  it("an entry queued before the picker existed (no shots) replays as 1 shot", async () => {
    given(["sunday"]);
    const res = await applyOutboxItem(entry(undefined, 2000));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).toMatchObject({ shots: 1, surchargeZar: 0 });
  });

  it("a hot chocolate at 2 shots is refused (no coffee, L48); nothing is applied", async () => {
    given(["sunday"]);
    const e = entry(2, 2000);
    e.items[0].menuItemId = CHOC.id;
    const res = await applyOutboxItem(e);
    expect(res).toEqual({ outcome: "rejected", reason: "shots_not_allowed" });
    expect(insertsInto(orders)).toEqual([]);
  });

  it("a hot chocolate at 1 shot replays at its listed price", async () => {
    given(["sunday"]);
    const e = entry(1, 2000);
    e.items[0].menuItemId = CHOC.id;
    expect(await applyOutboxItem(e)).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
  });

  it("the schema refuses shots below 1 or fractional", () => {
    expect(outboxItemSchema.safeParse(entry(0, 2000)).success).toBe(false);
    expect(outboxItemSchema.safeParse(entry(1.5, 2000)).success).toBe(false);
    expect(outboxItemSchema.safeParse(entry(4, 4000)).success).toBe(true);
  });
});

// ─── AT-212 / S7a: 'free' wins over deferred ────────────────────────────────
// "createOrder writes 'free' on weekday mode … and 'yoco_deferred' when the
// till is deferred. 'free' wins." An order queued as 'yoco_deferred' and
// replayed on a weekday-mode day is written 'free', every line zeroed by
// discount_zar (DEC-18), total R0 — never a phantom write-off at the close.
describe("applyOutboxItem — weekday + deferred → free (S7a, AT-212)", () => {
  it("a R20.00 cappuccino queued 'yoco_deferred', replayed on a weekday → payment_mode 'free', total R0, line zeroed", async () => {
    vi.setSystemTime(MONDAY);
    given(["weekday"]);
    const res = await applyOutboxItem(entry(1, 2000));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 0 });
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "free", totalZar: 0 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).toMatchObject({ unitPriceZar: 2000, discountZar: 2000 });
  });

  // The till's 'free' is never trusted: off a weekday-free day it is owed.
  const queuedFree = () => ({ ...entry(1, 2000), paymentMode: "free" as const });
  const SATURDAY = new Date("2026-10-10T09:00:00+02:00");

  it("a queued 'free' entry replayed on a weekday → 'free', R0, line zeroed", async () => {
    vi.setSystemTime(MONDAY);
    given(["weekday"]);
    const res = await applyOutboxItem(queuedFree());
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 0 });
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "free", totalZar: 0 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).toMatchObject({ unitPriceZar: 2000, discountZar: 2000 });
  });

  // CHANGED (event switches story): the mode is read at the instant of receipt
  // (src/lib/till-mode.ts). An event session counts only while its window is in
  // force, and then by its posture: a paid event is owed; a free one is free.
  it.each([
    ["a Sunday", SUNDAY, ["sunday"]],
    ["a Saturday paid event in force", SATURDAY, [eventOn("2026-10-10", "standard")]],
    ["a weekday with a paid event in force", MONDAY, [eventOn("2026-10-12", "standard")]],
    ["a weekday with a weekday session and a paid event in force", MONDAY, ["weekday", eventOn("2026-10-12", "standard")]],
    ["a weekday with no session", MONDAY, []],
  ] as const)("a queued 'free' entry replayed on %s → 'yoco_deferred' at the server total R20.00, line not zeroed", async (_l, now, sessions) => {
    vi.setSystemTime(now);
    given([...sessions]);
    const res = await applyOutboxItem(queuedFree());
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "yoco_deferred", totalZar: 2000 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).not.toHaveProperty("discountZar");
  });

  it.each([
    ["a weekday whose event session's window is not in force (reads as weekday)", MONDAY,
      ["weekday", { ...eventOn("2026-10-12", "standard"), window: { ...eventOn("2026-10-12", "standard").window,
        startsAt: new Date("2026-10-12T18:30:00+02:00"), endsAt: new Date("2026-10-12T20:30:00+02:00") } }]],
    ["a Saturday free-posture event in force (S7a, L25)", SATURDAY, [eventOn("2026-10-10", "free")]],
    ["a weekday free-posture event in force (S7a, L25)", MONDAY, [eventOn("2026-10-12", "free")]],
  ] as const)("a R20.00 cappuccino replayed on %s → 'free', R0, line zeroed", async (_l, now, sessions) => {
    vi.setSystemTime(now);
    given([...sessions] as GivenSession[]);
    const res = await applyOutboxItem(entry(1, 2000));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 0 });
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "free", totalZar: 0 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).toMatchObject({ unitPriceZar: 2000, discountZar: 2000, surchargeZar: 0 });
  });

  it("the same entry replayed on a Sunday stays 'yoco_deferred' at R20.00 (unchanged)", async () => {
    given(["sunday"]);
    const res = await applyOutboxItem(entry(1, 2000));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "yoco_deferred", totalZar: 2000 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).not.toHaveProperty("discountZar");
  });
});

// DEC-28 offline replay (owner, Mia, 11 Nov 2026): the mode an offline order
// is replayed under is the one in force when it was RUNG — the outbox entry's
// clientTimestamp — not the server's receipt time. The revenue day stays the
// receipt day (REQ-039). A client time in the future, or older than REQ-039's
// 12 hours, is not trusted: the receipt time is used, as before.
describe("applyOutboxItem — the mode at the client's ring-up time (DEC-28)", () => {
  // Wednesday 14 Oct 2026, an event 08:00–12:00 SAST.
  const at = (iso: string) => ({ ...entry(1, 2000), clientTimestamp: new Date(iso).toISOString() });

  it("rung at 11:30 inside a free event, replayed at 12:30 after it ended → 'free', R0, stamped", async () => {
    vi.setSystemTime(new Date("2026-10-14T12:30:00+02:00"));
    given([eventOn("2026-10-14", "free")]);
    const res = await applyOutboxItem(at("2026-10-14T11:30:00+02:00"));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 0 });
    expect(insertsInto(orders)[0]).toMatchObject({
      paymentMode: "free", totalZar: 0, eventWindowId: "evw_2026-10-14_free", revenueDay: "2026-10-14",
    });
    expect((insertsInto(orderItems)[0] as Row[])[0]).toMatchObject({ unitPriceZar: 2000, discountZar: 2000 });
  });

  it("rung inside a paid event, replayed after it → owed 'yoco_deferred' R20.00, stamped with the event", async () => {
    vi.setSystemTime(new Date("2026-10-14T12:30:00+02:00"));
    given([eventOn("2026-10-14", "standard")]);
    const res = await applyOutboxItem(at("2026-10-14T11:30:00+02:00"));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "yoco_deferred", totalZar: 2000, eventWindowId: "evw_2026-10-14_standard" });
  });

  it("REQ-039: rung 23:50 at a free event, replayed 00:10 → free and stamped, but the revenue day is the receipt day", async () => {
    vi.setSystemTime(new Date("2026-10-15T00:10:00+02:00"));
    given([{
      mode: "event",
      window: { ...eventOn("2026-10-14", "free").window, startsAt: new Date("2026-10-14T20:00:00+02:00"), endsAt: new Date("2026-10-14T23:59:00+02:00") },
    }]);
    const res = await applyOutboxItem(at("2026-10-14T23:50:00+02:00"));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 0 });
    // REQ-039: placed_at and revenue_day both key on the RECEIPT (00:10, the
    // 15th); the client's 23:50 only picked the mode and is in the audit row.
    expect(insertsInto(orders)[0]).toMatchObject({
      paymentMode: "free", eventWindowId: "evw_2026-10-14_free", revenueDay: "2026-10-15",
      placedAt: new Date("2026-10-15T00:10:00+02:00"),
    });
  });

  it("a client time AFTER the receipt is not trusted — the receipt time decides", async () => {
    vi.setSystemTime(new Date("2026-10-14T11:30:00+02:00"));
    given([eventOn("2026-10-14", "standard")]);
    await applyOutboxItem(at("2026-10-14T12:30:00+02:00")); // after the window, and in the future
    expect(insertsInto(orders)[0]).toMatchObject({ eventWindowId: "evw_2026-10-14_standard", paymentMode: "yoco_deferred" });
  });

  // SAFE DEFAULT (owner has not ruled): the client clock may never turn a paid
  // order free. Free at the client's time + paid at receipt → receipt time.
  it("free event at the client's 11:30, a paid event in force at the 12:30 receipt → the receipt decides: owed, stamped paid", async () => {
    vi.setSystemTime(new Date("2026-10-14T12:30:00+02:00"));
    const paid = eventOn("2026-10-14", "standard");
    given([
      eventOn("2026-10-14", "free"),
      { mode: "event", window: { ...paid.window, startsAt: new Date("2026-10-14T12:00:00+02:00"), endsAt: new Date("2026-10-14T16:00:00+02:00") } },
    ]);
    const res = await applyOutboxItem(at("2026-10-14T11:30:00+02:00"));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
    expect(insertsInto(orders)[0]).toMatchObject({
      paymentMode: "yoco_deferred", totalZar: 2000, eventWindowId: "evw_2026-10-14_standard",
      placedAt: new Date("2026-10-14T12:30:00+02:00"),
    });
  });

  it("free at the client's Saturday 23:50 event, Sunday at the 00:10 receipt → the receipt decides: owed R20.00", async () => {
    vi.setSystemTime(new Date("2026-10-11T00:10:00+02:00"));
    given([
      "sunday",
      { mode: "event", window: { ...eventOn("2026-10-10", "free").window, startsAt: new Date("2026-10-10T20:00:00+02:00"), endsAt: new Date("2026-10-10T23:59:00+02:00") } },
    ]);
    const res = await applyOutboxItem(at("2026-10-10T23:50:00+02:00"));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "yoco_deferred", totalZar: 2000, eventWindowId: null });
  });

  // CHANGED (second review, B1): placed_at is the receipt time again (REQ-039);
  // the client-time instant lives only in the audit row.
  it("the sync_applied audit row always carries clientTimestamp, modeAt and eventWindowId; placed_at is the receipt", async () => {
    vi.setSystemTime(new Date("2026-10-14T12:30:00+02:00"));
    given([eventOn("2026-10-14", "free")]);
    await applyOutboxItem(at("2026-10-14T11:30:00+02:00"));
    const row = vi.mocked(writeAudit).mock.calls.filter((c) => (c[0] as Row).action === "order.sync_applied").pop()?.[0] as Row;
    expect(row.after).toMatchObject({
      clientTimestamp: new Date("2026-10-14T11:30:00+02:00").toISOString(),
      modeAt: new Date("2026-10-14T11:30:00+02:00").toISOString(),
      eventWindowId: "evw_2026-10-14_free",
    });
    expect(insertsInto(orders)[0]).toMatchObject({ placedAt: new Date("2026-10-14T12:30:00+02:00"), revenueDay: "2026-10-14" });
  });

  it("a client time more than 12 hours old (REQ-039) is not used — the receipt time decides", async () => {
    vi.setSystemTime(new Date("2026-10-15T00:30:00+02:00"));
    given([eventOn("2026-10-14", "standard")]);
    await applyOutboxItem(at("2026-10-14T11:30:00+02:00")); // 13 h before receipt
    expect(insertsInto(orders)[0]).toMatchObject({ eventWindowId: null });
  });
});
