// AT-202 part 1 — an offline order replayed through applyOutboxItem carries
// its per-line `shots` and is priced by the same server arithmetic as
// createOrder (§7.0.2 surcharge_zar, per unit). The mode is the one in force
// on the server's receipt day; a line above that day's ceiling is refused,
// never silently re-priced without its surcharge.
//
// Literal values: a R20.00 cappuccino at 3 shots on a Sunday is R30.00
// (PRD §15 "Shot pricing, at every step"); extra_shot_zar default 1000.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { outboxLog, orders, orderItems, menuItems, openingSessions, appConfig, recipeIngredients } from "@db/schema";

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const inserts: { table: unknown; values: unknown }[] = [];

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "limit", "orderBy", "innerJoin"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    selectDistinct: () => selectChain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Object.assign(Promise.resolve(), { returning: async () => [{ id: "log-1" }] });
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));

import { applyOutboxItem, outboxItemSchema } from "@/server/sync/apply-outbox";

const CAPP = { id: "mi-capp", name: "Cappuccino", currentPriceZar: 2000, active: true, recipeId: "rec_capp" };
const CHOC = { id: "mi-choc", name: "Hot Chocolate", currentPriceZar: 2000, active: true, recipeId: "rec_choc" };
const SUNDAY = new Date("2026-10-11T09:00:00+02:00");
const MONDAY = new Date("2026-10-12T09:00:00+02:00");

function given(modes: string[]) {
  rows = new Map<unknown, Row[]>([
    [outboxLog, []],
    [menuItems, [CAPP, CHOC]],
    // The coffee-recipe lookup (ingredient kind 'bean'): only the cappuccino holds coffee.
    [recipeIngredients, [{ recipeId: "rec_capp" }]],
    [openingSessions, modes.map((mode) => ({ mode }))],
    [appConfig, []],
  ]);
}

function entry(shots: number | undefined, clientTotalZar: number) {
  return {
    clientUuid: "22222222-2222-2222-2222-222222222222",
    staffId: "staff-1",
    items: [{ menuItemId: CAPP.id, quantity: 1, modifications: [] as string[], ...(shots === undefined ? {} : { shots }) }],
    paymentMode: "yoco_deferred" as const,
    clientTotalZar,
    clientTimestamp: "2026-10-11T07:00:00Z",
  };
}

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);

beforeEach(() => {
  inserts.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY);
});
afterEach(() => vi.useRealTimers());

describe("applyOutboxItem — shots (AT-202)", () => {
  it("a Sunday triple replayed on the Sunday is R30.00, and the line carries shots 3 + surcharge 1000", async () => {
    given(["sunday"]);
    const res = await applyOutboxItem(entry(3, 3000));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 3000 });
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 3000 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).toMatchObject({ shots: 3, surchargeZar: 1000 });
  });

  it("a client total without the surcharge is an amount mismatch — the server total is authoritative", async () => {
    given(["sunday"]);
    const res = await applyOutboxItem(entry(3, 2000));
    expect(res).toEqual({ outcome: "rejected", reason: "amount_mismatch" });
    expect(insertsInto(orders)).toEqual([]);
  });

  it("a Sunday triple replayed on a weekday is refused, never re-priced without its surcharge", async () => {
    vi.setSystemTime(MONDAY);
    given(["weekday"]);
    const res = await applyOutboxItem(entry(3, 3000));
    expect(res).toEqual({ outcome: "rejected", reason: "shots_above_ceiling" });
    expect(insertsInto(orders)).toEqual([]);
    expect(insertsInto(outboxLog)).toHaveLength(1); // the receipt is still recorded
  });

  it("with no session on the receipt day, a triple fails closed", async () => {
    given([]);
    const res = await applyOutboxItem(entry(3, 3000));
    expect(res).toEqual({ outcome: "rejected", reason: "shots_above_ceiling" });
  });

  it("an entry queued before the picker existed (no shots) replays as 1 shot", async () => {
    given(["sunday"]);
    const res = await applyOutboxItem(entry(undefined, 2000));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
    expect((insertsInto(orderItems)[0] as Row[])[0]).toMatchObject({ shots: 1, surchargeZar: 0 });
  });

  it("a hot chocolate at 2 shots is refused (no coffee, L48); nothing is applied", async () => {
    given(["sunday"]);
    const e = entry(2, 2000);
    e.items[0].menuItemId = CHOC.id;
    const res = await applyOutboxItem(e);
    expect(res).toEqual({ outcome: "rejected", reason: "shots_not_allowed" });
    expect(insertsInto(orders)).toEqual([]);
  });

  it("a hot chocolate at 1 shot replays at its listed price", async () => {
    given(["sunday"]);
    const e = entry(1, 2000);
    e.items[0].menuItemId = CHOC.id;
    expect(await applyOutboxItem(e)).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
  });

  it("the schema refuses shots below 1 or fractional", () => {
    expect(outboxItemSchema.safeParse(entry(0, 2000)).success).toBe(false);
    expect(outboxItemSchema.safeParse(entry(1.5, 2000)).success).toBe(false);
    expect(outboxItemSchema.safeParse(entry(4, 4000)).success).toBe(true);
  });
});
