// AT-205 — REQ-112, REQ-113, REQ-114 · PRD §7.0.2 ROLLUP, §7.2, §11.2
// getMinistryRollup(from, to) — admin. db.execute is mocked and dispatched on
// the SQL text, so the reads may run in any order.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@db/index", () => ({ db: { execute: vi.fn() } }));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff-admin", name: "Admin", role: "admin" } }),
}));

const dialect = new PgDialect();

type Fixture = {
  cogs: Record<string, unknown>[];
  gross: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  fees?: Record<string, unknown>[];
  outreach?: Record<string, unknown>[];
  sweptZar?: number;
  writer: boolean;
};

async function stub(f: Fixture) {
  const { db } = await import("@db/index");
  vi.mocked(db.execute).mockImplementation(((q: Parameters<typeof dialect.sqlToQuery>[0]) => {
    const text = dialect.sqlToQuery(q).sql;
    if (text.includes("FROM audit_log")) return Promise.resolve([{ exists: f.writer }]);
    if (text.includes("FROM opening_sessions")) return Promise.resolve(f.sessions);
    if (text.includes("SUM(-amount_zar)")) return Promise.resolve([{ swept_zar: f.sweptZar ?? 0 }]);
    if (text.includes("fee_missing")) return Promise.resolve(f.fees ?? []);
    if (text.includes("voucher_redemptions")) return Promise.resolve(f.outreach ?? []);
    if (text.includes("orders.payment_mode")) return Promise.resolve(f.gross);
    if (text.includes("FROM expenses")) return Promise.resolve(f.expenses);
    if (text.includes("LEFT JOIN order_cogs")) return Promise.resolve(f.cogs);
    if (text.includes("FROM inventory_items")) return Promise.resolve([]);
    throw new Error(`unexpected query: ${text}`);
  }) as never);
}

const cogsRow = (day: string, cogs: number | null, estimated = true) => ({
  revenue_day: day,
  cogs_zar: cogs,
  absent_item_ids: cogs === null ? ["inv_oat"] : [],
  estimated,
  missing: false,
});

const grossRow = (day: string, mode: string | null, gross: number, writtenOff = 0) => ({
  revenue_day: day,
  payment_mode: mode,
  gross_zar: gross,
  written_off_zar: writtenOff,
});

const session = (day: string, mode: string, posture: string | null = null) => ({ session_date: day, mode, payment_posture: posture });

// FIXTURE-A, PRD §7.0.3: thirteen order integers summing to 19636 on R350.00.
const THIRTEEN = [1352, 1352, 1352, 1352, 1352, 2382, 441, 2704, 2704, 743, 743, 2128, 1031];

