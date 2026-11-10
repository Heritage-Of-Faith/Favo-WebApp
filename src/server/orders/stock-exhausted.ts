// REQ-020 / S8 and REQ-022 / S8b — the two stock-exhaustion codes, their
// barista copy (PRD §6.0.1 S1 table, verbatim), and S8b's immediate Admin push.
//
// STOCK_EXHAUSTED: at ring-up, before any tender begins (createOrder).
// STOCK_EXHAUSTED_AT_MAKE: the in_progress deduction failed (transitionOrder).
// The order stays `ordered`, no stock row is written (the transaction rolled
// back), the money is not reversed (L02), the refusal is audited (CLAUDE.md §5),
// the barista is given the resolution path (REQ-022) and the Admin is pushed
// immediately.

import { writeAudit } from "@/server/audit";
import { alertAdmins } from "@/server/push/admin-alert";

export const STOCK_EXHAUSTED = {
  code: "STOCK_EXHAUSTED",
  message: "Out of beans — tell the admin",
} as const;

/** S1's copy for the code, verbatim. */
export const STOCK_EXHAUSTED_AT_MAKE_COPY = "Out of beans — this order is paid and cannot be made. Get an admin.";

/** S8b's resolution path: an admin-PIN cancel with an L33 comp on a later order (L02: no money back), or an admin opens a container. */
export const STOCK_AT_MAKE_RESOLUTION =
  "An admin cancels it with the admin PIN and comps a later order (no money is returned), or opens a container.";

/** REQ-022: returned WITH the resolution path. */
export const STOCK_EXHAUSTED_AT_MAKE = {
  code: "STOCK_EXHAUSTED_AT_MAKE",
  message: `${STOCK_EXHAUSTED_AT_MAKE_COPY} ${STOCK_AT_MAKE_RESOLUTION}`,
} as const;

export function stockExhaustedAtMakeAlert(orderId: string, detail: string): {
  title: string;
  body: string;
  data: Record<string, unknown>;
} {
  return {
    title: `Out of stock at make — order ${orderId.slice(0, 8)}`,
    body: STOCK_EXHAUSTED_AT_MAKE.message,
    data: { orderId, code: STOCK_EXHAUSTED_AT_MAKE.code, detail, url: "/admin" },
  };
}

/**
 * Repeat taps on the same order within this window push the Admin once. Not a
 * PRD number: it only stops a barista re-tapping "Start Making" from flooding
 * the Admin's phone. Every refusal is still audited. In-memory, per server
 * process (FAVO runs one always-on server, PRD §9).
 */
export const STOCK_AT_MAKE_PUSH_DEDUPE_MS = 5 * 60_000;
const lastPushAt = new Map<string, number>();

/** TESTS ONLY: forget which orders were pushed. */
export function resetStockAtMakePushesForTests(): void {
  lastPushAt.clear();
}

function shouldPush(orderId: string, now: number): boolean {
  const last = lastPushAt.get(orderId);
  if (last !== undefined && now - last < STOCK_AT_MAKE_PUSH_DEDUPE_MS) return false;
  lastPushAt.set(orderId, now);
  for (const [id, at] of lastPushAt) if (now - at >= STOCK_AT_MAKE_PUSH_DEDUPE_MS) lastPushAt.delete(id);
  return true;
}

/**
 * After the in_progress transaction rolled back on a failed deduction: write
 * the reject audit row (its own statement, so it commits), push the Admin
 * whether or not that audit insert succeeded (alertAdmins never throws), and
 * return the refusal. An audit failure is logged, never allowed to stop the push.
 */
export async function refuseStockExhaustedAtMake(
  orderId: string,
  session: { id: string; role: string },
  deduction: { code: string; message: string }
): Promise<{ ok: false; code: string; message: string }> {
  try {
    await writeAudit({
      entityKind: "order", entityId: orderId, action: "reject",
      actorId: session.id, actorRole: session.role,
      after: {
        attempted: "transition", toState: "in_progress",
        code: STOCK_EXHAUSTED_AT_MAKE.code, deductionCode: deduction.code, detail: deduction.message,
      },
      reason: STOCK_EXHAUSTED_AT_MAKE.code,
    });
  } catch (err) {
    console.error("[stock] STOCK_EXHAUSTED_AT_MAKE audit failed for order", orderId, err);
  }
  if (shouldPush(orderId, Date.now())) {
    const alert = stockExhaustedAtMakeAlert(orderId, deduction.message);
    await alertAdmins(alert.title, alert.body, alert.data);
  }
  return { ok: false, code: STOCK_EXHAUSTED_AT_MAKE.code, message: STOCK_EXHAUSTED_AT_MAKE.message };
}
