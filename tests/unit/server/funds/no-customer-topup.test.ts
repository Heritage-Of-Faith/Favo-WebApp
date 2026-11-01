// AT-203: the gate that no customer-reachable code can increase a fund
// balance (L44, REQ-160) or read one (L46, REQ-165). CLAUDE.md §7: "Any
// customer-reachable route that increases a fund balance" is a standing
// prohibition — this test is how that stays true.
//
//   1. Only an allow-list of server files touches the fund tables or the fund
//      module; nothing under the customer app, the customer actions or any
//      API route does.
//   2. Only src/server/funds/drizzle-store.ts writes donor_fund_entries.
//   3. Every fund action authorises a STAFF session before anything else: a
//      session that is not staff gets UNAUTHORIZED and nothing runs; a barista
//      calling an Admin-only action (the cash/EFT top-up, the sweep, the
//      names) gets FORBIDDEN.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (f: string) => f.slice(ROOT.length + 1);
const FUND_REF = /donorFund|donor_fund|@\/server\/funds\/|actions\/funds|fundTopupId|fund_topup/;

/** The only files allowed to reach a fund. None is customer-reachable. */
const ALLOWED = new Set([
  "src/server/funds/types.ts",
  "src/server/funds/funds.ts",
  "src/server/funds/drizzle-store.ts",
  "src/server/funds/runtime.ts",
  "src/server/actions/funds.ts", // staff-authorised server actions
  "src/server/actions/orders.ts", // POS-authorised: createOrder's draw, cancelOrder's adjustment
  "src/server/orders/payment-lock.ts", // reads payment_mode: a fund-settled total is frozen (REQ-167)
  "src/server/actions/write-downs.ts", // POS-authorised compOrderLine: refuses a fund-settled order (REQ-167)
  "src/server/tender/drizzle-store.ts", // the top-up's payments rows (the tender chain)
  "src/server/tender/types.ts",
  "src/server/tender/tender.ts",
  "src/server/crons/close-daily.ts", // reads payment_mode to leave fund-paid orders out of the card reconciliation
  "src/server/close/write-offs.ts", // AT-207 / REQ-166: reads spend entries so a fund-paid order is never written off
]);

