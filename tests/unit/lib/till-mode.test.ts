// The mode and event switches at an instant — PRD v7.0 §6.6 (precedence 2,
// the six switches), §4.2, L24, L25, L26, REQ-042, §6.0.8 (T7).
import { describe, it, expect } from "vitest";
import {
  resolveTillMode, isEventFree, menuScopeAllows, offMenuScopeMessage, tillConsumesCupAndLid,
  eventSurchargeInForce, tillEventView, type TillSessionRow,
} from "@/lib/till-mode";
import { resolveSessionMode } from "@/lib/session-mode";

// Wednesday 7 Oct 2026. Discipleship 101: 18:30–20:30 SAST (§6.6 worked example).
const D101_WINDOW = {
  id: "evw_d101", name: "Discipleship 101",
  startsAt: "2026-10-07T16:30:00.000Z", endsAt: "2026-10-07T18:30:00.000Z",
  menuScope: "coffee_only", paymentPosture: "free", consumesCupLid: true,
  audience: "church_member", extraShotSurcharge: false, voucherKinds: [],
} as const;
const WEDNESDAY: TillSessionRow[] = [
  { sessionDate: "2026-10-07", mode: "weekday", window: null },
  { sessionDate: "2026-10-07", mode: "event", window: { ...D101_WINDOW, voucherKinds: [] } },
];
const at = (sast: string) => new Date(`2026-10-07T${sast}:00+02:00`);

describe("resolveTillMode", () => {
  it("09:00 Wednesday: the evening event is not in force — the day reads weekday", () => {
    expect(resolveTillMode(WEDNESDAY, at("09:00"))).toEqual({ modes: ["weekday", "weekday"], event: null });
  });

  it("19:00 Wednesday: Discipleship 101 is in force and beats the date mode (§6.6 precedence 2)", () => {
    const t = resolveTillMode(WEDNESDAY, at("19:00"));
    expect(t.modes).toEqual(["event"]);
    expect(t.event).toMatchObject({
      windowId: "evw_d101", name: "Discipleship 101", menuScope: "coffee_only", paymentPosture: "free",
      consumesCupLid: true, audience: "church_member", extraShotSurcharge: false, voucherKinds: [],
    });
  });

  it("REQ-042: at ends_at (20:30) the event is no longer in force — no job, it is read", () => {
    expect(resolveTillMode(WEDNESDAY, at("20:30")).event).toBeNull();
    expect(resolveTillMode(WEDNESDAY, at("18:30")).event).not.toBeNull(); // starts_at is inclusive
  });

  it("a Saturday event session outside its window reads as no mode (closed)", () => {
    const sat: TillSessionRow[] = [{
      sessionDate: "2026-10-10", mode: "event",
      window: { ...D101_WINDOW, voucherKinds: [], startsAt: "2026-10-10T08:00:00.000Z", endsAt: "2026-10-10T12:00:00.000Z" },
    }];
    expect(resolveTillMode(sat, new Date("2026-10-10T13:00:00.000Z"))).toEqual({ modes: [], event: null });
  });

  it("no session → no modes", () => {
    expect(resolveTillMode([], at("09:00"))).toEqual({ modes: [], event: null });
  });
});

