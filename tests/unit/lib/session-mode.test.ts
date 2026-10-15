// AT-181: opening_sessions.mode is defaulted from the session date.
// PRD §4.2: Monday–Friday → Weekday; Sunday → Sunday; Saturday → "No default —
// the café is closed unless an event says otherwise".
import { describe, it, expect } from "vitest";
import { defaultSessionMode, SATURDAY_CLOSED } from "@/lib/session-mode";

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

  it("the Saturday refusal is a typed code with a plain message", () => {
    expect(SATURDAY_CLOSED.code).toBe("SATURDAY_CLOSED");
    expect(SATURDAY_CLOSED.message).toBe(
      "The café is closed on Saturdays unless an event is set up. Events aren't available yet."
    );
  });
});
