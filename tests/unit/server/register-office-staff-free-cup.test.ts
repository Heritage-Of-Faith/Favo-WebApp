// AT-211 — a person who self-registers as office staff (PRD §10.3: status is
// "Set at self-registration") then receives the automatic free weekday cup
// (L03) through the existing createOrder path. Before AT-211 nothing could
// write status='office_staff', so this cup was unreachable.
//
// One table-aware DB mock serves both actions: whatever registerCustomer
// inserts into `customers` is what createOrder later reads back.
// Literal values: an Americano is R30,00 = 3000 cents.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { customers, menuItems, menuCustomisations, openingSessions, staffEntitlementLog } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/lot-picker", () => ({ checkRecipeStock: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: vi.fn(async () => ({ id: "ch_1", clientSecret: "cs_1" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signUp: vi.fn(async () => ({
        data: { user: { id: "uuid-thandeka" }, session: { access_token: "tok" } }, error: null,
      })),
    },
  })),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => ({ get: () => "1.2.3.4" })) }));
vi.mock("@/server/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "innerJoin", "leftJoin", "orderBy", "limit", "for"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}

const client = {
  select: () => selectChain(),
  insert: (table: unknown) => ({
    values: (values: Row) => {
      if (table === customers) {
        // The registered row becomes what every later read of `customers` sees.
        // Registration runs on an empty table (no phone, no legacy row) first.
        const row: Row = { id: "cust_thandeka", ...values };
        return { returning: async () => { rows.set(customers, [row]); return [{ id: row.id, name: row.name }]; } };
      }
      return Object.assign(Promise.resolve(), {
        onConflictDoNothing: () => ({ returning: async () => [{ id: "ent_1" }] }),
        returning: async () => [{ id: "new_1" }],
      });
    },
  }),
  update: () => ({ set: () => ({ where: async () => {} }) }),
  delete: () => ({ where: () => Object.assign(Promise.resolve(), { returning: async () => [] }) }),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    insert: (t: unknown) => client.insert(t),
    update: () => client.update(),
    delete: () => client.delete(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { registerCustomer } from "@/server/actions/customer-auth";
import { createOrder } from "@/server/actions/orders";

const AMERICANO = { id: "menu_americano", name: "Americano", category: "coffee", currentPriceZar: 3000, recipeId: null };
// Thu 8 Oct 2026, 09:00 SAST — a weekday with a weekday session open.
const THURSDAY = new Date("2026-10-08T09:00:00+02:00");

beforeEach(() => {
  rows = new Map<unknown, Row[]>([
    [menuItems, [AMERICANO]],
    [menuCustomisations, []],
    [customers, []],
    [openingSessions, [{ mode: "weekday" }]],
    [staffEntitlementLog, []],
  ]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(THURSDAY);
});
afterEach(() => vi.useRealTimers());

async function registerAs(status: "office_staff" | "church_member") {
  const reg = await registerCustomer({
    name: "Thandeka", surname: "Mokoena", status,
    email: "thandeka@hofmi.net", password: "password1",
  });
  expect(reg.ok).toBe(true);
  if (!reg.ok) throw new Error(reg.message);
  return reg.data.customerId;
}

describe("self-registered office staff → automatic free cup (AT-211, L03, §10.3)", () => {
  it("registered as office_staff: the weekday Americano is free by R30,00 with no tap", async () => {
    const customerId = await registerAs("office_staff");
    expect(rows.get(customers)?.[0]).toMatchObject({ status: "office_staff", surname: "Mokoena" });

    const res = await createOrder({
      notificationTarget: "customer", customerId, items: [{ menuItemId: AMERICANO.id, quantity: 1, modifications: [] }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toMatchObject({ applied: true, discountZar: 3000 });
  });

  it("registered as church_member: no free cup", async () => {
    const customerId = await registerAs("church_member");
    const res = await createOrder({
      notificationTarget: "customer", customerId, items: [{ menuItemId: AMERICANO.id, quantity: 1, modifications: [] }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toMatchObject({ applied: false, code: "NOT_ELIGIBLE" });
  });
});
