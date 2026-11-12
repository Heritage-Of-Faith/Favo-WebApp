// §9.6.2 job 9 — the 09:00 Yoco import reminder (REQ-067, job 6's "Who is
// told", DEC-29). "When 09:00 with no import · Then an Admin push names the
// day and repeats daily until resolved." No automatic fetch from Yoco: the
// import is the Admin's upload at /admin/reports (§11.2).

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/jobs/store", () => ({ auditJobStore: {} }));
vi.mock("@/server/jobs/alert", () => ({ pushAdmins: vi.fn() }));
vi.mock("@/server/reconciliation/read", () => ({ latestImports: vi.fn() }));

import {
  IMPORT_WATCH_DAYS,
  YOCO_IMPORT_WATCH_JOB,
  buildMissingImportPayload,
  cardActivityDays,
  checkMissingImports,
  daysMissingImport,
  shouldRunImportWatch,
  type ImportWatchDeps,
} from "@/server/jobs/import-watch";

const T = (iso: string) => new Date(iso);
// Tue 10 Nov 2026 09:00 SAST
const NOW = T("2026-11-10T07:00:00Z");
// The scheduler first started Sat 7 Nov: 7, 8, 9 Nov are in scope.
const FIRST_START = T("2026-11-07T08:00:00Z");

const SAT = "2026-11-07";
const SUN = "2026-11-08";
const MON = "2026-11-09";

function deps(over: Partial<ImportWatchDeps> = {}): ImportWatchDeps & { push: ReturnType<typeof vi.fn> } {
  return {
    firstStartedAt: async () => FIRST_START,
    hasRun: async () => false,
    paymentsOn: async () => [{ day: SUN, status: "successful", sent: true }],
    sessionsOn: async () => [],
    importedDays: async () => new Set(),
    push: vi.fn(async () => {}),
    ...over,
  } as ImportWatchDeps & { push: ReturnType<typeof vi.fn> };
}

describe("daysMissingImport — the pure decision", () => {
  const base = { days: [SAT, SUN, MON], cardActivityDays: new Set<string>(), sessions: [], importedDays: new Set<string>() };

  it("a Sunday with card activity and no import is missing", () => {
    expect(daysMissingImport({ ...base, cardActivityDays: new Set([SUN]) })).toEqual([SUN]);
  });

  it("a Sunday with an import is not missing", () => {
    expect(daysMissingImport({ ...base, cardActivityDays: new Set([SUN]), importedDays: new Set([SUN]) })).toEqual([]);
  });

  it("a Sunday with no card activity at all is not missing (nothing to reconcile)", () => {
    expect(daysMissingImport(base)).toEqual([]);
  });

  it("a weekday is not a paid day: card activity on it does not ask for an export", () => {
    expect(daysMissingImport({ ...base, cardActivityDays: new Set([MON]) })).toEqual([]);
  });

  it("a Saturday with a paying event session and card activity is missing", () => {
    const sessions = [{ sessionDate: SAT, mode: "event", eventPaymentPosture: "standard" }];
    expect(daysMissingImport({ ...base, sessions, cardActivityDays: new Set([SAT]) })).toEqual([SAT]);
  });

  it("an event with a free posture is not a paid day", () => {
    const sessions = [{ sessionDate: SAT, mode: "event", eventPaymentPosture: "free" }];
    expect(daysMissingImport({ ...base, sessions, cardActivityDays: new Set([SAT]) })).toEqual([]);
  });

  it("a weekday paid event (DEC-28 b) with card activity is missing", () => {
    const sessions = [{ sessionDate: MON, mode: "event", eventPaymentPosture: "override" }];
    expect(daysMissingImport({ ...base, sessions, cardActivityDays: new Set([MON]) })).toEqual([MON]);
  });
});

