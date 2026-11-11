// GET /api/admin/unpaid-orders — PRD v7.0 §11.3 matrix row ("GET
// /api/admin/unpaid-orders · /api/admin/audit-coverage · /admin/write-downs":
// admin ✔ only), §11.2 row ("Every unpaid order — yoco_deferred, plus any
// yoco order with no successful payment (S3a) — with its daily_seq, age and
// value"), §6.7 / REQ-166 (a fund-paid order is never listed).

import { describe, it, expect, vi, beforeEach } from "vitest";

let session: { id: string; name: string; role: "barista" | "admin" } | null = null;
vi.mock("@/lib/auth/session", async (orig) => {
  const real = await orig<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    getSession: vi.fn(async () => session),
    requireRole: vi.fn(async (...roles: string[]) => {
      if (!session) throw new Error("UNAUTHORIZED");
      if (!roles.includes(session.role)) throw new Error("FORBIDDEN");
      return session;
    }),
  };
});

type Row = Record<string, unknown>;
let rows: Row[] = [];
const execute = vi.fn(async () => rows);
vi.mock("@/lib/db", () => ({ db: { execute: (...a: unknown[]) => execute(...(a as [])) } }));

import { GET } from "@/app/api/admin/unpaid-orders/route";

const req = () => new Request("https://favo.hofmi.net/api/admin/unpaid-orders");

// A Saturday event (2026-11-07): neither the weekday nor the Sunday exemption applies.
function fact(over: Row): Row {
  return {
    id: "o-x", staff_id: "staff_louis", total_zar: 3000, placed_at: "2026-11-07T16:00:00.000Z", revenue_day: "2026-11-07",
    state: "ready", payment_mode: "yoco_deferred", written_off: false, settled: false,
    has_successful_payment: false, has_fund_spend: false, latest_status: null, latest_sent: null, ...over,
  };
}

beforeEach(() => {
  session = null;
  rows = [];
  execute.mockClear();
});

describe("GET /api/admin/unpaid-orders", () => {
  it("no session → 401 and barista → 403; the database is never queried", async () => {
    expect((await GET(req())).status).toBe(401);
    session = { id: "staff_louis", name: "Louis", role: "barista" };
    expect((await GET(req())).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("admin → 200 with every unpaid order (deferred and a failed yoco), never a settled, fund-paid or free one", async () => {
    session = { id: "staff_admin_mia", name: "Mia", role: "admin" };
    rows = [
      fact({ id: "o-deferred-open", placed_at: "2026-11-07T16:00:00.000Z" }),
      fact({ id: "o-yoco-declined", payment_mode: "yoco", total_zar: 2000, placed_at: "2026-11-07T15:00:00.000Z",
        latest_status: "declined", latest_sent: true }),
      fact({ id: "o-deferred-settled", settled: true }),
      fact({ id: "o-fund-paid", payment_mode: "donor_fund", has_fund_spend: true }),
      fact({ id: "o-free", payment_mode: "free", total_zar: 0 }),
    ];
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orders: Array<{ orderId: string; valueZar: number; ageMinutes: number; orderRef: string }> };
    expect(body.orders.map((o) => o.orderId)).toEqual(["o-yoco-declined", "o-deferred-open"]);
    expect(body.orders[1]).toMatchObject({ orderRef: "o-deferr", valueZar: 3000 });
    expect(typeof body.orders[0].ageMinutes).toBe("number");
  });
});