describe("getMinistryRollup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is admin only", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-01", "2026-08-31");
    expect(vi.mocked(authorize)).toHaveBeenCalledWith("admin");
    expect(res.ok).toBe(false);
  });

  it.each([
    ["a malformed date", "2026-8-1", "2026-08-31"],
    ["an impossible date", "2026-02-30", "2026-03-01"],
    ["from after to", "2026-08-31", "2026-08-01"],
  ])("rejects %s", async (_l, from, to) => {
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup(from, to);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("weekday cost + expenses = ministry_cost; FIXTURE-A Sunday's unrecorded fees make income UNAVAILABLE", async () => {
    await stub({
      cogs: [...THIRTEEN.map((c) => cogsRow("2026-08-16", c)), cogsRow("2026-08-17", 529), cogsRow("2026-08-17", 1059)],
      gross: [grossRow("2026-08-16", "yoco", 35000), grossRow("2026-08-17", "free", 0)],
      expenses: [{ sast_date: "2026-08-03", expenses_zar: 250000 }],
      sessions: [session("2026-08-16", "sunday"), session("2026-08-17", "weekday")],
      // payments.fee_zar has no writer yet: all thirteen fees NULL.
      fees: [{ day: "2026-08-16", fee_zar: 0, fee_missing: 13 }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-01", "2026-08-31");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.weekdayCogsZar).toBe(1588);
    expect(res.data.expensesZar).toBe(250000);
    expect(res.data.ministryCostZar).toBe(251588);
    expect(res.data.ministryIncomeZar).toBeNull();
    expect(res.data.ministryNetZar).toBeNull();
    expect(res.data.days[0]).toMatchObject({ date: "2026-08-16", dayClass: "paid", grossZar: 35000, cogsZar: 19636, processingFeeZar: null, contributionZar: null });
    expect(res.data.unavailable).toContainEqual({ kind: "fee_unrecorded", date: "2026-08-16" });
    expect(res.data.state).toBe("unavailable");
  });

  it("FIXTURE-A with its fees recorded: contribution R144.37 is ministry income, provisional", async () => {
    await stub({
      cogs: THIRTEEN.map((c) => cogsRow("2026-08-16", c)),
      gross: [grossRow("2026-08-16", "yoco", 35000)],
      expenses: [],
      sessions: [session("2026-08-16", "sunday")],
      fees: [{ day: "2026-08-16", fee_zar: 927, fee_missing: 0 }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.days[0]).toMatchObject({ grossZar: 35000, cogsZar: 19636, processingFeeZar: 927, contributionZar: 14437 });
    expect(res.data.ministryIncomeZar).toBe(14437);
    expect(res.data.state).toBe("provisional");
    expect(res.data.tone).toBe("warn");
  });

  it("REQ-114: no expense ever logged → ministry_cost UNAVAILABLE", async () => {
    await stub({
      cogs: [cogsRow("2026-08-17", 529)],
      gross: [grossRow("2026-08-17", "free", 0)],
      expenses: [],
      sessions: [session("2026-08-17", "weekday")],
      writer: false,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-17", "2026-08-17");
    expect(res.ok && res.data.ministryCostZar).toBeNull();
    expect(res.ok && res.data.unavailable).toContainEqual({ kind: "no_expense_writer" });
  });

  it("an R0 Sunday (no settled payment) has a recorded fee of zero, so contribution computes", async () => {
    await stub({
      cogs: [cogsRow("2026-08-16", 1352, false)],
      gross: [grossRow("2026-08-16", "free", 0)],
      expenses: [{ sast_date: "2026-08-16", expenses_zar: 1000 }],
      sessions: [session("2026-08-16", "sunday")],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.ministryIncomeZar).toBe(-1352);
    expect(res.data.ministryCostZar).toBe(1000);
    expect(res.data.ministryNetZar).toBe(-2352);
    expect(res.data.state).toBe("final");
    expect(res.data.tone).toBe("negative");
  });
});

describe("getMinistryRollup — REQ-134: an unknown payment mode fails loudly, never defaults", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["NULL", null, "NULL"],
    ["an unhandled value", "cash", '"cash"'],
  ])("%s stops the report with UNKNOWN_PAYMENT_MODE, naming the value and the day", async (_l, mode, named) => {
    await stub({
      cogs: [cogsRow("2026-08-16", 1352)],
      gross: [grossRow("2026-08-16", "yoco", 2000), grossRow("2026-08-16", mode, 2000)],
      expenses: [],
      sessions: [session("2026-08-16", "sunday")],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("UNKNOWN_PAYMENT_MODE");
    expect(res.message).toContain(named);
    expect(res.message).toContain("2026-08-16");
  });

  it("donor_fund is fund_gross_zar at full price; free is not gross", async () => {
    await stub({
      cogs: THIRTEEN.map((c) => cogsRow("2026-08-16", c)),
      gross: [grossRow("2026-08-16", "yoco", 33000), grossRow("2026-08-16", "donor_fund", 2000), grossRow("2026-08-16", "free", 0)],
      expenses: [],
      sessions: [session("2026-08-16", "sunday")],
      fees: [{ day: "2026-08-16", fee_zar: 927, fee_missing: 0 }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.days[0].grossZar).toBe(35000);
    expect(res.data.days[0].contributionZar).toBe(14437);
  });
});

describe("getMinistryRollup — the v7 tables, read", () => {
  beforeEach(() => vi.clearAllMocks());

  it("written_off_zar comes off collected and contribution (REQ-111)", async () => {
    await stub({
      cogs: THIRTEEN.map((c) => cogsRow("2026-08-16", c)),
      gross: [grossRow("2026-08-16", "yoco", 33000), grossRow("2026-08-16", "yoco_deferred", 2000, 2000)],
      expenses: [],
      sessions: [session("2026-08-16", "sunday")],
      fees: [{ day: "2026-08-16", fee_zar: 927, fee_missing: 0 }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.days[0]).toMatchObject({ grossZar: 35000, writtenOffZar: 2000, collectedZar: 33000, contributionZar: 12437 });
  });

  it("REQ-158: an all-voucher order's order_cogs is outreach_cogs; ministry_net is unchanged", async () => {
    await stub({
      cogs: THIRTEEN.map((c) => cogsRow("2026-08-16", c)),
      gross: [grossRow("2026-08-16", "yoco", 35000)],
      expenses: [],
      sessions: [session("2026-08-16", "event", "standard")],
      fees: [{ day: "2026-08-16", fee_zar: 927, fee_missing: 0 }],
      outreach: [{ revenue_day: "2026-08-16", cogs_zar: 1352, fully_vouchered: true }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.days[0]).toMatchObject({ cogsZar: 19636, outreachCogsZar: 1352, contributionZar: 15789 });
    expect(res.data.outreachCogsZar).toBe(1352);
    expect(res.data.ministryCostZar).toBe(1352);
    expect(res.data.ministryNetZar).toBe(14437);
  });

  it("REQ-158: a voucher on an order that also has a paid unit — line COGS not recorded — is UNAVAILABLE, never 0", async () => {
    await stub({
      cogs: THIRTEEN.map((c) => cogsRow("2026-08-16", c)),
      gross: [grossRow("2026-08-16", "yoco", 35000)],
      expenses: [],
      sessions: [session("2026-08-16", "event", "standard")],
      fees: [{ day: "2026-08-16", fee_zar: 927, fee_missing: 0 }],
      outreach: [{ revenue_day: "2026-08-16", cogs_zar: 2704, fully_vouchered: false }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.outreachCogsZar).toBeNull();
    expect(res.data.days[0].contributionZar).toBeNull();
    expect(res.data.unavailable).toContainEqual({ kind: "outreach_unrecorded", date: "2026-08-16", orders: 1 });
  });

  it("a free event's posture comes from its window; its COGS is free_event_cogs", async () => {
    await stub({
      cogs: [cogsRow("2026-08-22", 4000, false)],
      gross: [grossRow("2026-08-22", "free", 0)],
      expenses: [],
      sessions: [session("2026-08-22", "event", "free")],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-22", "2026-08-22");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.freeEventCogsZar).toBe(4000);
    expect(res.data.ministryCostZar).toBe(4000);
  });

  it("Admin-confirmed sweeps enter ministry_income", async () => {
    await stub({ cogs: [], gross: [], expenses: [], sessions: [], sweptZar: 7500, writer: true });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-01", "2026-08-31");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.sweepsZar).toBe(7500);
    expect(res.data.ministryIncomeZar).toBe(7500);
  });

  it("a day holding only revenue (a cancelled paid order) is not dropped for having no COGS row", async () => {
    await stub({
      cogs: [],
      gross: [grossRow("2026-08-16", "yoco", 2000)],
      expenses: [],
      sessions: [session("2026-08-16", "sunday")],
      fees: [{ day: "2026-08-16", fee_zar: 53, fee_missing: 0 }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.days.map((d) => d.date)).toEqual(["2026-08-16"]);
    expect(res.data.ministryIncomeZar).toBe(1947);
  });
});

describe("getMinistryRollup — review fixes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DEC-21: a Sunday of card orders with no FAVO payment row reads the fee UNAVAILABLE, never R0.00", async () => {
    await stub({
      cogs: THIRTEEN.map((c) => cogsRow("2026-08-16", c)),
      gross: [{ ...grossRow("2026-08-16", "yoco", 35000), without_favo_payment: 13 }],
      expenses: [],
      sessions: [session("2026-08-16", "sunday")],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.days[0]).toMatchObject({ grossZar: 35000, cogsZar: 19636, processingFeeZar: null, contributionZar: null });
    expect(res.data.unavailable).toContainEqual({ kind: "card_fee_outside_favo", date: "2026-08-16", orders: 13 });
    expect(res.data.ministryIncomeZar).toBeNull();
  });

  it("a genuinely empty period stays zero, never UNAVAILABLE", async () => {
    await stub({ cogs: [], gross: [], expenses: [], sessions: [], writer: true });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-01", "2026-08-31");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.days).toEqual([]);
    expect(res.data.ministryIncomeZar).toBe(0);
    expect(res.data.ministryCostZar).toBe(0);
    expect(res.data.ministryNetZar).toBe(0);
    expect(res.data.state).toBe("empty");
  });

  it("a fully vouchered order with no order_cogs is outreach UNAVAILABLE, never 0", async () => {
    await stub({
      cogs: [...THIRTEEN.map((c) => cogsRow("2026-08-16", c)), cogsRow("2026-08-16", null)],
      gross: [grossRow("2026-08-16", "yoco", 35000), grossRow("2026-08-16", "free", 0)],
      expenses: [],
      sessions: [session("2026-08-16", "event", "standard")],
      fees: [{ day: "2026-08-16", fee_zar: 927, fee_missing: 0 }],
      outreach: [{ revenue_day: "2026-08-16", cogs_zar: null, fully_vouchered: true }],
      writer: true,
    });
    const { getMinistryRollup } = await import("@/server/actions/ministry");
    const res = await getMinistryRollup("2026-08-16", "2026-08-16");
    if (!res.ok) throw new Error(res.message);
    expect(res.data.outreachCogsZar).toBeNull();
    expect(res.data.ministryCostZar).toBeNull();
    expect(res.data.unavailable).toContainEqual({ kind: "outreach_cost_absent", date: "2026-08-16", orders: 1 });
  });
});
