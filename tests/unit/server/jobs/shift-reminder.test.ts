// §9.6.2 job 10 — the timed shift-start reminder (§6.3, COL-23; DEC-29).
// SHIFT_REMINDER_LEAD_MINUTES before the day's opening time (operating_hours,
// the Admin's /admin/hours), push the slot-1 rostered barista once. Shares the
// barista_shifts.notified_at claim with the on-open push (src/server/rota/
// shift-start.ts), which stays the fallback and never double-pushes.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/push/send", () => ({ sendShiftReminderPush: vi.fn(), sendShiftStartPush: vi.fn() }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn() }));

import {
  SHIFT_REMINDER_ACTION,
  SHIFT_REMINDER_FAILED_ACTION,
  SHIFT_REMINDER_LEAD_MINUTES,
  SHIFT_START_PUSH_ACTION,
  SHIFT_START_PUSH_FAILED_ACTION,
  runShiftReminders,
  shiftReminderDue,
  shouldRunShiftReminder,
  type ShiftReminderDeps,
} from "@/server/jobs/shift-reminder";
import { buildShiftReminderPayload } from "@/server/push/payload";

const T = (iso: string) => new Date(iso);
const SUB = { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } };
const HOURS = { openTime: "07:30", isClosed: false };
// Sun 8 Nov 2026, SAST = UTC+2.
const at = (sast: string) => T(`2026-11-08T${sast}:00+02:00`);

function deps(over: Partial<ShiftReminderDeps> = {}) {
  const d = {
    openingHour: vi.fn(async () => HOURS),
    unnotifiedFirstSlotShifts: vi.fn(async () => [{ id: "sh1", staffId: "louis", active: true, pushSubscription: SUB }]),
    alreadyAttempted: vi.fn(async () => new Set<string>()),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => {}),
    send: vi.fn(async () => "sent" as const),
    openedSessionOf: vi.fn(async (): Promise<{ sessionId: string; opensAt: string } | null> => null),
    sendOnOpen: vi.fn(async (): Promise<"sent" | "failed" | "gone"> => "sent"),
    audit: vi.fn(async () => {}),
    ...over,
  };
  return d;
}

describe("SHIFT_REMINDER_LEAD_MINUTES", () => {
  it("is 60 minutes (the PRD gives no lead time; author's default, awaiting owner confirmation)", () => {
    expect(SHIFT_REMINDER_LEAD_MINUTES).toBe(60);
  });
});

describe("shiftReminderDue — the pure decision", () => {
  it("not before the lead time: 06:29 for a 07:30 opening", () => {
    expect(shiftReminderDue(at("06:29"), HOURS)).toBe(false);
  });
  it("due from 60 minutes before: 06:30 for a 07:30 opening", () => {
    expect(shiftReminderDue(at("06:30"), HOURS)).toBe(true);
  });
  it("still due a minute before opening (a missed minute delays, never cancels)", () => {
    expect(shiftReminderDue(at("07:29"), HOURS)).toBe(true);
  });
  it("not at or after the opening time: the on-open push is the fallback", () => {
    expect(shiftReminderDue(at("07:30"), HOURS)).toBe(false);
  });
  it("never on a day the Admin marked closed, or with no opening time configured", () => {
    expect(shiftReminderDue(at("06:45"), { openTime: "07:30", isClosed: true })).toBe(false);
    expect(shiftReminderDue(at("06:45"), null)).toBe(false);
  });
});

describe("shouldRunShiftReminder — the scheduler gate", () => {
  it("a run inside the window with an un-notified slot-1 rota row", async () => {
    const d = deps();
    expect(await shouldRunShiftReminder(at("06:30"), d)).toBe(true);
    expect(d.openingHour).toHaveBeenCalledWith(0); // Sunday
    expect(d.unnotifiedFirstSlotShifts).toHaveBeenCalledWith("2026-11-08");
  });
  it("not a run outside the window (no DB read of the rota)", async () => {
    const d = deps();
    expect(await shouldRunShiftReminder(at("05:00"), d)).toBe(false);
    expect(d.unnotifiedFirstSlotShifts).not.toHaveBeenCalled();
  });
  it("not a run when nobody rostered is still un-notified", async () => {
    expect(await shouldRunShiftReminder(at("06:30"), deps({ unnotifiedFirstSlotShifts: vi.fn(async () => []) }))).toBe(false);
  });
  it("an inactive barista, or one with no subscription, is left to the on-open push (which audits them)", async () => {
    const d = deps({
      unnotifiedFirstSlotShifts: vi.fn(async () => [
        { id: "a", staffId: "x", active: false, pushSubscription: SUB },
        { id: "b", staffId: "y", active: true, pushSubscription: null },
      ]),
    });
    expect(await shouldRunShiftReminder(at("06:30"), d)).toBe(false);
  });
  it("a reminder that already failed is not retried every minute", async () => {
    const d = deps({ alreadyAttempted: vi.fn(async () => new Set(["sh1"])) });
    expect(await shouldRunShiftReminder(at("06:30"), d)).toBe(false);
  });
});

