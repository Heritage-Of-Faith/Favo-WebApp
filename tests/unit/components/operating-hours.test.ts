// AT-67 (N15): open-now status computed against a synthetic clock.
// computeOpenStatus is pure — no real Date — so we can assert each branch.

import { describe, it, expect } from "vitest";
import { computeOpenStatus } from "@/components/shared/OperatingHours";
import type { OperatingHour } from "@/lib/types";

// Mon–Fri 09:00–17:00, Sat closed, Sun 07:00–15:00.
const HOURS: OperatingHour[] = [
  { dayOfWeek: 0, opensAt: "07:00", closesAt: "15:00", isClosed: false },
  { dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 2, opensAt: "09:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 3, opensAt: "09:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 4, opensAt: "09:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 5, opensAt: "09:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 6, opensAt: "00:00", closesAt: "00:00", isClosed: true },
];

const at = (h: number, m = 0) => h * 60 + m;

describe("computeOpenStatus", () => {
  it("is open during business hours", () => {
    const s = computeOpenStatus(HOURS, { dayOfWeek: 3, minutes: at(12) }); // Wed noon
    expect(s.isOpen).toBe(true);
    expect(s.label).toBe("Open now · until 17:00");
  });

  it("is closed before opening, and says when it opens today", () => {
    const s = computeOpenStatus(HOURS, { dayOfWeek: 3, minutes: at(8) }); // Wed 08:00
    expect(s.isOpen).toBe(false);
    expect(s.label).toBe("Opens today at 09:00");
  });

  it("after close, points to tomorrow", () => {
    const s = computeOpenStatus(HOURS, { dayOfWeek: 3, minutes: at(18) }); // Wed 18:00
    expect(s.isOpen).toBe(false);
    expect(s.label).toBe("Opens tomorrow at 09:00");
  });

  it("on a closed day, names the next open day", () => {
    const s = computeOpenStatus(HOURS, { dayOfWeek: 6, minutes: at(10) }); // Sat (closed)
    expect(s.isOpen).toBe(false);
    expect(s.label).toBe("Opens tomorrow at 07:00"); // Sunday
  });

  it("is open exactly at opening minute and closed exactly at closing minute", () => {
    expect(computeOpenStatus(HOURS, { dayOfWeek: 1, minutes: at(9) }).isOpen).toBe(true);
    expect(computeOpenStatus(HOURS, { dayOfWeek: 1, minutes: at(17) }).isOpen).toBe(false);
  });

  it("never uses time-gate / ordering-blocked language (L04)", () => {
    for (let dow = 0; dow <= 6; dow++) {
      for (const min of [at(6), at(10), at(16, 30), at(23)]) {
        const label = computeOpenStatus(HOURS, { dayOfWeek: dow, minutes: min }).label.toLowerCase();
        expect(label).not.toMatch(/unavailable|can'?t order|cannot order|ordering closed|no orders/);
      }
    }
  });
});
