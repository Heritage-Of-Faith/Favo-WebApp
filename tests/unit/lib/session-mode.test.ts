// AT-181: opening_sessions.mode is defaulted from the session date.
// PRD §4.2: Monday–Friday → Weekday; Sunday → Sunday; Saturday → "No default —
// the café is closed unless an event says otherwise".
// AT-204 prerequisite: §6.6 precedence, L18 (a session's own window, COL-8),
// L27 (24 h cap), REQ-042 (reverts on read, no job), REQ-057 (Saturday).
import { describe, it, expect } from "vitest";
import {
  defaultSessionMode, SATURDAY_CLOSED, resolveSessionMode, effectiveSessionMode,
  eventSwitchesInForce, validateWindowSpan, describeEvent, forcedCloseAt, sastInstant,
  profileOccurrence, type EventWindowView, type EventProfileView,
} from "@/lib/session-mode";

describe("defaultSessionMode", () => {
  it("Monday to Friday are weekday", () => {
    // 5–9 Oct 2026 is Mon–Fri.
    for (const d of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]) {
      expect(defaultSessionMode(d)).toBe("weekday");
    }
  });

  it("Sunday is sunday", () => {
    expect(defaultSessionMode("2026-10-11")).toBe("sunday");
  });

  it("Saturday has no default mode (never 'event' by default)", () => {
    expect(defaultSessionMode("2026-10-10")).toBeNull();
  });

  it("rejects a malformed date rather than guessing", () => {
    expect(() => defaultSessionMode("not-a-date")).toThrow();
  });

  // CHANGED (AT-204): events now exist, so the message points at Start an event.
  it("the Saturday refusal is a typed code with a plain message", () => {
    expect(SATURDAY_CLOSED.code).toBe("SATURDAY_CLOSED");
    expect(SATURDAY_CLOSED.message).toBe(
      "The café is closed on Saturdays unless an event is set up. Tap Start an event."
    );
  });
});

const SWITCHES_STANDARD = {
  menuScope: "full", paymentPosture: "standard", consumesCupLid: true,
  audience: "both", extraShotSurcharge: true, voucherKinds: ["untracked_hot_drink"],
} as const;

function windowOf(over: Partial<EventWindowView> = {}): EventWindowView {
  return {
    id: "evw_1", name: "Untracked Church", eventProfileId: null,
    startsAt: "2026-10-11T16:00:00.000Z", // 18:00 SAST
    endsAt: "2026-10-11T18:30:00.000Z",   // 20:30 SAST
    ...SWITCHES_STANDARD, voucherKinds: [...SWITCHES_STANDARD.voucherKinds],
    ...over,
  };
}

function profileOf(over: Partial<EventProfileView> = {}): EventProfileView {
  return {
    id: "evp_social", name: "Wednesday Social", recurrence: "FREQ=WEEKLY;BYDAY=WE",
    defaultStart: "18:30", defaultEnd: "20:30",
    ...SWITCHES_STANDARD, voucherKinds: [],
    ...over,
  };
}

describe("sastInstant", () => {
  it("reads a wall-clock time in Africa/Johannesburg (UTC+2)", () => {
    expect(sastInstant("2026-10-11", "18:00").toISOString()).toBe("2026-10-11T16:00:00.000Z");
  });
});

