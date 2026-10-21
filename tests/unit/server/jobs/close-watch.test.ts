// AT-193 — the 06:00 missing-close alert (PRD §9.6.2 job 2, "Who is told").
// Pure: the close records, the scheduler's first start and the push are injected.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/crons/close-daily", () => ({ closedDays: vi.fn() }));
vi.mock("@/server/jobs/store", () => ({ auditJobStore: {} }));
vi.mock("@/server/jobs/alert", () => ({ pushAdmins: vi.fn() }));

import { buildMissingClosePayload, checkMissingCloses, daysToHaveClosed } from "@/server/jobs/close-watch";
import type { MissingCloseDeps } from "@/server/jobs/close-watch";

const T = (iso: string) => new Date(iso);
// Wed 21 Oct 2026 06:00 SAST
const NOW = T("2026-10-21T04:00:00Z");

function deps(firstStart: Date | null, closed: string[]): MissingCloseDeps & { push: ReturnType<typeof vi.fn> } {
  return {
    firstStartedAt: async () => firstStart,
    closedDays: async (days) => new Set(days.filter((d) => closed.includes(d))),
    push: vi.fn(async () => {}),
  };
}

describe("daysToHaveClosed", () => {
  it("covers the scheduler's first day up to yesterday, oldest first", () => {
    // Started Sun 18 Oct 10:00 SAST: 18, 19 and 20 Oct were its to close.
    expect(daysToHaveClosed(T("2026-10-18T08:00:00Z"), NOW)).toEqual(["2026-10-18", "2026-10-19", "2026-10-20"]);
  });

  it("is empty when the scheduler started today", () => {
    expect(daysToHaveClosed(T("2026-10-21T01:00:00Z"), NOW)).toEqual([]);
  });

  it("is not capped by the catch-up window: an old unclosed day is still reported (REQ-067)", () => {
    const days = daysToHaveClosed(T("2026-01-01T08:00:00Z"), NOW);
    expect(days[0]).toBe("2026-01-01");
    expect(days.at(-1)).toBe("2026-10-20");
    expect(days).toHaveLength(293);
  });
});

describe("checkMissingCloses", () => {
  it("pushes once, naming every unclosed day", async () => {
    const d = deps(T("2026-10-18T08:00:00Z"), ["2026-10-19"]);
    const result = await checkMissingCloses(NOW, d);
    expect(result).toEqual({ checked: 3, missing: ["2026-10-18", "2026-10-20"] });
    expect(d.push).toHaveBeenCalledOnce();
    const payload = JSON.parse(d.push.mock.calls[0][0]);
    expect(payload.title).toBe("Daily close missing — 2 days");
    expect(payload.body).toContain("2026-10-18, 2026-10-20");
  });

  it("is silent when every day is closed", async () => {
    const d = deps(T("2026-10-19T08:00:00Z"), ["2026-10-19", "2026-10-20"]);
    expect(await checkMissingCloses(NOW, d)).toEqual({ checked: 2, missing: [] });
    expect(d.push).not.toHaveBeenCalled();
  });

  it("does nothing before the scheduler has ever started", async () => {
    const d = deps(null, []);
    expect(await checkMissingCloses(NOW, d)).toEqual({ checked: 0, missing: [] });
    expect(d.push).not.toHaveBeenCalled();
  });
});

describe("buildMissingClosePayload", () => {
  it("names a single day in the title", () => {
    expect(JSON.parse(buildMissingClosePayload(["2026-10-20"])).title).toBe("Daily close missing — 2026-10-20");
  });

  it("shortens a long list", () => {
    const body = JSON.parse(buildMissingClosePayload(["a", "b", "c", "d", "e"])).body;
    expect(body).toContain("a, b, c and 2 more");
  });
});
