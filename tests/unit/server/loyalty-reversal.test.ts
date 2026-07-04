// loyalty-reversal.test.ts — Blocker 1 (Gian review, PR #208)
// reverseOrderLoyalty claws back the loyalty earned on an order when it is
// cancelled/refunded. Verifies: no-op when nothing earned, idempotency,
// clamping to the current balance (never below zero), and the ledger delta
// matching the actual decrement (so reconcileLoyalty stays consistent).

import { describe, it, expect, vi, beforeEach } from "vitest";

const writeAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));

import { reverseOrderLoyalty } from "@/server/loyalty/accrue";
import type { DB } from "@/lib/db";

type Row = Record<string, unknown>;

/**
 * Hand-rolled tx. Three selects fire in order:
 *   0 → earn row (loyalty_transactions kind='earn')
 *   1 → existing reversal row (idempotency check)
 *   2 → customer balance
 * then insert(loyalty_transactions) and update(customers).returning().
 */
function makeTx(opts: {
  earn?: Row | null;
  alreadyReversed?: Row | null;
  cust?: Row | null;
  updatedBalance?: number;
}) {
  let selectCall = 0;
  const inserted: Row[] = [];
  const updated: Row[] = [];
  const tx = {
    _inserted: inserted,
    _updated: updated,
    select: () => ({
      from: () => ({
        where: () => {
          const n = selectCall++;
          if (n === 0) return Promise.resolve(opts.earn ? [opts.earn] : []);
          if (n === 1) return Promise.resolve(opts.alreadyReversed ? [opts.alreadyReversed] : []);
          return Promise.resolve(opts.cust ? [opts.cust] : []);
        },
      }),
    }),
    insert: () => ({
      values: (v: Row) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (s: Row) => ({
        where: () => ({
          returning: () => {
            updated.push(s);
            return Promise.resolve([{ loyaltyPoints: opts.updatedBalance ?? 0 }]);
          },
        }),
      }),
    }),
  };
  return tx;
}

beforeEach(() => vi.clearAllMocks());

describe("reverseOrderLoyalty (Blocker 1 — points reversal on cancel/refund)", () => {
  it("no-op (null) when the order never earned", async () => {
    const tx = makeTx({ earn: null });
    const res = await reverseOrderLoyalty("ord-1", tx as unknown as DB);
    expect(res).toBeNull();
    expect(tx._inserted).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("idempotent: no-op when a reversal already exists for the order", async () => {
    const tx = makeTx({ earn: { customerId: "c1", delta: 15 }, alreadyReversed: { id: "rev-1" } });
    const res = await reverseOrderLoyalty("ord-1", tx as unknown as DB);
    expect(res).toBeNull();
    expect(tx._inserted).toHaveLength(0);
  });

  it("reverses the full earned amount when the balance covers it", async () => {
    const tx = makeTx({ earn: { customerId: "c1", delta: 15 }, cust: { loyaltyPoints: 50 }, updatedBalance: 35 });
    const res = await reverseOrderLoyalty("ord-1", tx as unknown as DB, { role: "system", reason: "refund" });
    expect(res).toEqual({ reversedPoints: 15, newLoyaltyBalance: 35 });
    expect(tx._inserted[0].delta).toBe(-15);
    expect(tx._inserted[0].kind).toBe("adjustment");
    expect(String(tx._inserted[0].reason)).toContain("earn_reversal");
    expect(writeAudit).toHaveBeenCalledOnce();
  });

  it("clamps the claw-back to the current balance (never below zero)", async () => {
    // Earned 15 but the customer only holds 10 now (spent 5 elsewhere).
    const tx = makeTx({ earn: { customerId: "c1", delta: 15 }, cust: { loyaltyPoints: 10 }, updatedBalance: 0 });
    const res = await reverseOrderLoyalty("ord-1", tx as unknown as DB);
    expect(res?.reversedPoints).toBe(10);
    expect(tx._inserted[0].delta).toBe(-10); // ledger delta == actual decrement
  });

  it("records a zero-marker (no balance update) when nothing is left to claw back", async () => {
    const tx = makeTx({ earn: { customerId: "c1", delta: 15 }, cust: { loyaltyPoints: 0 } });
    const res = await reverseOrderLoyalty("ord-1", tx as unknown as DB);
    expect(res?.reversedPoints).toBe(0);
    expect(tx._inserted[0].delta).toBe(0); // marker so we don't retry
    expect(tx._updated).toHaveLength(0); // no customers balance write
  });
});