// DEC-28 (a) (owner, Mia, 11 Nov 2026) / §4.2: "an evening session opened at
// 17:45 for an 18:00 service still finds it" — the event applies from the
// SESSION's opening, not from the window's start, and still ends at ends_at.
describe("DEC-28 (a): a bound event applies from the session's opening", () => {
  // Sunday 11 Oct 2026. Untracked Church 18:00–20:30 SAST, paid (standard).
  const UNTRACKED = {
    id: "evw_untracked", name: "Untracked Church",
    startsAt: "2026-10-11T16:00:00.000Z", endsAt: "2026-10-11T18:30:00.000Z",
    menuScope: "full", paymentPosture: "standard", consumesCupLid: true,
    audience: "both", extraShotSurcharge: true, voucherKinds: [] as string[],
    createdAt: "2026-10-11T15:40:00.000Z",
  } as const;
  const SUNDAY: TillSessionRow[] = [
    { sessionDate: "2026-10-11", mode: "sunday", opensAt: "07:30", window: null },
    { sessionDate: "2026-10-11", mode: "event", opensAt: "17:45", window: { ...UNTRACKED, voucherKinds: [] } },
  ];
  const sun = (sast: string) => new Date(`2026-10-11T${sast}:00+02:00`);

  it("17:50, after the 17:45 opening and before the 18:00 start: the event is already in force", () => {
    const t = resolveTillMode(SUNDAY, sun("17:50"));
    expect(t.modes).toEqual(["event"]);
    expect(t.event).toMatchObject({ windowId: "evw_untracked", paymentPosture: "standard" });
  });

  it("17:45 exactly (the opening) is in force; 17:44 is not — the morning reads Sunday", () => {
    expect(resolveTillMode(SUNDAY, sun("17:45")).event?.windowId).toBe("evw_untracked");
    expect(resolveTillMode(SUNDAY, sun("17:44"))).toEqual({ modes: ["sunday", "sunday"], event: null });
    expect(resolveTillMode(SUNDAY, sun("09:00")).event).toBeNull();
  });

  it("REQ-042 still holds: at ends_at (20:30) the event stops applying", () => {
    expect(resolveTillMode(SUNDAY, sun("20:29")).event).not.toBeNull();
    expect(resolveTillMode(SUNDAY, sun("20:30")).event).toBeNull();
  });

  it("the opening step and the till agree: the window resolveSessionMode binds at 17:45 is in force at 17:46", () => {
    const view = { ...UNTRACKED, eventProfileId: null, voucherKinds: [] as string[] };
    const r = resolveSessionMode({ sessionDate: "2026-10-11", opensAt: "17:45", closesAt: null, windows: [view], profiles: [] });
    expect(r).toMatchObject({ kind: "event", source: "window" });
    const bound: TillSessionRow[] = [{ sessionDate: "2026-10-11", mode: "event", opensAt: "17:45", window: { ...UNTRACKED, voucherKinds: [] } }];
    expect(resolveTillMode(bound, sun("17:46")).event?.windowId).toBe("evw_untracked");
    // A 07:30 opening binds nothing, so the morning till never sees the event.
    expect(resolveSessionMode({ sessionDate: "2026-10-11", opensAt: "07:30", closesAt: null, windows: [view], profiles: [] }))
      .toEqual({ kind: "date", mode: "sunday" });
  });

  // Second review (B2): a bound event never applies earlier than
  // EVENT_EARLY_BIND_MINUTES (30) before its window starts, however early
  // the session opened — a 07:00–20:00 Wednesday session bound to an 18:00
  // paid event keeps its morning free cups.
  it("B2: Wednesday session 07:00–20:00 bound to an 18:00 paid event — 10:00 is weekday (free), 17:29 too, 17:30 and 17:35 are the event", () => {
    const PAID = {
      id: "evw_wed_social", name: "Wednesday Social",
      startsAt: "2026-10-07T16:00:00.000Z", endsAt: "2026-10-07T18:00:00.000Z", // 18:00–20:00 SAST
      menuScope: "full", paymentPosture: "standard", consumesCupLid: true,
      audience: "both", extraShotSurcharge: true, voucherKinds: [] as string[],
    } as const;
    const rows: TillSessionRow[] = [{ sessionDate: "2026-10-07", mode: "event", opensAt: "07:00", window: { ...PAID, voucherKinds: [] } }];
    expect(resolveTillMode(rows, at("10:00"))).toEqual({ modes: ["weekday"], event: null });
    expect(resolveTillMode(rows, at("17:29")).event).toBeNull();
    expect(resolveTillMode(rows, at("17:30")).event?.windowId).toBe("evw_wed_social");
    expect(resolveTillMode(rows, at("17:35")).event?.paymentPosture).toBe("standard");
    expect(resolveTillMode(rows, at("20:00")).event).toBeNull();
  });

  it("a session opened after the window start applies from the window start, as before", () => {
    const late: TillSessionRow[] = [{ ...SUNDAY[1], opensAt: "18:15" }];
    expect(resolveTillMode(late, sun("18:05")).event?.windowId).toBe("evw_untracked");
  });
});

