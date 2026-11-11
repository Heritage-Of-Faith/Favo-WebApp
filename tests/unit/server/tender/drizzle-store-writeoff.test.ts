// REQ-034 at the Drizzle TenderStore level, without a database: a fake query
// builder records each chain and the rendered SQL. The real-Postgres proof
// belongs in tests/db (CI only).
//   writeOffReason   the newest `write_off` audit row's reason for the order
//   reverseWriteOff  clears orders.written_off_at, only where it is set, and
//                    never touches payments

import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

import { createDrizzleTenderStore } from "@/server/tender/drizzle-store";
import type { DB } from "@/lib/db";
import { auditLog, orders, payments } from "@db/schema";

const dialect = new PgDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);

type Call = { op: string; table?: unknown; set?: Record<string, unknown>; where?: unknown; limit?: number; orderBy?: unknown };

/** A chain that records every step and resolves to `rows`. */
function fakeDb(rows: unknown[]) {
  const calls: Call[] = [];
  const chain = (c: Call) => {
    const p = {
      from(t: unknown) { c.table = t; return p; },
      set(v: Record<string, unknown>) { c.set = v; return p; },
      where(w: unknown) { c.where = w; return p; },
      orderBy(o: unknown) { c.orderBy = o; return p; },
      limit(n: number) { c.limit = n; return p; },
      returning() { return p; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(rows).then(res, rej); },
    };
    return p;
  };
  const tx = {
    select() { const c: Call = { op: "select" }; calls.push(c); return chain(c); },
    update(t: unknown) { const c: Call = { op: "update", table: t }; calls.push(c); return chain(c); },
  };
  const db = { transaction: (fn: (t: unknown) => unknown) => fn(tx) } as unknown as DB;
  return { db, calls };
}

describe("tender drizzle-store — writeOffReason (REQ-034)", () => {
  it("reads the newest `write_off` audit row on this order and returns its reason", async () => {
    const f = fakeDb([{ reason: "unresolved_at_close" }]);
    const reason = await createDrizzleTenderStore(f.db).transaction((tx) => tx.writeOffReason!("ord-1"));
    expect(reason).toBe("unresolved_at_close");
    const [c] = f.calls;
    expect(c).toMatchObject({ op: "select", table: auditLog, limit: 1 });
    const q = render(c.where);
    expect(q.sql).toContain('"audit_log"."entity_kind" = $1');
    expect(q.sql).toContain('"audit_log"."entity_id" = $2');
    expect(q.sql).toContain('"audit_log"."action" = $3');
    expect(q.params).toEqual(["order", "ord-1", "write_off"]);
    expect(render(c.orderBy).sql).toBe('"audit_log"."at" desc');
  });

  it("no write_off row → null (never a guessed reason)", async () => {
    const f = fakeDb([]);
    expect(await createDrizzleTenderStore(f.db).transaction((tx) => tx.writeOffReason!("ord-1"))).toBeNull();
  });
});

describe("tender drizzle-store — reverseWriteOff (REQ-034)", () => {
  it("clears written_off_at on orders only, only where it is set; true when a row changed", async () => {
    const f = fakeDb([{ id: "ord-1" }]);
    expect(await createDrizzleTenderStore(f.db).transaction((tx) => tx.reverseWriteOff!("ord-1"))).toBe(true);
    expect(f.calls).toHaveLength(1);
    const [c] = f.calls;
    expect(c.op).toBe("update");
    expect(c.table).toBe(orders);
    expect(c.table).not.toBe(payments);
    expect(c.set).toEqual({ writtenOffAt: null });
    const q = render(c.where);
    expect(q.sql).toContain('"orders"."id" = $1');
    expect(q.sql).toContain('"orders"."written_off_at" is not null');
    expect(q.params).toEqual(["ord-1"]);
  });

  it("nothing to reverse → false", async () => {
    const f = fakeDb([]);
    expect(await createDrizzleTenderStore(f.db).transaction((tx) => tx.reverseWriteOff!("ord-1"))).toBe(false);
  });
});
