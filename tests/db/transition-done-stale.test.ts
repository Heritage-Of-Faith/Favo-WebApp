// REQ-047 / REQ-015 / REQ-023 against real Postgres: Done (→ ready) stamps
// completed_at once, a ready → collected tap leaves it alone, the collected
// sweep finds an order made ready through transitionOrder, and a refused
// transition returns STALE_STATE with exactly one committed reject audit row.
// Skips when no real DB is reachable (see ./helpers.ts).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Sql } from "postgres";
import { connect, hasRealDb } from "./helpers";
import { revenueDay } from "@/lib/format";

const auth = vi.hoisted(() => ({ staffId: "" }));
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: auth.staffId, role: "barista", name: "Done Barista" } })),
}));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));

const maybe = hasRealDb() ? describe : describe.skip;

maybe("transitionOrder: Done time and STALE_STATE (REQ-047, REQ-015, REQ-023)", () => {
  let sql: Sql;
  const newOrder = async (state: string) => {
    const [{ id }] = await sql`
      INSERT INTO orders (staff_id, total_zar, state, revenue_day, notification_target)
      VALUES (${auth.staffId}, 0, ${state}, ${revenueDay(new Date())}, 'none')
      RETURNING id`;
    return id as string;
  };
  const completedAt = async (id: string) =>
    (await sql`SELECT completed_at FROM orders WHERE id = ${id}`)[0].completed_at as Date | null;

  beforeAll(async () => {
    sql = connect();
    [{ id: auth.staffId }] = await sql`INSERT INTO staff (name, role, pin_hash) VALUES ('Done Barista', 'barista', 'x') RETURNING id`;
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("Done stamps completed_at once; the collected tap leaves it unchanged", async () => {
    const { transitionOrder } = await import("@/server/actions/orders");
    const id = await newOrder("in_progress");

    const before = Date.now();
    expect(await transitionOrder(id, "ready")).toMatchObject({ ok: true });
    const done = await completedAt(id);
    expect(done).not.toBeNull();
    expect(new Date(done!).getTime()).toBeGreaterThanOrEqual(before - 1000);

    expect(await transitionOrder(id, "collected")).toMatchObject({ ok: true });
    expect(new Date((await completedAt(id))!).getTime()).toBe(new Date(done!).getTime());
  });

  it("the sweep finds an order made ready through transitionOrder, 20 minutes after Done", async () => {
    const { transitionOrder } = await import("@/server/actions/orders");
    const { sweepCollected } = await import("@/server/crons/collected-sweep");
    const id = await newOrder("in_progress");
    expect(await transitionOrder(id, "ready")).toMatchObject({ ok: true });
    const done = new Date((await completedAt(id))!);

    await sweepCollected(new Date(done.getTime() + 21 * 60_000));
    const [row] = await sql`SELECT state, completed_at FROM orders WHERE id = ${id}`;
    expect(row.state).toBe("collected");
    expect(new Date(row.completed_at).getTime()).toBe(done.getTime());
  });

  it("a repeated Done is STALE_STATE and leaves exactly one committed reject audit row", async () => {
    const { transitionOrder } = await import("@/server/actions/orders");
    const id = await newOrder("in_progress");
    expect(await transitionOrder(id, "ready")).toMatchObject({ ok: true });
    const done = await completedAt(id);

    expect(await transitionOrder(id, "ready")).toEqual({
      ok: false, code: "STALE_STATE", message: "This order just changed — reloading",
    });
    const rejects = await sql`
      SELECT reason, after FROM audit_log
      WHERE entity_kind = 'order' AND entity_id = ${id} AND action = 'reject'`;
    expect(rejects).toHaveLength(1);
    expect(rejects[0]).toMatchObject({
      reason: "STALE_STATE",
      after: { attempted: "transition", code: "STALE_STATE", state: "ready", toState: "ready" },
    });
    const [row] = await sql`SELECT state, completed_at FROM orders WHERE id = ${id}`;
    expect(row.state).toBe("ready");
    expect(new Date(row.completed_at).getTime()).toBe(new Date(done!).getTime());
  });
});