describe("runShiftReminders", () => {
  it("claims notified_at, sends once naming the opening time, audits the push", async () => {
    const d = deps();
    expect(await runShiftReminders(at("06:30"), d)).toEqual({ pushed: ["louis"], failed: [] });
    expect(d.claim).toHaveBeenCalledWith("sh1", at("06:30"));
    expect(d.send).toHaveBeenCalledWith(SUB, buildShiftReminderPayload("07:30"));
    expect(d.audit).toHaveBeenCalledWith("sh1", SHIFT_REMINDER_ACTION, expect.objectContaining({ pushed: true, staffId: "louis", openTime: "07:30" }));
  });

  it("no double push: a claim already taken (the on-open push sent it) sends nothing", async () => {
    const d = deps({ claim: vi.fn(async () => false) });
    expect(await runShiftReminders(at("06:30"), d)).toEqual({ pushed: [], failed: [] });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("a failed send releases the claim, so the on-open push is still the fallback", async () => {
    const d = deps({ send: vi.fn(async () => "failed" as const) });
    expect(await runShiftReminders(at("06:30"), d)).toEqual({ pushed: [], failed: ["louis"] });
    expect(d.release).toHaveBeenCalledWith("sh1");
    expect(d.audit).toHaveBeenCalledWith("sh1", SHIFT_REMINDER_FAILED_ACTION, expect.objectContaining({ pushed: false, why: "send_failed" }));
    expect(d.sendOnOpen).not.toHaveBeenCalled(); // no session opened: the on-open push will run when it does
  });

  it("review fix: the reminder failed and the session opened meanwhile (its on-open push saw the claim held) — the on-open push is re-run for that shift", async () => {
    const claim = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    const d = deps({
      claim,
      send: vi.fn(async () => "failed" as const),
      openedSessionOf: vi.fn(async () => ({ sessionId: "os1", opensAt: "07:25" })),
    });
    expect(await runShiftReminders(at("07:20"), d)).toEqual({ pushed: ["louis"], failed: [] });
    expect(d.release).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(d.sendOnOpen).toHaveBeenCalledWith(SUB, "07:25");
    expect(d.audit).toHaveBeenCalledWith("sh1", SHIFT_START_PUSH_ACTION, expect.objectContaining({ pushed: true, via: "reminder_fallback", sessionId: "os1" }));
  });

  it("the re-run never double-pushes: if the on-open push took the claim after the release, nothing more is sent", async () => {
    const claim = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const d = deps({
      claim,
      send: vi.fn(async () => "failed" as const),
      openedSessionOf: vi.fn(async () => ({ sessionId: "os1", opensAt: "07:25" })),
    });
    expect(await runShiftReminders(at("07:20"), d)).toEqual({ pushed: [], failed: ["louis"] });
    expect(d.sendOnOpen).not.toHaveBeenCalled();
  });

  it("the re-run also failing gives the claim back again and is audited as the on-open push's failure", async () => {
    const d = deps({
      send: vi.fn(async () => "failed" as const),
      openedSessionOf: vi.fn(async () => ({ sessionId: "os1", opensAt: "07:25" })),
      sendOnOpen: vi.fn(async () => "gone" as const),
    });
    expect(await runShiftReminders(at("07:20"), d)).toEqual({ pushed: [], failed: ["louis"] });
    expect(d.release).toHaveBeenCalledTimes(2);
    expect(d.audit).toHaveBeenCalledWith("sh1", SHIFT_START_PUSH_FAILED_ACTION, expect.objectContaining({ pushed: false, why: "subscription_gone", via: "reminder_fallback" }));
  });
});

describe("buildShiftReminderPayload", () => {
  it("says 'You are on duty today at <time>' (author wording, DEC-29) and opens the POS", () => {
    const p = JSON.parse(buildShiftReminderPayload("07:30"));
    expect(p.body).toBe("You are on duty today at 07:30.");
    expect(p.data.url).toBe("/pos");
    // Same tag as the on-open push: a device that somehow got both shows one.
    expect(p.tag).toBe("favo-shift-start");
  });
});
