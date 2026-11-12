// §9.6.2 job 8 — the deferred-mode reminder (REQ-005, S2a, DEC-29).
// "an Admin push fires within one minute, and again every 30 minutes the
// session stays deferred". The push itself is remindDeferredSessions
// (src/server/deferred/drizzle-store.ts, #327); this is its timer gate.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/deferred/drizzle-store", () => ({
  readDeferredReminderCandidates: vi.fn(),
  remindDeferredSessions: vi.fn(),
}));

import {
  dueDeferredSessionIds,
  runDeferredReminder,
  shouldRunDeferredReminder,
  type DeferredReminderDeps,
} from "@/server/jobs/deferred-reminder";

const T = (iso: string) => new Date(iso);
// Sun 8 Nov 2026: deferred mode entered at 09:00 SAST (07:00Z).
const ENTERED = T("2026-11-08T07:00:00Z");

function deps(cands: { sessionId: string; lastPushAt: Date }[], sent = 1): DeferredReminderDeps & { remind: ReturnType<typeof vi.fn> } {
  return { candidates: async () => cands, remind: vi.fn(async () => sent) };
}

describe("dueDeferredSessionIds (REQ-005: every 30 minutes the session stays deferred)", () => {
  it("is not due 29 minutes after the entry push", () => {
    expect(dueDeferredSessionIds([{ sessionId: "s1", lastPushAt: ENTERED }], T("2026-11-08T07:29:00Z"))).toEqual([]);
  });

  it("is due 30 minutes after the entry push", () => {
    expect(dueDeferredSessionIds([{ sessionId: "s1", lastPushAt: ENTERED }], T("2026-11-08T07:30:00Z"))).toEqual(["s1"]);
  });

  it("measures from the last repeat, not the entry: due again at 60, not at 59", () => {
    const lastRepeat = T("2026-11-08T07:30:00Z");
    expect(dueDeferredSessionIds([{ sessionId: "s1", lastPushAt: lastRepeat }], T("2026-11-08T07:59:00Z"))).toEqual([]);
    expect(dueDeferredSessionIds([{ sessionId: "s1", lastPushAt: lastRepeat }], T("2026-11-08T08:00:00Z"))).toEqual(["s1"]);
  });

  it("a missed firing delays the repeat and never cancels it (age from the last push)", () => {
    expect(dueDeferredSessionIds([{ sessionId: "s1", lastPushAt: ENTERED }], T("2026-11-08T07:47:00Z"))).toEqual(["s1"]);
  });
});

describe("shouldRunDeferredReminder — the scheduler gate", () => {
  it("no deferred session open: not a run (no run row, no audit, no push)", async () => {
    const d = deps([]);
    expect(await shouldRunDeferredReminder(T("2026-11-08T07:30:00Z"), d)).toBe(false);
  });

  it("a deferred session open but not yet due: not a run", async () => {
    const d = deps([{ sessionId: "s1", lastPushAt: ENTERED }]);
    expect(await shouldRunDeferredReminder(T("2026-11-08T07:10:00Z"), d)).toBe(false);
  });

  it("a deferred session due a repeat: a run", async () => {
    const d = deps([{ sessionId: "s1", lastPushAt: ENTERED }]);
    expect(await shouldRunDeferredReminder(T("2026-11-08T07:30:00Z"), d)).toBe(true);
  });
});

describe("runDeferredReminder", () => {
  it("delegates to remindDeferredSessions at the firing time and reports the count", async () => {
    const d = deps([{ sessionId: "s1", lastPushAt: ENTERED }], 1);
    const firedAt = T("2026-11-08T07:30:00Z");
    expect(await runDeferredReminder(firedAt, d)).toEqual({ reminded: 1 });
    expect(d.remind).toHaveBeenCalledWith(firedAt);
  });
});
