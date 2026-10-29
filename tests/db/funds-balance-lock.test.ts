// AT-203: the balance-locking test (PRD v7.0 §15.1, "The fund — money out";
// REQ-163). "Two simultaneous draws against a fund holding one drink's worth —
// one succeeds, one returns FUND_INSUFFICIENT. This is the FOR UPDATE test and
// it is the only place §6.10 can lose money."
//
// The in-memory store serialises transactions by construction, so it cannot
// prove this; only Postgres can. Two SEPARATE connections each run
// drawFromDonorFund through the Drizzle FundStore at the same moment, against
// a fund holding exactly R20 (2000 cents) and two R20 orders. The second
// transaction must block on SELECT … FOR UPDATE of the fund row, then read
// the committed spend and refuse.
//
// The fixture has to be COMMITTED (each connection must see it), and the
// ledger is append-only, so the cleanup disables the append-only trigger for
// the delete and re-enables it in a `finally`. This is a disposable CI test
// database (tests/db/helpers.ts refuses anything else).
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@db/schema";
import type { DB } from "@db/index";
import { createDrizzleFundStore } from "@/server/funds/drizzle-store";
import { drawFromDonorFund, fundBalanceZar, FUND_CODE_ALPHABET } from "@/server/funds/funds";
import type { FundDeps } from "@/server/funds/types";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import { connect, hasRealDb } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

maybe("REQ-163: two simultaneous draws against one drink's worth (FOR UPDATE, real Postgres)", () => {
  let admin: Sql;
  let connA: Sql;
  let connB: Sql;
  const ids: { staff?: string; fund?: string; orders: string[] } = { orders: [] };

  function deps(conn: Sql): FundDeps {
    return {
      store: createDrizzleFundStore(drizzle(conn, { schema }) as unknown as DB),
      now: () => new Date(),
      readConfig: async () => ({ ceilingZar: 200_000, dormancyDays: 180 }),
      randomCode: () => "FVO-ZZZZ",
      newClientUuid: () => crypto.randomUUID(),
      notify: { unnamedFundCreated: async () => {} },
      tender: {
        port: new FakeYocoWebPosPort(),
        readDeviceId: async () => null,
        notify: { paymentUnresolved: async () => {}, duplicateCharge: async () => {} },
      },
    };
  }

  beforeAll(async () => {
    admin = connect();
    const url = process.env.DATABASE_URL as string;
    connA = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    connB = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    const [s] = await admin`INSERT INTO staff (name, role, pin_hash) VALUES ('AT-203 lock test', 'barista', 'x') RETURNING id`;
    ids.staff = s.id;
    const pick = () => FUND_CODE_ALPHABET[Math.floor(Math.random() * FUND_CODE_ALPHABET.length)];
    const code = `FVO-${pick()}${pick()}${pick()}${pick()}`;
    const [f] = await admin`
      INSERT INTO donor_funds (code, display_name, non_refundable_ack_by, created_by_staff_id)
      VALUES (${code}, 'AT-203 lock test', ${s.id}, ${s.id}) RETURNING id`;
    ids.fund = f.id;
    await admin`
      INSERT INTO donor_fund_entries (fund_id, kind, amount_zar, funding_method, reference, recorded_by_staff_id, reason)
      VALUES (${f.id}, 'top_up', 2000, 'cash', 'lock-test', ${s.id}, 'one drink')`;
    for (let i = 0; i < 2; i++) {
      const [o] = await admin`
        INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target)
        VALUES (${s.id}, 2000, '2026-10-25', 'none') RETURNING id`;
      ids.orders.push(o.id);
    }
  });

  afterAll(async () => {
    try {
      if (ids.fund) {
        await admin.begin(async (tx) => {
          await tx`ALTER TABLE donor_fund_entries DISABLE TRIGGER donor_fund_entries_no_update_delete`;
          try {
            await tx`DELETE FROM donor_fund_entries WHERE fund_id = ${ids.fund!}`;
          } finally {
            await tx`ALTER TABLE donor_fund_entries ENABLE TRIGGER donor_fund_entries_no_update_delete`;
          }
          // audit_log rows are append-only by design and stay.
          await tx`DELETE FROM orders WHERE id = ANY(${ids.orders})`;
          await tx`DELETE FROM donor_funds WHERE id = ${ids.fund!}`;
          await tx`DELETE FROM staff WHERE id = ${ids.staff!}`;
        });
      }
    } finally {
      await Promise.all([admin?.end({ timeout: 5 }), connA?.end({ timeout: 5 }), connB?.end({ timeout: 5 })]);
    }
  });

  it("one succeeds, one FUND_INSUFFICIENT, and the balance never goes below zero", async () => {
    const actor = { kind: "staff" as const, staffId: ids.staff!, role: "barista" };
    const [a, b] = await Promise.all([
      drawFromDonorFund(deps(connA), actor, ids.orders[0], ids.fund!),
      drawFromDonorFund(deps(connB), actor, ids.orders[1], ids.fund!),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "FUND_INSUFFICIENT" });

    const rows = await admin`SELECT kind, amount_zar FROM donor_fund_entries WHERE fund_id = ${ids.fund!}`;
    const balance = fundBalanceZar(
      rows.map((r) => ({
        id: "x", fundId: ids.fund!, kind: r.kind, amountZar: r.amount_zar, orderId: null, fundingMethod: r.kind === "top_up" ? "cash" : null,
        reference: null, clientUuid: null, recordedByStaffId: ids.staff!, reason: null, at: new Date(), topupPayments: [],
      }))
    );
    expect(balance).toBe(0);
    expect(rows.filter((r) => r.kind === "spend")).toHaveLength(1);
    const payments = await admin`SELECT id FROM payments WHERE order_id = ANY(${ids.orders})`;
    expect(payments).toHaveLength(0); // L47: a fund draw never writes payments
  });
});
