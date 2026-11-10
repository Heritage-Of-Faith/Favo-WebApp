// The mode and event switches at an instant — PRD v7.0 §6.6 (precedence 2,
// the six switches), §4.2, L24, L25, L26, REQ-042, §6.0.8 (T7).
import { describe, it, expect } from "vitest";
import {
  resolveTillMode, isEventFree, menuScopeAllows, offMenuScopeMessage, tillConsumesCupAndLid,
  eventSurchargeInForce, tillEventView, type TillSessionRow,
} from "@/lib/till-mode";

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
