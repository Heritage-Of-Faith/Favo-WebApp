// AT-206 — two overlapping runs of job 3 for the same week (scheduled run +
// startup catch-up) both pass the "already generated?" check. The loser's
// insert hits UNIQUE(week_starting): it must write nothing and report the
// winner's row, never throw a false "job failed".

import { describe, it, expect, vi } from "vitest";

let selects = 0;
const onConflict: unknown[] = [];

vi.mock("@db/index", async () => ({
  db: {
    execute: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.from = () => c;
      // First select: nothing yet (the race). Second: the winner's row.
      c.where = () => Promise.resolve(selects++ === 0 ? [] : [{ id: "wr_winner" }]);
      return c;
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: () => ({
        onConflictDoNothing: (arg: unknown) => {
          onConflict.push(arg);
          return { returning: () => Promise.resolve([]) }; // conflict: no row written
        },
      }),
    })),
  },
}));

describe("generateWeeklyPnL — insert race", () => {
  it("a conflicting insert returns the existing report as alreadyExists, without throwing", async () => {
    const { generateWeeklyPnL } = await import("@/server/crons/generate-weekly-pnl");
    const r = await generateWeeklyPnL(new Date("2026-08-12T12:00:00+02:00"), new Date("2026-08-17T06:00:00+02:00"));
    expect(r).toEqual({ weekStarting: "2026-08-10", reportId: "wr_winner", alreadyExists: true });
    expect(onConflict).toHaveLength(1);
  });
});
