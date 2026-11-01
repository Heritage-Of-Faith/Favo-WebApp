// AT-203: the blessing fund against REAL Postgres through the Drizzle stores,
// with FakeYocoWebPosPort (never live Yoco). What the in-memory unit tests
// cannot prove: that the SQL behind FundTx and the fund-top-up TenderStore
// does what the rules assume —
//   - a counter card top-up writes a pending card top_up entry and ONE payments
//     row on fund_topup_id (client_uuid:1), and counts nothing until the chain
//     records `successful`; then a draw settles an order with NO payments row;
//   - cancelOrder's compensating adjustment restores the balance;
//   - a second active linked fund for one customer is refused by the index.
//
// Runs against the CI test DB at 0045, inside one transaction that is always
// rolled back. Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import type { DB } from "@db/index";
import { createDrizzleFundStore, fundTxOn } from "@/server/funds/drizzle-store";
import { beginFundTender, compensateFundDraw, createDonorFund, drawFromDonorFund, readFundBalance } from "@/server/funds/funds";
import { createDrizzleFundTopupStore } from "@/server/tender/drizzle-store";
import { pollTenderResult, sendToTerminal } from "@/server/tender/tender";
import type { FundDeps } from "@/server/funds/types";
import type { TenderDeps } from "@/server/tender/types";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import { connect, hasRealDb } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

class Rollback extends Error {}

maybe("blessing fund on Postgres (AT-203)", () => {
  let sql: Sql;
  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("top-up → successful → draw → cancel, all through SQL; payments only ever holds the top-up's row", async () => {
    const db = drizzle(sql, { schema }) as unknown as DB;
    try {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DB;
        const now = new Date("2026-10-25T07:00:00.000Z");
        const [staff] = await tx.insert(schema.staff).values({ name: "AT-203 Barista", role: "barista", pinHash: "x" }).returning({ id: schema.staff.id });
        const [c1] = await tx.insert(schema.customers).values({ name: "Thandeka" }).returning({ id: schema.customers.id });
        const actor = { kind: "staff" as const, staffId: staff.id, role: "barista" };
        const port = new FakeYocoWebPosPort({
          sends: [{ outcome: "sent", yocoPaymentId: "yp-gift-db", fetches: [{ status: "successful", chargedAmountZar: 50_000 }] }],
        });
        const notify = { paymentUnresolved: async () => {}, duplicateCharge: async () => {} };
        const deps: FundDeps = {
          store: createDrizzleFundStore(tx),
          now: () => now,
          readConfig: async () => ({ ceilingZar: 200_000, dormancyDays: 180 }),
          randomCode: () => "FVO-7K2M",
          newClientUuid: () => "cu-topup-db-1",
          notify: { unnamedFundCreated: async () => {} },
          tender: { port, readDeviceId: async () => "dev-khumo-1", notify },
        };
        const topup: TenderDeps = { store: createDrizzleFundTopupStore(tx), port, now: () => now, readDeviceId: async () => "dev-khumo-1", notify };

        const created = await createDonorFund(deps, actor, { displayName: "Thandeka's group", forSpecificPeople: true, customerIds: [c1.id], nonRefundableAcknowledged: true, amountZar: 50_000 });
        expect(created).toMatchObject({ ok: true, code: "FVO-7K2M" });
        const fundId = (created as { fundId: string }).fundId;

        // REQ-172 by the index: Thandeka cannot be on a second active fund.
        const second = await createDonorFund({ ...deps, randomCode: () => "FVO-9PQR" }, actor, { displayName: "Other", forSpecificPeople: true, customerIds: [c1.id], nonRefundableAcknowledged: true, amountZar: 50_000 });
        expect(second).toMatchObject({ ok: false, code: "VALIDATION" });

        const begun = await beginFundTender(deps, actor, fundId, 50_000);
        expect(begun).toMatchObject({ ok: true, attempt: 1, clientReference: "cu-topup-db-1:1", amountZar: 50_000 });
        const topupId = (begun as { fundTopupId: string }).fundTopupId;
        const [pending] = await tx.select().from(schema.payments).where(eq(schema.payments.fundTopupId, topupId));
        expect(pending).toMatchObject({ orderId: null, status: "pending", amountZar: 50_000 });
        expect((await readFundBalance(deps, fundId))?.balanceZar).toBe(0);

        await sendToTerminal(topup, actor, topupId, 1);
        expect(await pollTenderResult(topup, actor, topupId, 1)).toEqual({ ok: true, status: "successful" });
        expect((await readFundBalance(deps, fundId))?.balanceZar).toBe(50_000);

        const [order] = await tx
          .insert(schema.orders)
          .values({ staffId: staff.id, customerId: c1.id, notificationTarget: "customer", totalZar: 2000, revenueDay: "2026-10-25" })
          .returning({ id: schema.orders.id });
        expect(await drawFromDonorFund(deps, actor, order.id, fundId)).toMatchObject({ ok: true, balanceAfterZar: 48_000 });
        const [o] = await tx.select().from(schema.orders).where(eq(schema.orders.id, order.id));
        expect(o).toMatchObject({ paymentMode: "donor_fund", totalZar: 2000 });
        expect(await tx.select().from(schema.payments).where(eq(schema.payments.orderId, order.id))).toEqual([]);

        await compensateFundDraw(fundTxOn(tx), actor, order.id, "customer left", now);
        expect((await readFundBalance(deps, fundId))?.balanceZar).toBe(50_000);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  });
});