describe("cardActivityDays — what counts as card activity (review fix)", () => {
  it("a successful payment counts", () => {
    expect(cardActivityDays([{ day: SUN, status: "successful", sent: true }])).toEqual(new Set([SUN]));
  });
  it("an attempt that was actually sent counts, whatever its status", () => {
    expect(cardActivityDays([{ day: SUN, status: "unresolved", sent: true }])).toEqual(new Set([SUN]));
    expect(cardActivityDays([{ day: SUN, status: "declined", sent: true }])).toEqual(new Set([SUN]));
  });
  it("an attempt never sent to the machine does not count, so the day is not nagged for it", () => {
    expect(cardActivityDays([{ day: SUN, status: "declined", sent: false }])).toEqual(new Set());
    expect(cardActivityDays([{ day: SUN, status: "pending", sent: false }])).toEqual(new Set());
  });
});

describe("the look-back is bounded (review fix)", () => {
  it("checks at most the last 14 completed days", async () => {
    expect(IMPORT_WATCH_DAYS).toBe(14);
    const sessionsOn = vi.fn(async () => []);
    const d = deps({ firstStartedAt: async () => T("2026-01-01T08:00:00Z"), sessionsOn });
    const r = await checkMissingImports(NOW, d);
    expect(r.checked).toBe(14);
    const days = (sessionsOn.mock.calls[0] as unknown as [string[]])[0];
    expect(days[0]).toBe("2026-10-27");
    expect(days.at(-1)).toBe("2026-11-09");
  });

  it("a Sunday older than 14 days is no longer named", async () => {
    const d = deps({ paymentsOn: async () => [{ day: "2026-10-25", status: "successful", sent: true }], firstStartedAt: async () => T("2026-01-01T08:00:00Z") });
    expect((await checkMissingImports(NOW, d)).missing).toEqual([]);
  });
});

describe("checkMissingImports — one Admin push naming the day", () => {
  it("pushes once, naming the un-imported day", async () => {
    const d = deps();
    expect(await checkMissingImports(NOW, d)).toEqual({ checked: 3, missing: [SUN] });
    expect(d.push).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(d.push.mock.calls[0][0]);
    expect(payload.body).toContain(`Yoco export for ${SUN} has not been uploaded`);
    expect(payload.data).toMatchObject({ missing: [SUN], url: "/admin/reports" });
    expect(d.push.mock.calls[0][1]).toBe(YOCO_IMPORT_WATCH_JOB);
  });

  it("repeats daily until uploaded: the next morning still names the same day", async () => {
    const d = deps();
    const nextMorning = T("2026-11-11T07:00:00Z");
    expect((await checkMissingImports(nextMorning, d)).missing).toEqual([SUN]);
    expect(d.push).toHaveBeenCalledTimes(1);
  });

  it("silent once uploaded", async () => {
    const d = deps({ importedDays: async () => new Set([SUN]) });
    expect((await checkMissingImports(NOW, d)).missing).toEqual([]);
    expect(d.push).not.toHaveBeenCalled();
  });

  it("nothing before the scheduler's first start, and nothing if it never started", async () => {
    const d = deps({ firstStartedAt: async () => null });
    expect(await checkMissingImports(NOW, d)).toEqual({ checked: 0, missing: [] });
    expect(d.push).not.toHaveBeenCalled();
  });
});

describe("shouldRunImportWatch — the scheduler gate", () => {
  it("is a run when a paid day is missing its import", async () => {
    expect(await shouldRunImportWatch(NOW, deps())).toBe(true);
  });

  it("is not a run when nothing is missing (no run row, no push)", async () => {
    expect(await shouldRunImportWatch(NOW, deps({ paymentsOn: async () => [] }))).toBe(false);
  });

  it("is idempotent per day: a second firing the same morning is not a run", async () => {
    const hasRun = vi.fn(async () => true);
    expect(await shouldRunImportWatch(NOW, deps({ hasRun }))).toBe(false);
    expect(hasRun).toHaveBeenCalledWith(YOCO_IMPORT_WATCH_JOB, "2026-11-10");
  });
});

describe("buildMissingImportPayload", () => {
  it("names up to three days, then a count", () => {
    const p = JSON.parse(buildMissingImportPayload(["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]));
    expect(p.title).toBe("Yoco export not uploaded — 4 days");
    expect(p.body).toContain("2026-10-04, 2026-10-11, 2026-10-18 and 1 more");
  });
});
