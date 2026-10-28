// AT-201 part 2b: the wiring around the tender chain.
//   - §10.2.1 / CLAUDE.md §5: exactly two writers of payments.status — so no
//     file outside src/server/tender/ writes payments at all, and the retired
//     Yoco Online webhook (§11.1) and checkout client are gone.
//   - the production port reports "no Web POS device linked" until the live
//     adapter exists: nothing can be charged, and a fetch is never a status.
//   - REQ-012's Admin push names the order, amount, barista and session, and
//     two unresolved in one session escalate; REQ-011's names both Yoco ids.
//   - every read of an order's payments takes the LATEST attempt (§10.3.3).

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: vi.fn(async () => {}) }));

import { unlinkedWebPosPort } from "@/server/tender/runtime";
import { beginTender, sendToTerminal, pollTenderResult } from "@/server/tender/tender";
import { S4A_ACTION, duplicateChargeAlert, unresolvedAlerts } from "@/server/tender/admin-notifier";
import { summarisePayments } from "@/server/tender/summary";
import type { TenderDeps } from "@/server/tender/types";
import { MemoryTenderStore } from "./memory-store";

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

describe("§10.2.1: only the tender module writes payments", () => {
  it("no file outside src/server/tender/ inserts into or updates payments", () => {
    const writers = filesUnder(resolve(ROOT, "src"))
      .filter((f) => /\b(insert|update)\(payments\)/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(ROOT.length + 1));
    expect(writers).toEqual(["src/server/tender/drizzle-store.ts"]);
  });

  it("the Yoco Online webhook and checkout client are retired (§11.1)", () => {
    expect(existsSync(resolve(ROOT, "src/app/api/payments/yoco/webhook/route.ts"))).toBe(false);
    expect(existsSync(resolve(ROOT, "src/server/yoco/client.ts"))).toBe(false);
    const src = filesUnder(resolve(ROOT, "src")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/createPaymentIntent|yocoClientSecret|confirmManualPayment\(|LEGACY_ONLINE_CHECKOUT_DEVICE/);
  });

  it("no server action exposes recordTenderResult", () => {
    const actions = readdirSync(resolve(ROOT, "src/server/actions")).map((f) =>
      readFileSync(resolve(ROOT, "src/server/actions", f), "utf8")
    );
    for (const a of actions) expect(a).not.toMatch(/recordTenderResult\s*\(/);
  });
});

describe("the production port until gate zero: no Web POS device is linked", () => {
  function deps(deviceId: string | null): { deps: TenderDeps; store: MemoryTenderStore } {
    const store = new MemoryTenderStore([{ id: "ord-1", state: "ordered", totalZar: 3000, clientUuid: "cu-1" }]);
    const notify = { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}) };
    return {
      store,
      deps: { store, port: unlinkedWebPosPort, now: () => new Date("2026-10-25T07:00:00Z"), readDeviceId: async () => deviceId, notify },
    };
  }

  it("no app_config.webpos_device_id → beginTender is TERMINAL_UNREACHABLE and writes no payments row", async () => {
    const w = deps(null);
    expect(await beginTender(w.deps, { kind: "system" }, "ord-1")).toMatchObject({ ok: false, code: "TERMINAL_UNREACHABLE" });
    expect(w.store.paymentsOf("ord-1")).toEqual([]);
  });

  it("a configured id but no linked device → the send is TERMINAL_UNREACHABLE; nothing sent, attempt closed out", async () => {
    const w = deps("dev-1");
    await beginTender(w.deps, { kind: "system" }, "ord-1");
    expect(await sendToTerminal(w.deps, { kind: "system" }, "ord-1", 1)).toMatchObject({
      ok: false, code: "TERMINAL_UNREACHABLE", retryOffered: false,
    });
    expect(w.store.paymentsOf("ord-1")[0]).toMatchObject({ status: "unresolved", sentAt: null, yocoPaymentId: null });
  });

  it("a fetch is a fetch error, never a status", async () => {
    expect(await unlinkedWebPosPort.fetchPayment("yp_1")).toEqual({ kind: "fetch_error" });
    expect(await unlinkedWebPosPort.findPaymentsByClientReference("cu-1:1")).toEqual({ kind: "fetch_error" });
    const w = deps("dev-1");
    expect(await pollTenderResult(w.deps, { kind: "system" }, "ord-1", 1)).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("REQ-012 / S4a and REQ-011 Admin pushes", () => {
  const info = { orderId: "a1b2c3d4-0000-4000-8000-000000000000", attempt: 1, cause: "ceiling" };

  it("names the order, the amount, the barista and the session, with S4a's one action", () => {
    const [alert, ...rest] = unresolvedAlerts(
      { orderRef: "a1b2c3d4", amountZar: 3000, baristaName: "Thandeka", session: { date: "2026-10-25", opensAt: "07:50" }, unresolvedInSession: 1 },
      info
    );
    expect(rest).toEqual([]);
    expect(alert.title).toBe("Payment unresolved — order a1b2c3d4");
    expect(alert.body).toMatch(/^R\s?30,00 · /); // 3000 cents, formatted (formatZar puts a NBSP after R)
    expect(alert.body).toContain("Thandeka");
    expect(alert.body).toContain("session 2026-10-25 07:50");
    expect(alert.body).toContain(S4A_ACTION);
    expect(S4A_ACTION).toBe(
      "Ask the customer whether their card was charged before they leave — the slip from the machine settles it."
    );
    expect(alert.data).toMatchObject({ orderId: info.orderId, amountZar: 3000 });
  });

  it("two unresolved in one session escalate", () => {
    const alerts = unresolvedAlerts(
      { orderRef: "a1b2c3d4", amountZar: 3000, baristaName: "Louis", session: { date: "2026-10-25", opensAt: "07:50" }, unresolvedInSession: 2 },
      info
    );
    expect(alerts).toHaveLength(2);
    expect(alerts[1].title).toBe("2 unresolved payments this session");
    expect(alerts[1].data).toMatchObject({ escalation: true });
  });

  it("a duplicate charge names both Yoco ids and the amount", () => {
    const a = duplicateChargeAlert("a1b2c3d4", { orderId: info.orderId, yocoPaymentIds: ["yp_1", "yp_2"], amountZar: 3000 });
    expect(a.body).toMatch(/^Charged twice: Yoco yp_1 and yp_2 · R\s?30,00\.$/);
  });
});

describe("summarisePayments: the LATEST attempt decides (ORDER BY attempt)", () => {
  const SENT = new Date("2026-10-25T07:00:00Z");
  it("declined then successful → successful, frozen", () => {
    expect(summarisePayments([
      { status: "declined", sentAt: SENT, yocoPaymentId: "yp_1" },
      { status: "successful", sentAt: SENT, yocoPaymentId: "yp_2" },
    ])).toEqual({ paymentStatus: "successful", totalFrozen: true, awaitingLookup: false });
  });
  it("only a declined attempt → declined, not frozen (S3: re-attemptable)", () => {
    expect(summarisePayments([{ status: "declined", sentAt: SENT, yocoPaymentId: "yp_1" }]))
      .toEqual({ paymentStatus: "declined", totalFrozen: false, awaitingLookup: false });
  });
  it("a pending attempt → frozen (P4); none → nothing", () => {
    expect(summarisePayments([{ status: "pending", sentAt: null, yocoPaymentId: null }]))
      .toEqual({ paymentStatus: "pending", totalFrozen: true, awaitingLookup: false });
    expect(summarisePayments([])).toEqual({ paymentStatus: null, totalFrozen: false, awaitingLookup: false });
  });
  it("unresolved: SENT → awaiting the lookup (drink is made); never sent (closed out) → still owed, re-tenderable", () => {
    expect(summarisePayments([{ status: "unresolved", sentAt: SENT, yocoPaymentId: null }]))
      .toEqual({ paymentStatus: "unresolved", totalFrozen: true, awaitingLookup: true });
    expect(summarisePayments([{ status: "unresolved", sentAt: null, yocoPaymentId: null }]))
      .toEqual({ paymentStatus: "unresolved", totalFrozen: false, awaitingLookup: false });
  });
});
