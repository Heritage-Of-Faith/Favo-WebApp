// AT-201 part 2a: the tender chain against REAL Postgres through the Drizzle
// TenderStore, with FakeYocoWebPosPort (never live Yoco). What the in-memory
// unit tests cannot prove: that the SQL behind the store does what the chain
// assumes — orders.client_uuid roots the reference, the pending row lands
// before the send, status/charged/sent_at persist, and the audit rows are
// written in the same transaction.
//
// Runs against the CI test DB at 0036, inside one transaction that is always
// rolled back. Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import type { DB } from "@db/index";
import { createDrizzleTenderStore } from "@/server/tender/drizzle-store";
import { beginTender, pollTenderResult, sendToTerminal } from "@/server/tender/tender";
import type { TenderDeps } from "@/server/tender/types";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import { connect, hasRealDb } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

class Rollback extends Error {}

maybe("tender chain on Postgres (AT-201 part 2a)", () => {
  let sql: Sql;
  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("begin → send → poll: cu:1 reference, pending before the send, successful at 3000 cents, audited", async () => {
    const db = drizzle(sql, { schema }) as unknown as DB;
    try {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DB;
        const [staff] = await tx
          .insert(schema.staff)
          .values({ name: "AT-201 Barista", role: "barista", pinHash: "x" })
          .returning({ id: schema.staff.id });
        const [order] = await tx
          .insert(schema.orders)
          .values({
            staffId: staff.id,
            totalZar: 3000,
            revenueDay: "2026-10-25",
            notificationTarget: "none",
            clientUuid: "cu-db-1",
          })
          .returning({ id: schema.orders.id });

        const port = new FakeYocoWebPosPort({
          sends: [{ outcome: "sent", yocoPaymentId: "yp-db-1", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }],
        });
        const deps: TenderDeps = {
          store: createDrizzleTenderStore(tx),
          port,
          now: () => new Date("2026-10-25T07:00:00.000Z"),
          readDeviceId: async () => "dev-khumo-1",
          notify: { paymentUnresolved: async () => {}, duplicateCharge: async () => {} },
        };
        const actor = { kind: "staff" as const, staffId: staff.id, role: "barista" };

        expect(await beginTender(deps, actor, order.id)).toMatchObject({ ok: true, attempt: 1, clientReference: "cu-db-1:1" });
        const [pending] = await tx.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
        expect(pending).toMatchObject({ status: "pending", amountZar: 3000, webposDeviceId: "dev-khumo-1", yocoPaymentId: null });
        expect(port.sends).toHaveLength(0);

        expect(await beginTender(deps, actor, order.id)).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });

        expect(await sendToTerminal(deps, actor, order.id, 1)).toMatchObject({ ok: true, yocoPaymentId: "yp-db-1" });
        expect(await sendToTerminal(deps, actor, order.id, 1)).toMatchObject({ ok: false, code: "VALIDATION" });
        expect(await pollTenderResult(deps, actor, order.id, 1)).toEqual({ ok: true, status: "successful" });

        const [done] = await tx.select().from(schema.payments).where(eq(schema.payments.orderId, order.id));
        expect(done).toMatchObject({ status: "successful", chargedAmountZar: 3000, yocoPaymentId: "yp-db-1" });
        expect(done.sentAt).toEqual(new Date("2026-10-25T07:00:00.000Z"));

        const audits = await tx
          .select({ action: schema.auditLog.action })
          .from(schema.auditLog)
          .where(and(eq(schema.auditLog.entityKind, "payment"), eq(schema.auditLog.entityId, done.id)));
        expect(audits.map((a) => a.action)).toEqual(
          expect.arrayContaining(["payment.tender_begun", "payment.send_claimed", "payment.sent", "payment.send_rejected", "payment.successful"])
        );
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  });
});
