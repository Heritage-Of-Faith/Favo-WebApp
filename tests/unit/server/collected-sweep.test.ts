// AT-194 — the `collected` sweep (PRD §9.6.2 job 5, S7), with the DB mocked.
// The real-Postgres behaviour is in tests/db/scheduled-jobs.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@db/index", () => ({ db: { select: vi.fn(), transaction: vi.fn() } }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@db/index";
import { writeAudit } from "@/server/audit";
import { notifyOrderChange } from "@/server/queue/notify";
import { sweepCollected, SWEEP_BATCH } from "@/server/crons/collected-sweep";

const NOW = new Date("2026-10-20T08:00:00Z");

/** `due` is what the eligibility query returns; `stillReady` says which of them the guarded update moves. */
function mockSweep(due: string[], stillReady: string[] = due) {
  const limit = vi.fn().mockResolvedValue(due.map((id) => ({ id })));
  vi.mocked(db.select).mockReturnValueOnce({
    from: () => ({ where: () => ({ orderBy: () => ({ limit }) }) }),
  } as unknown as ReturnType<typeof db.select>);
  let i = 0;
  const update = vi.fn(() => ({
    set: () => ({
      where: () => ({
        returning: async () => {
          const id = due[i++];
          return stillReady.includes(id) ? [{ id }] : [];
        },
      }),
    }),
  }));
  vi.mocked(db.transaction).mockImplementation(((fn: (tx: unknown) => unknown) => fn({ update })) as never);
  return { limit, update };
}

beforeEach(() => vi.clearAllMocks());

describe("sweepCollected", () => {
  it("moves each due order to collected, audited as the system", async () => {
    mockSweep(["o1", "o2"]);
    const result = await sweepCollected(NOW);

    expect(result).toEqual({ cutoff: "2026-10-20T07:40:00.000Z", due: 2, swept: 2, skipped: 0 });
    expect(writeAudit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({
      entityKind: "order", entityId: "o1", action: "transition", actorRole: "system",
      before: { state: "ready" }, after: { state: "collected" },
    });
    expect(vi.mocked(writeAudit).mock.calls[0][0].reason).toMatch(/S7/);
  });

  it("skips an order a barista collected in the meantime — no audit, no notify", async () => {
    mockSweep(["o1", "o2"], ["o2"]);
    const result = await sweepCollected(NOW);

    expect(result).toMatchObject({ due: 2, swept: 1, skipped: 1 });
    expect(writeAudit).toHaveBeenCalledOnce();
    expect(notifyOrderChange).toHaveBeenCalledOnce();
    expect(vi.mocked(notifyOrderChange).mock.calls[0][0]).toMatchObject({ type: "state_change", orderId: "o2", state: "collected" });
  });

  it("does nothing when no order is due", async () => {
    const { update } = mockSweep([]);
    expect(await sweepCollected(NOW)).toMatchObject({ due: 0, swept: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(notifyOrderChange).not.toHaveBeenCalled();
  });

  it("is bounded per run", async () => {
    const { limit } = mockSweep([]);
    await sweepCollected(NOW);
    expect(limit).toHaveBeenCalledWith(SWEEP_BATCH);
  });

  it("a failed queue notify does not fail the run — the state change is committed", async () => {
    mockSweep(["o1"]);
    vi.mocked(notifyOrderChange).mockRejectedValueOnce(new Error("pg down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sweepCollected(NOW)).toMatchObject({ swept: 1 });
    spy.mockRestore();
  });
});