describe("resolveSessionMode — §6.6 precedence and L18", () => {
  it("absent any event, the date decides", () => {
    expect(resolveSessionMode({ sessionDate: "2026-10-07", opensAt: "07:30", closesAt: null, windows: [], profiles: [] }))
      .toEqual({ kind: "date", mode: "weekday" });
    expect(resolveSessionMode({ sessionDate: "2026-10-11", opensAt: "07:30", closesAt: null, windows: [], profiles: [] }))
      .toEqual({ kind: "date", mode: "sunday" });
  });

  it("REQ-057: a Saturday with no event window is closed, never a mode", () => {
    expect(resolveSessionMode({ sessionDate: "2026-10-10", opensAt: "10:00", closesAt: null, windows: [], profiles: [] }))
      .toEqual({ kind: "closed" });
  });

  it("a Saturday session inside an event window is an event", () => {
    const w = windowOf({ id: "evw_sat", startsAt: "2026-10-10T08:00:00.000Z", endsAt: "2026-10-10T12:00:00.000Z" });
    const r = resolveSessionMode({ sessionDate: "2026-10-10", opensAt: "10:00", closesAt: null, windows: [w], profiles: [] });
    expect(r).toMatchObject({ kind: "event", source: "window", overridesSunday: false });
    if (r.kind === "event" && r.source === "window") expect(r.window.id).toBe("evw_sat");
  });

  it("COL-8: the session's own window decides — a Sunday morning does not inherit the evening's event", () => {
    const w = windowOf();
    expect(resolveSessionMode({ sessionDate: "2026-10-11", opensAt: "07:30", closesAt: null, windows: [w], profiles: [] }))
      .toEqual({ kind: "date", mode: "sunday" });
    // A planned morning session with a known close also stays Sunday.
    expect(resolveSessionMode({ sessionDate: "2026-10-11", opensAt: "07:30", closesAt: "11:00", windows: [w], profiles: [] }))
      .toEqual({ kind: "date", mode: "sunday" });
  });

  it("an event beats Sunday, and overriding a Sunday is flagged for the confirm step", () => {
    const r = resolveSessionMode({ sessionDate: "2026-10-11", opensAt: "18:00", closesAt: null, windows: [windowOf()], profiles: [] });
    expect(r).toMatchObject({ kind: "event", source: "window", overridesSunday: true });
  });

  it("a planned session whose window overlaps an event is an event", () => {
    const r = resolveSessionMode({ sessionDate: "2026-10-11", opensAt: "17:45", closesAt: "21:00", windows: [windowOf()], profiles: [] });
    expect(r).toMatchObject({ kind: "event", source: "window" });
  });

  it("a recurring profile is found on its day, inside its default window", () => {
    const r = resolveSessionMode({ sessionDate: "2026-10-07", opensAt: "18:30", closesAt: null, windows: [], profiles: [profileOf()] });
    expect(r).toMatchObject({ kind: "event", source: "profile", overridesSunday: false });
    if (r.kind === "event" && r.source === "profile") {
      expect(r.profile.id).toBe("evp_social");
      expect(r.startsAt).toBe("2026-10-07T16:30:00.000Z");
      expect(r.endsAt).toBe("2026-10-07T18:30:00.000Z");
    }
    // Not on a Thursday.
    expect(resolveSessionMode({ sessionDate: "2026-10-08", opensAt: "18:30", closesAt: null, windows: [], profiles: [profileOf()] }))
      .toEqual({ kind: "date", mode: "weekday" });
  });

  it("precedence 1: a one-off window beats a recurring profile on the same date", () => {
    const w = windowOf({ id: "evw_oneoff", name: "Baptism Social", startsAt: "2026-10-07T16:00:00.000Z", endsAt: "2026-10-07T19:00:00.000Z" });
    const r = resolveSessionMode({ sessionDate: "2026-10-07", opensAt: "18:30", closesAt: null, windows: [w], profiles: [profileOf()] });
    expect(r).toMatchObject({ kind: "event", source: "window" });
  });

  it("a profile with no default times is never auto-found (Untracked Church times are unconfirmed)", () => {
    const p = profileOf({ recurrence: "FREQ=WEEKLY;BYDAY=SU", defaultStart: null, defaultEnd: null });
    expect(profileOccurrence(p, "2026-10-11")).toBeNull();
    expect(resolveSessionMode({ sessionDate: "2026-10-11", opensAt: "18:00", closesAt: null, windows: [], profiles: [p] }))
      .toEqual({ kind: "date", mode: "sunday" });
  });

  it("a free or event-price window is not applied while the till cannot honour it", () => {
    const free = profileOf({ paymentPosture: "free" });
    expect(resolveSessionMode({ sessionDate: "2026-10-07", opensAt: "18:30", closesAt: null, windows: [], profiles: [free] }))
      .toEqual({ kind: "date", mode: "weekday" });
  });
});

describe("REQ-042: reversion is read, not written — no job involved", () => {
  const w = windowOf();
  const session = { sessionDate: "2026-10-11", mode: "event" as const };

  it("in force before ends_at", () => {
    const now = new Date("2026-10-11T18:29:59.000Z");
    expect(effectiveSessionMode(session, w, now)).toBe("event");
    expect(eventSwitchesInForce(w, now)).toMatchObject({ paymentPosture: "standard", consumesCupLid: true });
  });

  it("after ends_at mode and all six switches revert to the date default", () => {
    const now = new Date("2026-10-11T18:30:00.000Z");
    expect(effectiveSessionMode(session, w, now)).toBe("sunday");
    expect(eventSwitchesInForce(w, now)).toBeNull();
  });

  it("no event leaks into the next day", () => {
    expect(effectiveSessionMode(session, w, new Date("2026-10-12T06:00:00.000Z"))).toBe("sunday");
    expect(eventSwitchesInForce(w, new Date("2026-10-12T06:00:00.000Z"))).toBeNull();
  });

  it("a non-event session reads as stored", () => {
    expect(effectiveSessionMode({ sessionDate: "2026-10-07", mode: "weekday" }, null, new Date())).toBe("weekday");
  });
});

describe("forcedCloseAt — L07 day boundary and COL-11 window expiry", () => {
  it("a session from a past revenue day closes at the next SAST midnight", () => {
    const at = forcedCloseAt({ sessionDate: "2026-10-10" }, null, "2026-10-11", new Date("2026-10-11T05:00:00.000Z"));
    expect(at?.toISOString()).toBe("2026-10-10T22:00:00.000Z");
  });

  it("a session bound to an expired window closes at ends_at", () => {
    const at = forcedCloseAt({ sessionDate: "2026-10-11" }, windowOf(), "2026-10-11", new Date("2026-10-11T19:00:00.000Z"));
    expect(at?.toISOString()).toBe("2026-10-11T18:30:00.000Z");
  });

  it("a current session is not forced closed", () => {
    expect(forcedCloseAt({ sessionDate: "2026-10-11" }, windowOf(), "2026-10-11", new Date("2026-10-11T17:00:00.000Z"))).toBeNull();
  });
});

describe("validateWindowSpan — L27 / REQ-043", () => {
  const start = new Date("2026-10-10T08:00:00.000Z");
  it("exactly 24 hours is allowed", () => {
    expect(validateWindowSpan(start, new Date("2026-10-11T08:00:00.000Z"))).toBeNull();
  });
  it("longer than 24 hours is rejected", () => {
    expect(validateWindowSpan(start, new Date("2026-10-11T08:00:01.000Z"))).toMatch(/24 hours/);
  });
  it("an end at or before the start is rejected", () => {
    expect(validateWindowSpan(start, start)).not.toBeNull();
  });
});

describe("describeEvent — L18 / §6.6 Path A copy", () => {
  it("names the Discipleship 101 profile as §6.6 writes it", () => {
    expect(describeEvent("Discipleship 101", {
      paymentPosture: "free", consumesCupLid: true, audience: "church_member",
    }, "2026-10-07T18:30:00.000Z")).toBe("Discipleship 101 · Event · free · disposables · Church Member · until 20:30");
  });
});
