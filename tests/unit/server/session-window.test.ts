// AT-209 / §6.11.1: the current session is the last one to have opened; it runs
// to the next session's opening (the first from midnight SAST, the last to
// the end of the revenue day). L33 counts comps inside this window.

import { describe, it, expect } from "vitest";
import { currentSessionWindow } from "@/server/orders/session-window";

const DAY = "2026-10-25"; // a Sunday

describe("currentSessionWindow", () => {
  it("no session today → null (NO_SESSION)", () => {
    expect(currentSessionWindow(DAY, [], new Date("2026-10-25T07:00:00Z"))).toBeNull();
  });

  it("one session covers the whole revenue day", () => {
    const w = currentSessionWindow(DAY, ["07:50"], new Date("2026-10-25T08:00:00Z"));
    expect(w).toEqual({
      opensAt: "07:50",
      from: new Date("2026-10-24T22:00:00Z"),
      to: new Date("2026-10-25T22:00:00Z"),
    });
  });

  it("morning and evening sessions are separate windows", () => {
    const morning = currentSessionWindow(DAY, ["17:30", "07:50"], new Date("2026-10-25T07:00:00Z")); // 09:00 SAST
    expect(morning).toEqual({ opensAt: "07:50", from: new Date("2026-10-24T22:00:00Z"), to: new Date("2026-10-25T15:30:00Z") });
    const evening = currentSessionWindow(DAY, ["07:50", "17:30"], new Date("2026-10-25T16:00:00Z")); // 18:00 SAST
    expect(evening).toEqual({ opensAt: "17:30", from: new Date("2026-10-25T15:30:00Z"), to: new Date("2026-10-25T22:00:00Z") });
  });
});