// DEC-28 (c) (owner, Mia, 11 Nov 2026): overlapping event windows — the NEWEST
// window wins (created_at descending, then id descending). No overlap refusal.
describe("DEC-28 (c): overlapping windows — newest wins", () => {
  const base = {
    startsAt: "2026-10-10T08:00:00.000Z", endsAt: "2026-10-10T14:00:00.000Z",
    menuScope: "full", consumesCupLid: true, audience: "both",
    extraShotSurcharge: false, voucherKinds: [] as string[],
  } as const;
  const older = { ...base, id: "evw_a", name: "Youth Social", paymentPosture: "standard", createdAt: "2026-10-09T08:00:00.000Z" } as const;
  const newer = { ...base, id: "evw_b", name: "Baptism Social", paymentPosture: "free", createdAt: "2026-10-10T07:00:00.000Z" } as const;
  const sat = new Date("2026-10-10T11:00:00.000Z");
  const row = (w: NonNullable<TillSessionRow["window"]>, opensAt: string): TillSessionRow =>
    ({ sessionDate: "2026-10-10", mode: "event", opensAt, window: { ...w, voucherKinds: [] } });

  it("the most recently created window applies, whatever the session order", () => {
    expect(resolveTillMode([row(older, "10:00"), row(newer, "12:00")], sat).event?.windowId).toBe("evw_b");
    expect(resolveTillMode([row(newer, "12:00"), row(older, "10:00")], sat).event?.windowId).toBe("evw_b");
    expect(resolveTillMode([row(older, "10:00"), row(newer, "12:00")], sat).event?.paymentPosture).toBe("free");
  });

  it("the same created_at: the higher id wins, deterministically", () => {
    const twin = { ...newer, id: "evw_c", name: "Twin", createdAt: newer.createdAt };
    expect(resolveTillMode([row(newer, "10:00"), row(twin, "12:00")], sat).event?.windowId).toBe("evw_c");
    expect(resolveTillMode([row(twin, "12:00"), row(newer, "10:00")], sat).event?.windowId).toBe("evw_c");
  });
});

describe("the switches", () => {
  it("L25: only payment_posture='free' is free", () => {
    expect(isEventFree({ paymentPosture: "free" })).toBe(true);
    expect(isEventFree({ paymentPosture: "standard" })).toBe(false);
    expect(isEventFree({ paymentPosture: "override" })).toBe(false);
    expect(isEventFree(null)).toBe(false);
  });

  it("menu scope: full sells all, coffee-only the coffee category, custom nothing (not built); no event, no limit", () => {
    expect(menuScopeAllows({ menuScope: "full" }, "tea")).toBe(true);
    expect(menuScopeAllows({ menuScope: "coffee_only" }, "coffee")).toBe(true);
    expect(menuScopeAllows({ menuScope: "coffee_only" }, "tea")).toBe(false);
    expect(menuScopeAllows({ menuScope: "custom" }, "coffee")).toBe(false);
    expect(menuScopeAllows(null, "tea")).toBe(true);
  });

  it("§6.0.8 named reason, PRD literal", () => {
    expect(offMenuScopeMessage("Discipleship 101")).toBe("Not on the Discipleship 101 menu");
  });

  it("L24 / L26: cups follow the event's switch, else the mode (weekday → none)", () => {
    expect(tillConsumesCupAndLid(resolveTillMode(WEDNESDAY, at("19:00")))).toBe(true);
    const ownMugs: TillSessionRow[] = [{ ...WEDNESDAY[1], window: { ...D101_WINDOW, voucherKinds: [], consumesCupLid: false } }];
    expect(tillConsumesCupAndLid(resolveTillMode(ownMugs, at("19:00")))).toBe(false);
    expect(tillConsumesCupAndLid(resolveTillMode(WEDNESDAY, at("09:00")))).toBe(false);
    expect(tillConsumesCupAndLid({ modes: ["sunday"], event: null })).toBe(true);
    expect(tillConsumesCupAndLid({ modes: [], event: null })).toBe(true);
  });

  it("§6.6: the surcharge is charged only when switched on, and is inert under free", () => {
    expect(eventSurchargeInForce({ extraShotSurcharge: true, paymentPosture: "standard" })).toBe(true);
    expect(eventSurchargeInForce({ extraShotSurcharge: false, paymentPosture: "standard" })).toBe(false);
    expect(eventSurchargeInForce({ extraShotSurcharge: true, paymentPosture: "free" })).toBe(false);
  });

  it("the POS view carries the name, posture and menu scope only", () => {
    const t = resolveTillMode(WEDNESDAY, at("19:00"));
    expect(tillEventView(t.event)).toEqual({ name: "Discipleship 101", paymentPosture: "free", menuScope: "coffee_only" });
    expect(tillEventView(null)).toBeNull();
  });
});