describe("REQ-160 / REQ-165: no customer-reachable code reaches a fund", () => {
  it("only the allow-listed staff-side files reference the fund tables or the fund module", () => {
    const hits = filesUnder(resolve(ROOT, "src"))
      .filter((f) => FUND_REF.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => !ALLOWED.has(f));
    expect(hits).toEqual([]);
  });

  it("nothing under the customer app, the customer actions or any API route mentions a fund", () => {
    const customerSide = [
      ...filesUnder(resolve(ROOT, "src/app/(customer)")),
      ...filesUnder(resolve(ROOT, "src/app/api")),
      resolve(ROOT, "src/server/actions/customer.ts"),
      resolve(ROOT, "src/server/actions/customer-auth.ts"),
      resolve(ROOT, "src/server/actions/public.ts"),
    ];
    const hits = customerSide.filter((f) => /donorFund|donor_fund|server\/funds|actions\/funds|blessing/i.test(readFileSync(f, "utf8"))).map(rel);
    expect(hits).toEqual([]);
  });

  it("only src/server/funds/drizzle-store.ts inserts into donor_fund_entries, and nothing updates or deletes it", () => {
    const src = filesUnder(resolve(ROOT, "src"));
    const inserters = src.filter((f) => /insert\(donorFundEntries\)/.test(readFileSync(f, "utf8"))).map(rel);
    expect(inserters).toEqual(["src/server/funds/drizzle-store.ts"]);
    const mutators = src.filter((f) => /(update|delete)\(donorFundEntries\)/.test(readFileSync(f, "utf8"))).map(rel);
    expect(mutators).toEqual([]);
  });

  it("every exported fund action begins by authorising a staff session", () => {
    const body = readFileSync(resolve(ROOT, "src/server/actions/funds.ts"), "utf8");
    expect(body).toMatch(/const POS_ROLES = \["barista", "admin"\] as const;/);
    expect(body).toMatch(/const ADMIN_ROLES = \["admin"\] as const;/);
    const exported = [...body.matchAll(/export async function (\w+)\([^]*?\{\n\s+(.*)\n/g)].map((m) => [m[1], m[2]]);
    expect(exported.length).toBeGreaterThanOrEqual(12);
    for (const [, first] of exported) expect(first).toMatch(/^const a = await staffActor\((POS_ROLES|ADMIN_ROLES)\);$/);
    for (const name of ["topUpDonorFund", "sweepDonorFund", "addFundName", "removeFundName"]) {
      expect(exported.find(([n]) => n === name)?.[1]).toContain("ADMIN_ROLES");
    }
  });

  it("§17: the top-up screen's terminal-down copy says a gift can wait, and never points at deferred mode", () => {
    const body = readFileSync(resolve(ROOT, "src/server/actions/funds.ts"), "utf8");
    expect(body).toContain('const NO_TERMINAL_FOR_TOPUP = "A gift can wait: the card terminal is not available right now.";');
    for (const fn of ["beginFundTender", "sendFundTopup", "pollFundTopup"]) {
      const block = body.slice(body.indexOf(`export async function ${fn}(`), body.indexOf("\n}\n", body.indexOf(`export async function ${fn}(`)));
      expect(block, fn).toContain("topupCopy(r)");
    }
  });
});

// ─── behaviour: the actions refuse before touching anything ───────────────────

let session: { id: string; role: "barista" | "admin" } | null = null;
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async (...roles: string[]) => {
    if (!session) throw new Error("UNAUTHORIZED");
    if (!roles.includes(session.role)) throw new Error("FORBIDDEN");
    return { ...session, name: "x" };
  }),
}));
const getFundDeps = vi.fn(() => {
  throw new Error("a refused caller must never reach the fund rules");
});
vi.mock("@/server/funds/runtime", () => ({
  getFundDeps: () => getFundDeps(),
  getTopupTenderDeps: () => getFundDeps(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import * as actions from "@/server/actions/funds";

const calls: Record<string, () => Promise<{ ok: boolean; code?: string }>> = {
  createDonorFund: () => actions.createDonorFund({ forSpecificPeople: false, customerIds: [], nonRefundableAcknowledged: true, amountZar: 50_000 }),
  beginFundTender: () => actions.beginFundTender("f1", 50_000),
  sendFundTopup: () => actions.sendFundTopup("fe1", 1),
  pollFundTopup: () => actions.pollFundTopup("fe1", 1),
  resolveFundTopupByLookup: () => actions.resolveFundTopupByLookup("fe1"),
  drawFromDonorFund: () => actions.drawFromDonorFund("o1", "f1"),
  readFundBalance: () => actions.readFundBalance("f1"),
  fundOptionsForOrder: () => actions.fundOptionsForOrder({ customerId: null, netZar: 2000 }),
  topUpDonorFund: () => actions.topUpDonorFund({ fundId: "f1", amountZar: 50_000, fundingMethod: "eft", reference: "r", reason: "x" }),
  sweepDonorFund: () => actions.sweepDonorFund("f1", "x"),
  addFundName: () => actions.addFundName("f1", "c1"),
  removeFundName: () => actions.removeFundName("f1", "c1"),
};

describe("REQ-160: the fund actions refuse a non-staff session, and the Admin-only ones refuse a barista", () => {
  beforeEach(() => {
    getFundDeps.mockClear();
  });

  it("no staff session (a customer, or nobody): every fund action is UNAUTHORIZED and reaches nothing", async () => {
    session = null;
    for (const [name, call] of Object.entries(calls)) {
      expect(await call(), name).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    }
    expect(getFundDeps).not.toHaveBeenCalled();
  });

  it("a barista PIN session on the cash/EFT top-up, the sweep or the names: FORBIDDEN (the admin 403)", async () => {
    session = { id: "staff_louis", role: "barista" };
    for (const name of ["topUpDonorFund", "sweepDonorFund", "addFundName", "removeFundName"]) {
      expect(await calls[name](), name).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(getFundDeps).not.toHaveBeenCalled();
  });
});
