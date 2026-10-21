// AT-193 / AT-194 against real Postgres: closeDaily writes one close record per
// revenue day however often it runs, and the collected sweep moves exactly the
// orders S7 says it should. Skips when no real DB is reachable (see ./helpers.ts).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { connect, hasRealDb } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

maybe("closeDaily — one close record per revenue day (AT-193)", () => {
  let sql: Sql;
  // audit_log is append-only, so each suite run closes a fresh, long-past day.
  const day = new Date(Date.UTC(2001, 0, 1 + Math.floor(Math.random() * 3000), 10));

  beforeAll(() => {
    sql = connect();
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("an old-format daily_close row (pre-AT-193, possibly part-day) does not count as closed", async () => {
    const { closedDays, dayBounds } = await import("@/server/crons/close-daily");
    const legacy = dayBounds(new Date(day.getTime() - 4000 * 86_400_000)).date;
    await sql`
      INSERT INTO audit_log (entity_kind, entity_id, action, actor_role, after)
      VALUES ('system', ${legacy}, 'daily_close', 'system', ${sql.json({ revenueZar: 0, paymentsZar: 0, variancePct: 0, band: "ok" })})`;
    expect((await closedDays([legacy])).has(legacy)).toBe(false);
  });

  it("concurrent and repeated closes of one day leave exactly one close record", async () => {
    const { closeDaily, dayBounds } = await import("@/server/crons/close-daily");
    const { date } = dayBounds(day);

    const [a, b] = await Promise.all([closeDaily(day), closeDaily(day, { wasCatchUp: true })]);
    expect([a.alreadyClosed, b.alreadyClosed].sort()).toEqual([false, true]);
    expect(await closeDaily(day)).toEqual({ date, alreadyClosed: true });

    const rows = await sql`
      SELECT actor_role, after FROM audit_log
      WHERE entity_kind = 'system' AND action = 'daily_close' AND entity_id = ${date}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_role).toBe("system");
    expect(rows[0].after).toMatchObject({ revenueDay: date });
  });
});

maybe("the collected sweep (AT-194, §9.6.2 job 5)", () => {
  let sql: Sql;
  let staffId: string;
  const ids: Record<string, string> = {};
  const now = new Date();
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  beforeAll(async () => {
    sql = connect();
    [{ id: staffId }] = await sql`INSERT INTO staff (name, role, pin_hash) VALUES ('Sweep Barista', 'barista', 'x') RETURNING id`;
    const order = async (state: string, completedAt: Date | null) => {
      const [{ id }] = await sql`
        INSERT INTO orders (staff_id, total_zar, state, completed_at)
        VALUES (${staffId}, 0, ${state}, ${completedAt})
        RETURNING id`;
      return id as string;
    };
    ids.due = await order("ready", ago(25));
    ids.fresh = await order("ready", ago(10));
    ids.noDoneTime = await order("ready", null);
    ids.notReady = await order("in_progress", ago(60));
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("moves only ready orders Done 20+ minutes ago, keeps their Done time, and audits each", async () => {
    const { sweepCollected } = await import("@/server/crons/collected-sweep");
    await sweepCollected(now);

    const rows = await sql`SELECT id, state, completed_at FROM orders WHERE id IN ${sql(Object.values(ids))}`;
    const state = Object.fromEntries(rows.map((r) => [r.id, r.state]));
    expect(state[ids.due]).toBe("collected");
    expect(state[ids.fresh]).toBe("ready");
    expect(state[ids.noDoneTime]).toBe("ready");
    expect(state[ids.notReady]).toBe("in_progress");
    const due = rows.find((r) => r.id === ids.due)!;
    expect(new Date(due.completed_at).getTime()).toBe(ago(25).getTime());

    const audit = await sql`
      SELECT actor_role, before, after FROM audit_log
      WHERE entity_kind = 'order' AND entity_id = ${ids.due} AND action = 'transition'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_role: "system", before: { state: "ready" }, after: { state: "collected" } });

    // A second run finds nothing left to do for these orders.
    await sweepCollected(now);
    const again = await sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_kind = 'order' AND entity_id = ${ids.due}`;
    expect(again[0].n).toBe(1);
  });
});
