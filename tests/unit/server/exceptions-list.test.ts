// REQ-039: a REPLAY_TOO_OLD rejection is "surfaced on the admin exception
// list" (§6.0.5: "Not shown to the barista"). listReplayTooOld is Admin only
// and carries no customer id.
import { describe, it, expect, vi } from "vitest";

const role = { current: "admin" };
const whereArgs: unknown[] = [];

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockImplementation(async (...roles: string[]) =>
    roles.includes(role.current)
      ? { ok: true, session: { id: "s1", role: role.current, name: "X" } }
      : { ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." }),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/db", () => {
  const select = () => {
    const chain: Record<string, unknown> = {};
    for (const k of ["leftJoin", "innerJoin", "limit", "orderBy", "from"]) chain[k] = () => chain;
    chain.where = (w: unknown) => { whereArgs.push(w); return chain; };
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve([{
        id: "aud-1",
        at: new Date("2026-10-11T21:00:00+02:00"),
        baristaName: "Thandeka",
        after: {
          clientUuid: "33333333-3333-3333-3333-333333333333",
          staffId: "staff-1",
          clientTimestamp: "2026-10-11T06:59:59.000Z",
          receivedAt: "2026-10-11T19:00:00.000Z",
          ageMs: 12 * 60 * 60 * 1000 + 1000,
          clientTotalZar: 2000,
          paymentMode: "yoco_deferred",
          items: [{ menuItemId: "mi-capp", quantity: 2, shots: 1 }],
        },
      }]).then(res, rej);
    return chain;
  };
  return { db: { select } };
});

import { listReplayTooOld } from "@/server/actions/exceptions";

describe("listReplayTooOld (admin exception list, REQ-039)", () => {
  it("a barista is refused", async () => {
    role.current = "barista";
    const r = await listReplayTooOld();
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("an admin sees the rejected order: uuid, age, barista, items, till total", async () => {
    role.current = "admin";
    const r = await listReplayTooOld();
    if (!r.ok) throw new Error("expected ok");
    expect(r.data).toEqual([{
      auditId: "aud-1",
      clientUuid: "33333333-3333-3333-3333-333333333333",
      receivedAt: "2026-10-11T19:00:00.000Z",
      clientTimestamp: "2026-10-11T06:59:59.000Z",
      ageMinutes: 720,
      baristaName: "Thandeka",
      itemCount: 2,
      clientTotalZar: 2000,
    }]);
    expect(JSON.stringify(r.data)).not.toContain("customer");
  });
});
