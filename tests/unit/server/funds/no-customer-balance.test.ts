// AT-203 / REQ-165 (L46, §6.10.1): "Given any customer-scoped read or push ·
// When its payload is inspected · Then it contains no fund balance and no fund
// ledger entry — FAVO sends no donor statement and displays no fund balance to
// a customer."
//
// The customer-scoped READS (the customer app, customer actions, every API
// route) are held by no-customer-topup.test.ts. This file holds the PUSH half:
// the only customer push is "your order is ready", and neither its builder nor
// its sender can reach a fund — so a fund-paid order's push is the same push.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOrderReadyPayload } from "@/server/push/payload";

const FUND = /donorFund|donor_fund|server\/funds|actions\/funds|blessing|balance/i;
/** The file without its comments: a comment citing REQ-165 is not a payload. */
const code = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("REQ-165: no customer push carries a fund balance or a ledger entry", () => {
  it("the customer push builder and sender never reference a fund or a balance", () => {
    for (const f of ["src/server/push/payload.ts", "src/server/push/send.ts"]) {
      expect(code(f), f).not.toMatch(FUND);
    }
  });

  it("the order-ready push is exactly title, body and { orderId, url } — nothing about who paid", () => {
    const p = buildOrderReadyPayload("ord-1", "Thandeka");
    expect(Object.keys(p).sort()).toEqual(["body", "data", "title"]);
    expect(Object.keys(p.data).sort()).toEqual(["orderId", "url"]);
    expect(JSON.stringify(p)).not.toMatch(/fund|balance|R\s?\d/i);
  });

  it("no statement or balance push exists for a donor: nothing under src/server/push names a fund", () => {
    for (const f of ["src/server/push/admin-alert.ts", "src/server/push/vapid.ts"]) {
      expect(readFileSync(resolve(process.cwd(), f), "utf8"), f).not.toMatch(/donorFund|donor_fund|blessing/i);
    }
  });
});
