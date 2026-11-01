"use server";

import { z } from "zod";
import { and, eq, gte, inArray, lt, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderItems,
  menuItems,
  menuCustomisations,
  customers,
  staffEntitlementLog,
  payments,
  openingSessions,
  voucherRedemptions,
  stockMovements,
} from "@db/schema";
import { writeAudit } from "@/server/audit";
import { authorize } from "@/server/auth/guard";
import { verifyAdminPin } from "@/server/auth/admin-pin";
import { revenueDay } from "@/lib/format";
import { canTransition } from "@/server/orders/state-machine";
import { deductForOrder, DeductionError } from "@/server/orders/deduction";
import { writeOrderCogs } from "@/server/orders/order-cogs";
import { checkRecipeStock } from "@/server/inventory/lot-picker";
import type { DB } from "@/lib/db";
import {
  computeOrderTotalZar,
  type PricedLine,
} from "@/server/orders/pricing";
import { isWeekdayInSAST } from "@/server/orders/discount";
import {
  decideFreeCup,
  isFreeCupWeekday,
  FREE_CUP_COPY,
  type FreeCupDecision,
  type FreeCupRefusalCode,
} from "@/server/orders/free-coffee";
import {
  shotSurchargeZar, shotsAboveCeilingMessage, shotsNotAllowedMessage, type ShotPolicy,
} from "@/server/orders/shot-surcharge";
import { readShotPolicy, readCoffeeRecipeIds } from "@/server/orders/shot-policy";
import { startTender, TENDER_NOT_BEGUN } from "@/server/tender/service";
import { isAttemptOpen, isUnresolvedNeedingAttention } from "@/server/tender/tender";
import { summarisePayments } from "@/server/tender/summary";
import { compensateFundDraw, drawFromDonorFund } from "@/server/funds/funds";
import { getFundDeps } from "@/server/funds/runtime";
import { fundTxOn } from "@/server/funds/drizzle-store";
import {
  ORDER_MOVED_ON, CHECKOUT_EXISTS, lockPaymentForTotalChange,
} from "@/server/orders/payment-lock";
import {
  OTHER_DISCOUNT, TOO_MANY_VOUCHERS, VOUCHER_NOT_ON_EXTRA_SHOTS, planLineVouchers,
} from "@/server/orders/voucher";
import { lockOpenSession } from "@/server/orders/voucher-session";
import { notifyOrderChange } from "@/server/queue/notify";
import { sendOrderReadyPush } from "@/server/push/send";
import { isValidPushSubscription } from "@/server/push/payload";
import type { ActionResult, Order, OrderState } from "@/lib/types";

// Docs: docs/API.md · Business rules L01–L06, L14–L15.
// Roles allowed to operate the POS:
const POS_ROLES = ["barista", "admin"] as const;

export type CreateOrderInput = {
  customerId?: string;
  /** L28 / REQ-046: required. `customer` needs customerId; `none` forbids it. */
  notificationTarget: "customer" | "none";
  items: {
    menuItemId: string;
    quantity: number;
    modifications: string[];
    /** §6.9: Untracked vouchers on this line, 0..quantity (L41, REQ-151). Default 0. */
    voucherCount?: number;
    /** AT-202 / L31: the line's shot count, set by the §6.2.3c picker. Default 1. */
    shots?: number;
  }[];
  /** The voucher kind; default = the open session's single active kind. */
  voucherKind?: string;
  /**
   * AT-203 / §6.10.6: the blessing fund chosen on the footer. When set, the
   * order is settled from the fund (drawFromDonorFund) instead of beginning a
   * card tender — never both (no split tender, §6.10.5).
   */
  donorFundId?: string;
};

const createOrderSchema = z.object({
  customerId: z.string().min(1).optional(),
  donorFundId: z.string().min(1).optional(),
  // L28: no default — an order without a bound target is refused.
  notificationTarget: z.enum(["customer", "none"]),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().positive(),
        modifications: z.array(z.string()),
        voucherCount: z.number().int().min(0).optional(),
        // The ceiling for the mode (T15) is checked below, with its own code.
        shots: z.number().int().min(1).default(1),
      })
    )
    .min(1),
  voucherKind: z.string().trim().min(1).optional(),
}).refine(
  // PRD §10.3 CHECK: (notification_target = 'customer') = (customer_id IS NOT NULL).
  (d) => (d.notificationTarget === "customer") === (d.customerId !== undefined),
  { message: "notificationTarget must be 'customer' with a customer, or 'none' without one." }
);

type VoucherRefusal = { code: string; message: string };

/** What happened to the L03 free cup on this order — shown to the barista once. */
export type FreeCupResult = {
  applied: boolean;
  code: FreeCupRefusalCode | null;
  /** null = nothing worth telling the barista. */
  message: string | null;
  discountZar: number;
};

/**
 * The tender attempt createOrder began (T2 step 3, "automatic on Place"), or
 * why none was. `null` for a net-R0 order: no tender, no payments row (REQ-153).
 * Nothing has been sent yet — the screen sends it (sendToTerminal).
 */
export type CreateOrderTender =
  | { ok: true; attempt: number; amountZar: number }
  | { ok: false; code: string; message: string; retryOffered?: boolean }
  | null;

/** AT-203: the blessing-fund draw createOrder made instead of a card tender. */
export type CreateOrderFundDraw =
  | { ok: true; fundId: string; amountZar: number; balanceAfterZar: number }
  | { ok: false; code: string; message: string };

/**
 * Create an order in `ordered` state (T2 step 2). The order and its items
 * commit first; only then does beginTender write the `pending` payments row,
 * and only after that can anything be sent (REQ-026, P1 — never the reverse).
 * No stock is deducted at creation (rule L01 — that happens on in_progress, P2).
 */
export async function createOrder(
  input: CreateOrderInput
): Promise<ActionResult<{
  orderId: string;
  /** P4: an attempt is open — from now on the free cup cannot change. */
  cardCheckout: boolean;
  totalZar: number;
  freeCup: FreeCupResult;
  tender: CreateOrderTender;
  /** Present only when a donorFundId was given. */
  fundDraw?: CreateOrderFundDraw;
}>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  const parsed = createOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid order input." };
  }
  const data = parsed.data;

  // Pre-generated in Node (crypto.randomUUID() is a v4 UUID, the same as
  // gen_random_uuid()) so the order, its items and any refusal audit share it.
  const orderId = crypto.randomUUID();

  // §6.9 / REQ-151: never more vouchers than the line has units. Audited.
  const voucherCounts = data.items.map((i) => i.voucherCount ?? 0);
  const vouchersOnOrder = voucherCounts.reduce((a, b) => a + b, 0);
  if (data.items.some((item, i) => voucherCounts[i] > item.quantity)) {
    return rejectVoucherOrder(orderId, session, { code: "VALIDATION", message: TOO_MANY_VOUCHERS }, voucherCounts);
  }

  // One server timestamp for placed_at, revenue_day and the free-cup day, so
  // they can never straddle midnight SAST (L07, REQ-039).
  const receivedAt = new Date();
  const day = revenueDay(receivedAt);

  // ── AT-202: the shot ceiling (T15, REQ-138, REQ-144) and the extra-shot
  // surcharge (T09, REQ-104, REQ-136). Only a line above one shot can be
  // affected, so the policy is read only then. A line above the ceiling for
  // today's mode is refused here, before anything is written.
  let shotPolicy: ShotPolicy | null = null;
  if (data.items.some((i) => i.shots > 1)) {
    shotPolicy = await readShotPolicy(db, day);
    const policy = shotPolicy;
    if (data.items.some((i) => i.shots > policy.maxShots)) {
      return { ok: false, code: "SHOTS_ABOVE_CEILING", message: shotsAboveCeilingMessage(policy) };
    }
  }
  /** §7.0.2 surcharge_zar for one unit of a line. */
  const surchargeFor = (shots: number) =>
    shotPolicy ? shotSurchargeZar(shots, shotPolicy.extraShotZar, shotPolicy.surchargeInForce) : 0;

  // Resolve current prices from the DB (never trust client-supplied prices).
  // The item and modifier lookups are independent — run them in parallel so
  // creation costs one round trip here, not two sequential ones.
  const modIds = data.items.flatMap((i) => i.modifications);
  const [menuRows, modRows] = await Promise.all([
    db
      .select()
      .from(menuItems)
      .where(inArray(menuItems.id, data.items.map((i) => i.menuItemId))),
    modIds.length
      ? db
          .select()
          .from(menuCustomisations)
          .where(inArray(menuCustomisations.id, modIds))
      : Promise.resolve([]),
  ]);
  const menuById = new Map(menuRows.map((m) => [m.id, m]));
  const modById = new Map(modRows.map((m) => [m.id, m]));

  // AT-202 / L48: shots above 1 only on a drink whose recipe holds coffee —
  // never a surcharge on a hot chocolate. Refused before anything is written.
  const multiShot = data.items.filter((i) => i.shots > 1);
  if (multiShot.length > 0) {
    const recipeIds = multiShot
      .map((i) => menuById.get(i.menuItemId)?.recipeId)
      .filter((r): r is string => typeof r === "string");
    const coffee = await readCoffeeRecipeIds(db, recipeIds);
    for (const i of multiShot) {
      const mi = menuById.get(i.menuItemId);
      if (mi && !(mi.recipeId && coffee.has(mi.recipeId))) {
        return { ok: false, code: "SHOTS_NOT_ALLOWED", message: shotsNotAllowedMessage(mi.name) };
      }
    }
  }

  const lines: PricedLine[] = [];
  for (const item of data.items) {
    const mi = menuById.get(item.menuItemId);
    if (!mi) {
      return {
        ok: false,
        code: "UNKNOWN_MENU_ITEM",
        message: `Unknown menu item: ${item.menuItemId}`,
      };
    }
    // Reject before payment if a recipe ingredient can't be fulfilled — the
    // barista shouldn't charge a customer for a drink that's out of stock and
    // then discover it when they hit "Start Making" (rule L01 still holds: no
    // stock is actually deducted here, this is a read-only availability check).
    if (mi.recipeId) {
      const stock = await checkRecipeStock(mi.recipeId, item.quantity, db);
      if (!stock.ok) {
        return {
          ok: false,
          code: "OUT_OF_STOCK",
          message: `${mi.name} is unavailable right now — out of ${stock.itemName}.`,
        };
      }
    }
    const mods = item.modifications.map((id) => ({
      priceDeltaZar: modById.get(id)?.priceDeltaZar ?? 0,
    }));
    lines.push({
      unitPriceZar: mi.currentPriceZar,
      quantity: item.quantity,
      modifications: mods,
      surchargeZar: surchargeFor(item.shots),
    });
  }
  // AT-202 part 1, interim: never a voucher on a line carrying an extra-shot
  // surcharge (decideRedeem's VOUCHER_NOT_ON_EXTRA_SHOTS). Refused and audited
  // before anything is written. The free cup is weekday-only, where the
  // surcharge is never in force, so it is unaffected.
  if (data.items.some((_, i) => voucherCounts[i] > 0 && (lines[i].surchargeZar ?? 0) > 0)) {
    return rejectVoucherOrder(
      orderId, session, { code: "VOUCHER_NOT_ON_EXTRA_SHOTS", message: VOUCHER_NOT_ON_EXTRA_SHOTS }, voucherCounts
    );
  }

  // §7.0.2 order_gross: quantity × (unit + mods + surcharge), summed.
  const grossZar = computeOrderTotalZar(lines);
  // AT-181 B1: per-unit priced mods, from the same deltas that priced the line.
  const modsZarByLine = lines.map((l) => l.modifications.reduce((sum, m) => sum + m.priceDeltaZar, 0));

  // ── L03 free weekday cup — applied automatically, no tap (REQ-024) ─────────
  // It only applies on a weekday, where the surcharge is 0 (T09), so its one
  // unit is unit_price_zar + mods_zar and never includes a surcharge.
  const freeCupLines = data.items.map((item, i) => ({
    category: menuById.get(item.menuItemId)!.category,
    unitPriceZar: menuById.get(item.menuItemId)!.currentPriceZar,
    modsZar: modsZarByLine[i],
    quantity: item.quantity,
  }));

  const baseItemRows = data.items.map((item, i) => {
    const mi = menuById.get(item.menuItemId)!;
    const mods = item.modifications
      .map((id) => modById.get(id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => ({ id: m.id, name: m.name, priceDeltaZar: m.priceDeltaZar }));
    return {
      // A vouchered line needs its id now: voucher_redemptions references it.
      ...(voucherCounts[i] > 0 ? { id: crypto.randomUUID() } : {}),
      orderId,
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      unitPriceZar: mi.currentPriceZar,
      modsZar: modsZarByLine[i],
      modifications: mods,
      // AT-202: one row per input line — a different shot count is a
      // different line (L37), never merged by menu item.
      shots: item.shots,
      surchargeZar: lines[i].surchargeZar ?? 0,
    };
  });

  // The transaction runs FIRST and settles the order's final total — the free
  // cup decided and its UNIQUE(customer_id, day) row inserted (or refused) —
  // and only then is a tender begun. So the payments row and whatever is
  // sent to the machine always carry exactly the committed total.
  const outcome = await db.transaction(
    async (tx): Promise<
      { totalZar: number; freeCup: FreeCupResult; refusal?: undefined } | { refusal: VoucherRefusal }
    > => {
      const txDb = tx as unknown as DB;

      let decision: FreeCupDecision;
      if (!data.customerId) {
        // No customer → nothing to look up. "Weekday" here is the date alone;
        // it only decides whether the pick-a-customer hint is worth showing.
        decision = decideFreeCup({
          customer: null, customerBound: false, sessionOpen: true,
          weekdayDate: isWeekdayInSAST(receivedAt),
          weekday: isWeekdayInSAST(receivedAt), lines: freeCupLines, alreadyClaimed: false,
        });
      } else {
        const ctx = await readFreeCupContext(tx as unknown as FreeCupClient, data.customerId, day);
        decision = decideFreeCup({
          customer: ctx.customer, customerBound: true, sessionOpen: ctx.modes.length > 0,
          weekdayDate: isWeekdayInSAST(receivedAt),
          weekday: isFreeCupWeekday(ctx.modes, receivedAt),
          lines: freeCupLines, alreadyClaimed: ctx.alreadyClaimed,
        });
      }
      const discountZar = decision.status === "apply" ? decision.discountZar : 0;

      // ── §6.9 vouchers — decided before anything is written (L41, L42) ──────
      type PlannedLine = { index: number; perVoucherZar: number[]; lineDiscountZar: number };
      let vouchers: null | {
        sessionId: string; recorded: number; kind: string; lines: PlannedLine[]; discountZar: number;
      } = null;
      if (vouchersOnOrder > 0) {
        const open = await lockOpenSession(txDb, receivedAt);
        if (!open) return { refusal: { code: "NO_SESSION", message: "Open the session first." } };
        const kind = data.voucherKind ?? (open.voucherKindsActive.length === 1 ? open.voucherKindsActive[0] : "");
        const planned: PlannedLine[] = [];
        for (const [i, row] of baseItemRows.entries()) {
          if (voucherCounts[i] === 0) continue;
          const plan = planLineVouchers({
            session: { mode: open.mode, voucherKindsActive: open.voucherKindsActive },
            kind,
            line: {
              quantity: row.quantity, unitPriceZar: row.unitPriceZar, modsZar: row.modsZar,
              surchargeZar: row.surchargeZar, discountZar: 0, compReason: null,
            },
            count: voucherCounts[i],
          });
          if (plan.status === "refused") return { refusal: { code: plan.code, message: plan.message } };
          planned.push({ index: i, perVoucherZar: plan.perVoucherZar, lineDiscountZar: plan.lineDiscountZar });
        }
        // L41, safest reading: the free cup and a voucher never share an
        // order. Unreachable today — the free cup needs every session today in
        // weekday mode; a voucher needs a non-weekday open session.
        if (decision.status === "apply") {
          return { refusal: { code: "VALIDATION", message: OTHER_DISCOUNT } };
        }
        vouchers = {
          sessionId: open.id, recorded: open.voucherRedemptionsRecorded, kind, lines: planned,
          discountZar: planned.reduce((sum, l) => sum + l.lineDiscountZar, 0),
        };
      }
      const voucherLineDiscount = (i: number) => vouchers?.lines.find((l) => l.index === i)?.lineDiscountZar ?? 0;

      // Total = Σ lines after discounts (REQ-150: the card sees the paid part only).
      const totalZar = grossZar - discountZar - (vouchers?.discountZar ?? 0);

      // INSERT orders first (FK), then items and audit in parallel.
      await tx.insert(orders).values({
        id: orderId,
        customerId: data.customerId ?? null,
        notificationTarget: data.notificationTarget,
        staffId: session.id,
        state: "ordered",
        totalZar,
        isStaffDiscount: decision.status === "apply",
        // REQ-153: a net-R0 order is `free` — it gets no payments row.
        paymentMode: totalZar === 0 ? "free" : null,
        placedAt: receivedAt,
        revenueDay: day,
      });

      await Promise.all([
        tx.insert(orderItems).values(
          baseItemRows.map((row, i) => ({
            ...row,
            // L03: one unit of one eligible line, never the line, never the order.
            // §6.9: a vouchered line carries one unit's price per voucher.
            discountZar: decision.status === "apply" && decision.lineIndex === i ? discountZar : voucherLineDiscount(i),
          }))
        ),
        writeAudit(
          {
            entityKind: "order",
            entityId: orderId,
            action: "create",
            actorId: session.id,
            actorRole: session.role,
            after: {
              state: "ordered", totalZar, customerId: data.customerId ?? null,
              notificationTarget: data.notificationTarget,
            },
          },
          txDb
        ),
      ]);

      if (vouchers) {
        // One voucher_redemptions row per voucher, redeemed by the barista, and
        // the session's recorded count moved under its row lock — as redeemVoucher.
        const v = vouchers;
        const redemptionRows = v.lines.flatMap((l) =>
          l.perVoucherZar.map((zar) => ({
            orderItemId: baseItemRows[l.index].id as string, sessionId: v.sessionId, voucherKind: v.kind,
            discountZar: zar, redeemedByStaffId: session.id, at: receivedAt,
          }))
        );
        const inserted = await tx
          .insert(voucherRedemptions)
          .values(redemptionRows)
          .returning({ id: voucherRedemptions.id });
        await tx
          .update(openingSessions)
          .set({ voucherRedemptionsRecorded: v.recorded + redemptionRows.length })
          .where(eq(openingSessions.id, v.sessionId));
        await writeAudit(
          {
            entityKind: "order", entityId: orderId, action: "redeem_voucher",
            actorId: session.id, actorRole: session.role,
            after: {
              sessionId: v.sessionId, voucherKind: v.kind, redemptionIds: inserted.map((r) => r.id),
              lines: v.lines.map((l) => ({
                orderItemId: baseItemRows[l.index].id, vouchers: l.perVoucherZar.length,
                lineDiscountZar: l.lineDiscountZar,
              })),
              discountZar: v.discountZar, totalZar, paymentMode: totalZar === 0 ? "free" : null,
            },
          },
          txDb
        );
      }

      if (decision.status === "apply" && data.customerId) {
        if (await insertEntitlement(tx, data.customerId, session.id, orderId, day)) {
          await writeAudit(
            {
              entityKind: "order", entityId: orderId, action: "free_cup",
              actorId: session.id, actorRole: session.role,
              after: { beneficiaryCustomerId: data.customerId, day, discountZar, totalZar },
            },
            txDb
          );
          return {
            totalZar,
            freeCup: { applied: true, code: null, message: FREE_CUP_COPY.applied, discountZar },
          };
        }
        // Lost the UNIQUE(customer_id, day) race: the order continues as paid
        // (REQ-025). Nothing is thrown, so this audit row commits.
        await tx.update(orderItems).set({ discountZar: 0 }).where(eq(orderItems.orderId, orderId));
        await tx
          .update(orders)
          .set({ totalZar: grossZar, isStaffDiscount: false, paymentMode: grossZar === 0 ? "free" : null })
          .where(eq(orders.id, orderId));
        await writeFreeCupReject(txDb, orderId, session, data.customerId, day, "ENTITLEMENT_USED", "already_claimed");
        return {
          totalZar: grossZar,
          freeCup: {
            applied: false, code: "ENTITLEMENT_USED",
            message: FREE_CUP_COPY.ENTITLEMENT_USED, discountZar: 0,
          },
        };
      }
      if (decision.status === "refused" && decision.audit && data.customerId) {
        // REQ-025 / L03: an office staff member refused is audited with
        // action='reject'. The order carries on, so the audit row commits.
        await writeFreeCupReject(txDb, orderId, session, data.customerId, day, decision.code, decision.reason);
      }
      return {
        totalZar,
        freeCup:
          decision.status === "apply"
            ? { applied: true, code: null, message: FREE_CUP_COPY.applied, discountZar }
            : { applied: false, code: decision.code, message: decision.message, discountZar: 0 },
      };
    }
  );

  // A voucher refusal wrote nothing; its audit row is written here, outside
  // the transaction, so it always commits.
  if (outcome.refusal) return rejectVoucherOrder(orderId, session, outcome.refusal, voucherCounts);

  // REQ-026 / P1: the order and its items are committed above; ONLY NOW does
  // beginTender write the `pending` payments row (under the order's row lock,
  // at the order's committed total), and nothing is sent from here — the
  // screen sends it with sendToTerminal. REQ-153: a net-R0 order (a free cup,
  // or fully vouchered) begins no tender at all — no payments row, nothing
  // sent (it is payment_mode 'free').
  let tender: CreateOrderTender = null;
  let fundDraw: CreateOrderFundDraw | undefined;
  if (data.donorFundId !== undefined) {
    // AT-203 / L47: the fund is the tender — no payments row, nothing sent. A
    // refusal (FUND_INSUFFICIENT, FUND_NOT_LINKED, FUND_UNAVAILABLE for an R0
    // order, …) is returned beside the committed order, which stays unpaid and
    // can still go to the card (beginTender).
    const actor = { kind: "staff" as const, staffId: session.id, role: session.role };
    try {
      const drawn = await drawFromDonorFund(getFundDeps(), actor, orderId, data.donorFundId);
      fundDraw = drawn.ok
        ? { ok: true, fundId: drawn.fundId, amountZar: drawn.amountZar, balanceAfterZar: drawn.balanceAfterZar }
        : { ok: false, code: drawn.code, message: drawn.message };
    } catch (err) {
      // The draw's transaction rolled back: nothing was drawn.
      console.error("[createOrder] drawFromDonorFund failed", err);
      fundDraw = { ok: false, code: "FUND_UNAVAILABLE", message: "Couldn't pay from the fund — nothing was drawn. Try again." };
    }
  } else if (outcome.totalZar > 0) {
    // The order is committed: a refusal (NO_SESSION, TERMINAL_UNREACHABLE when
    // no machine is configured, …) is returned beside it, never thrown.
    // An exception inside beginTender (e.g. a database outage) comes back as
    // TENDER_NOT_BEGUN with a retry — nothing was written or sent.
    try {
      const begun = await startTender({ kind: "staff", staffId: session.id, role: session.role }, orderId);
      tender = begun.ok
        ? { ok: true, attempt: begun.attempt, amountZar: begun.amountZar }
        : { ok: false, code: begun.code, message: begun.message, ...("retryOffered" in begun ? { retryOffered: begun.retryOffered } : {}) };
    } catch (err) {
      console.error("[createOrder] beginTender failed", err);
      tender = { ...TENDER_NOT_BEGUN };
    }
  }

  // Look up customer name for the queue display (walk-in orders have no customer).
  let newOrderCustomerName: string | null = null;
  if (data.customerId) {
    const [cust] = await db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, data.customerId));
    newOrderCustomerName = cust?.name ?? null;
  }

  // Notify the live queue board that a new order is waiting.
  notifyOrderChange({
    type: "state_change",
    orderId,
    state: "ordered",
    at: new Date().toISOString(),
    customerName: newOrderCustomerName,
  }).catch(() => {}); // Non-fatal

  return {
    ok: true,
    data: {
      orderId,
      cardCheckout: tender?.ok === true || fundDraw?.ok === true,
      totalZar: outcome.totalZar,
      freeCup: outcome.freeCup,
      tender,
      ...(fundDraw !== undefined ? { fundDraw } : {}),
    },
  };
}

/** A createOrder refused for its vouchers: audited action='reject', nothing else written. */
async function rejectVoucherOrder(
  orderId: string,
  session: { id: string; role: string },
  refusal: VoucherRefusal,
  voucherCounts: number[]
): Promise<{ ok: false; code: string; message: string }> {
  await writeAudit({
    entityKind: "order", entityId: orderId, action: "reject",
    actorId: session.id, actorRole: session.role,
    after: { attempted: "create_with_vouchers", code: refusal.code, voucherCounts },
    reason: refusal.code,
  });
  return { ok: false, code: refusal.code, message: refusal.message };
}

// Local errors used to surface structured failures out of transactions
// without leaking exception details across the client boundary.
class TransitionError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID_TRANSITION" | "PAYMENT_REQUIRED",
    message: string
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

class CancelError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "CancelError";
  }
}

/**
 * Move an order through the state machine.
 *
 * On `ordered → in_progress`: deducts stock atomically inside a transaction
 *   (rule L01 / R5). Returns OUT_OF_STOCK if any ingredient lot is empty.
 * On `in_progress → ready`:  sends the order-ready push to known customers.
 *
 * All DB mutations (state change + deduction + audit) are wrapped in a single
 * transaction so every failure rolls back the full operation.
 * Side effects (push, pg_notify) fire after the transaction commits.
 */
export async function transitionOrder(
  orderId: string,
  toState: OrderState
): Promise<ActionResult<Order>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  // Fast existence check — avoids opening a transaction for a clearly missing ID.
  const [exists] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!exists) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }

  // Track whether we need to send the ready-push after the transaction.
  let pushSubscription: unknown = null;
  let pushCustomerName: string | null = null;
  let pushCustomerId: string | null = null;

  try {
    const refused = await db.transaction(async (tx): Promise<ActionResult<Order> | null> => {
      const txDb = tx as unknown as DB;

      // ── 0. Lock the row for the duration of this transaction ───────────────
      // SELECT FOR UPDATE makes the canTransition check and the state UPDATE
      // atomic: any concurrent transitionOrder call blocks here until we commit,
      // so two requests cannot both pass the guard and both apply their writes.
      // This eliminates the TOCTOU race between reading state and updating it.
      const [current] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");

      if (!current) throw new TransitionError("NOT_FOUND", "Order not found.");
      // AT-207 / §10.3.3: the close wrote this order off; that is its outcome,
      // and the day's daily_closes figure was taken from it. Returned, not
      // thrown, so the reject audit commits; nothing else is written.
      if (current.writtenOffAt) {
        await writeAudit(
          {
            entityKind: "order", entityId: orderId, action: "reject",
            actorId: session.id, actorRole: session.role,
            after: { attempted: "transition", code: "ORDER_WRITTEN_OFF", state: current.state, toState },
            reason: "ORDER_WRITTEN_OFF",
          },
          txDb
        );
        return {
          ok: false,
          code: "ORDER_WRITTEN_OFF",
          message: "This order was written off at the daily close and cannot be moved on.",
        };
      }
      if (!canTransition(current.state, toState)) {
        throw new TransitionError(
          "INVALID_TRANSITION",
          `Cannot move order from ${current.state} to ${toState}.`
        );
      }

      // ── Cash-remove guard (AT-122): ordered → in_progress requires a
      // successful payment for non-free orders — or, REQ-008 / S4, an attempt
      // that was SENT and ended `unresolved`: "the order enters the queue and
      // the drink is made" while recovery asks Yoco. A declined, a pending or a
      // never-sent closed-out attempt does not open it. Free orders (totalZar
      // === 0) need no payment row. Every attempt is read (ORDER BY attempt).
      // Bypass when YOCO_SECRET_KEY is absent (dev/simulation mode — no real Yoco). ──
      // AT-203 / L47: an order settled from a blessing fund is paid — it holds
      // a spend entry and, by design, no payments row.
      if (
        toState === "in_progress" &&
        current.totalZar > 0 &&
        current.paymentMode !== "donor_fund" &&
        process.env.YOCO_SECRET_KEY
      ) {
        const attempts = await tx
          .select({ status: payments.status, sentAt: payments.sentAt })
          .from(payments)
          .where(eq(payments.orderId, orderId))
          .orderBy(payments.attempt);
        const mayMake = attempts.some((p) => p.status === "successful" || isUnresolvedNeedingAttention(p));
        if (!mayMake) {
          throw new TransitionError(
            "PAYMENT_REQUIRED",
            "Order cannot start — card payment not yet confirmed."
          );
        }
      }

      // ── 1. Update order state ──────────────────────────────────────────────
      await tx
        .update(orders)
        .set({
          state: toState,
          completedAt: toState === "collected" ? new Date() : current.completedAt,
        })
        .where(eq(orders.id, orderId));

      // ── 2. Deduct stock on ordered → in_progress (L01 / R5) ───────────────
      // AT-188 / REQ-106: freeze the order's COGS in this same transaction,
      // only after deduction succeeded (if it throws, no row is written).
      if (toState === "in_progress") {
        const consumed = await deductForOrder(orderId, txDb, session.id);
        await writeOrderCogs(orderId, consumed, txDb);
      }

      // ── 3. Fetch subscription for order-ready push (in_progress → ready) ──
      // §11: `ready` pushes to the registered customer and no-ops for target
      // `none` (L28) — keyed off the bound target, never inferred.
      if (toState === "ready" && current.notificationTarget === "customer" && current.customerId) {
        const [cust] = await tx
          .select({ name: customers.name, pushSubscription: customers.pushSubscription })
          .from(customers)
          .where(eq(customers.id, current.customerId));
        pushSubscription = cust?.pushSubscription ?? null;
        pushCustomerName = cust?.name ?? null;
        pushCustomerId = current.customerId ?? null;
      }

      // ── 4. Audit ───────────────────────────────────────────────────────────
      await writeAudit(
        {
          entityKind: "order",
          entityId: orderId,
          action: "transition",
          actorId: session.id,
          actorRole: session.role,
          before: { state: current.state },
          after: { state: toState },
        },
        txDb
      );
      return null;
    });
    if (refused) return refused;
  } catch (err) {
    if (err instanceof TransitionError) {
      return { ok: false, code: err.code, message: err.message };
    }
    if (err instanceof DeductionError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err; // Unexpected — let Next.js error boundary handle it
  }

  // ── Post-transaction side effects (non-fatal) ──────────────────────────────

  // Notify SSE queue listeners of the state change.
  notifyOrderChange({
    type: "state_change",
    orderId,
    state: toState,
    at: new Date().toISOString(),
    customerName: pushCustomerName ?? undefined,
  }).catch(() => {}); // POS resyncs on reconnect if this drops

  // Push to customer device when order is ready.
  // On 410 Gone, null out the stale subscription so we don't retry it forever.
  if (toState === "ready" && pushSubscription && isValidPushSubscription(pushSubscription)) {
    sendOrderReadyPush(pushSubscription, orderId, pushCustomerName ?? undefined)
      .then((alive) => {
        if (!alive && pushCustomerId) {
          const custId = pushCustomerId;
          db.transaction(async (tx) => {
            const txDb = tx as unknown as DB;
            const cleared = await tx
              .update(customers)
              .set({ pushSubscription: null })
              .where(
                and(
                  eq(customers.id, custId),
                  eq(customers.pushSubscription, pushSubscription as Record<string, unknown>)
                )
              )
              .returning({ id: customers.id });

            if (cleared.length === 0) return;

            await writeAudit(
              {
                entityKind: "customer",
                entityId: custId,
                action: "push_unsubscribe",
                actorId: custId,
                actorRole: "customer",
              },
              txDb
            );
          }).catch(() => {});
        }
      })
      .catch((err: unknown) => {
        console.error("[push] sendOrderReadyPush failed for order", orderId, err);
      });
  }

  return await loadOrder(orderId);
}

/** States from which a cancel reverses stock and needs an admin (T6, REQ-040). */
const STARTED_STATES: readonly OrderState[] = ["in_progress", "ready", "collected"];

/** PRD §6.0.7 T6: the admin PIN prompt "stating what it is for". */
const CANCEL_NEEDS_ADMIN = {
  ok: false as const,
  code: "FORBIDDEN",
  message: "Cancelling a started order reverses stock. Needs an admin.",
};

/**
 * Cancel an order (PRD §11.3 cancelOrder, T6, DEC-10, REQ-040).
 *  - `ordered`: a barista may cancel outright; nothing was deducted.
 *  - `in_progress` onward: needs an admin — the caller is an Admin, or a
 *    barista passes `adminPin` (a single-action override: no admin session is
 *    created, REQ-063, and audit_log.on_behalf_of_staff_id names the admin).
 *    Compensating stock_movements rows are written for every deduction the
 *    order made; the originals are never edited. L02: no money moves.
 *  - Never while a tender attempt is open (REQ-028, TENDER_IN_PROGRESS).
 * Every refusal is returned with its reject audit committed.
 */
export async function cancelOrder(
  orderId: string,
  reason: string,
  adminPin?: string
): Promise<ActionResult> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  // Fast existence check before opening a transaction.
  const [exists] = await db
    .select({ id: orders.id, state: orders.state })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!exists) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }

  const rejectCancel = async (client: DB | undefined, code: string, message: string, detail: Record<string, unknown> = {}) => {
    await writeAudit(
      {
        entityKind: "order", entityId: orderId, action: "reject",
        actorId: session.id, actorRole: session.role,
        after: { attempted: "cancel", code, ...detail },
        reason: code,
      },
      client
    );
    return { ok: false as const, code, message };
  };

  // The admin PIN is checked before the row lock (bcrypt is slow), and only
  // when a barista cancels a started order.
  let overridingAdminId: string | null = null;
  if (adminPin !== undefined && session.role === "barista" && STARTED_STATES.includes(exists.state)) {
    const pin = await verifyAdminPin(adminPin, session);
    if (!pin.ok) return rejectCancel(undefined, pin.code, pin.message, { state: exists.state, adminPin: "refused" });
    overridingAdminId = pin.adminStaffId;
  }

  try {
    const refused = await db.transaction(async (tx): Promise<ActionResult | null> => {
      const txDb = tx as unknown as DB;

      // SELECT FOR UPDATE serializes concurrent cancel attempts on the same order.
      // The state check and the UPDATE are now atomic — a second request will
      // block here until we commit, then re-read the already-cancelled state.
      const [current] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");

      if (!current) throw new CancelError("NOT_FOUND", "Order not found.");
      const started = STARTED_STATES.includes(current.state);
      if (current.state !== "ordered" && !started) {
        return rejectCancel(txDb, "CONFLICT", `This order is already ${current.state}.`, { state: current.state });
      }

      // AT-207 / §10.3.3: the close wrote this order off; that is its outcome.
      // Returned, not thrown, so the reject audit commits.
      if (current.writtenOffAt) {
        return rejectCancel(
          txDb,
          "ORDER_WRITTEN_OFF",
          "This order was written off at the daily close and cannot be cancelled."
        );
      }

      // REQ-028 / P4: no cancel while a tender attempt is open (pending, or
      // sent and unresolved). Returned, not thrown, so the reject audit commits.
      const attempts = await tx
        .select({ status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId, attempt: payments.attempt })
        .from(payments)
        .where(eq(payments.orderId, orderId))
        .orderBy(payments.attempt);
      const open = attempts.find(isAttemptOpen);
      if (open) {
        await writeAudit(
          {
            entityKind: "order", entityId: orderId, action: "reject",
            actorId: session.id, actorRole: session.role,
            after: { attempted: "cancel", code: "TENDER_IN_PROGRESS", openAttempt: open.attempt, openStatus: open.status },
            reason: "TENDER_IN_PROGRESS",
          },
          txDb
        );
        return TENDER_IN_PROGRESS;
      }

      // T6 / §10.7: from in_progress on, a barista needs an admin PIN.
      const override = started && session.role !== "admin";
      if (override && !overridingAdminId) {
        await writeAudit(
          {
            entityKind: "order", entityId: orderId, action: "reject",
            actorId: session.id, actorRole: session.role,
            after: { attempted: "cancel", code: CANCEL_NEEDS_ADMIN.code, state: current.state },
            reason: "admin_pin_required",
          },
          txDb
        );
        return CANCEL_NEEDS_ADMIN;
      }

      // REQ-040: compensating stock_movements, originals never edited. One
      // inverse row per deduction the order made: same lot, same drink, the
      // delta negated, so every SUM(-delta) over kind='deduction' (cups made,
      // cost per cup) nets this order to zero. Written only on the started
      // path (S8a: nothing is deducted before in_progress).
      let compensating: { inventoryLotId: string; delta: number; at: Date }[] = [];
      if (started) {
        const deducted = await tx
          .select({
            inventoryLotId: stockMovements.inventoryLotId,
            delta: stockMovements.delta,
            menuItemId: stockMovements.menuItemId,
            at: stockMovements.at,
          })
          .from(stockMovements)
          .where(and(
            eq(stockMovements.relatedOrderId, orderId),
            eq(stockMovements.kind, "deduction"),
            lt(stockMovements.delta, 0),
          ));
        compensating = deducted.map((m) => ({ inventoryLotId: m.inventoryLotId, delta: -m.delta, at: m.at }));
        if (deducted.length > 0) {
          await tx.insert(stockMovements).values(
            deducted.map((m) => ({
              inventoryLotId: m.inventoryLotId,
              delta: -m.delta,
              kind: "deduction" as const,
              relatedOrderId: orderId,
              menuItemId: m.menuItemId,
              byStaffId: session.id,
              // Stamped with the ORIGINAL deduction's time, so the reversal
              // lands in the same day/week/month as the deduction it cancels.
              // A new row; the original is untouched.
              at: m.at,
            }))
          );
        }
      }

      // AT-203 / REQ-168: a fund-paid order gives its draw back to the fund as
      // a compensating `adjustment`; the spend entry is never edited. Not a
      // refund — no money leaves FAVO (§6.10.5). Same transaction as the
      // cancel, after every refusal above, on either path (§6.10.5: "the fund
      // reversal rides that same path").
      if (current.paymentMode === "donor_fund") {
        await compensateFundDraw(
          fundTxOn(txDb),
          { kind: "staff", staffId: session.id, role: session.role },
          orderId,
          reason,
          new Date()
        );
      }

      await tx.update(orders).set({ state: "cancelled" }).where(eq(orders.id, orderId));
      await writeAudit(
        {
          entityKind: "order",
          entityId: orderId,
          action: "cancel",
          actorId: session.id,
          actorRole: session.role,
          ...(override && overridingAdminId ? { onBehalfOfStaffId: overridingAdminId } : {}),
          before: { state: current.state },
          after: started ? { state: "cancelled", compensatingMovements: compensating } : { state: "cancelled" },
          reason,
        },
        txDb
      );
      return null;
    });
    if (refused) return refused;
  } catch (err) {
    if (err instanceof CancelError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  // T6: "The order leaves the queue immediately", on either path.
  notifyOrderChange({ type: "state_change", orderId, state: "cancelled", at: new Date().toISOString() }).catch(() => {});
  return { ok: true, data: undefined };
}

/** PRD §6.0.1 copy for TENDER_IN_PROGRESS (P4). */
const TENDER_IN_PROGRESS = {
  ok: false as const,
  code: "TENDER_IN_PROGRESS",
  message: "This order is at the card machine — finish or cancel the payment first",
};

// ─── L03 free weekday cup (AT-183 / AT-184) ──────────────────────────────────
// createOrder applies it automatically; applyFreeCoffee is the PRD-named action
// (§11, renamed from applyStaffDiscount) for an order that already exists;
// declineFreeCoffee is the barista's one tap to decline. One unit of one
// eligible line, written to order_items.discount_zar — never the line, never
// the order. UNIQUE(customer_id, day) on staff_entitlement_log is the cap.

type FreeCupClient = Pick<DB, "select">;

/** Everything the decision needs about the beneficiary, read in parallel. */
async function readFreeCupContext(client: FreeCupClient, customerId: string, day: string) {
  const [customerRows, sessionRows, claimedRows] = await Promise.all([
    client.select({ status: customers.status }).from(customers).where(eq(customers.id, customerId)),
    client
      .select({ mode: openingSessions.mode })
      .from(openingSessions)
      .where(eq(openingSessions.sessionDate, day)),
    client
      .select({ id: staffEntitlementLog.id })
      .from(staffEntitlementLog)
      .where(and(eq(staffEntitlementLog.customerId, customerId), eq(staffEntitlementLog.day, day)))
      .limit(1),
  ]);
  return {
    customer: customerRows[0] ?? null,
    modes: sessionRows.map((r) => r.mode),
    alreadyClaimed: claimedRows.length > 0,
  };
}

/** The race guarantee: false when UNIQUE(customer_id, day) already holds a row. */
async function insertEntitlement(
  tx: Pick<DB, "insert">,
  customerId: string,
  appliedByStaffId: string,
  orderId: string,
  day: string
): Promise<boolean> {
  const inserted = await tx
    .insert(staffEntitlementLog)
    .values({ customerId, appliedByStaffId, orderId, day })
    .onConflictDoNothing()
    .returning({ id: staffEntitlementLog.id });
  return inserted.length > 0;
}

/** REQ-025: a refused free cup is audited with action='reject'. */
async function writeFreeCupReject(
  txDb: DB,
  orderId: string,
  session: { id: string; role: string },
  customerId: string,
  day: string,
  code: FreeCupRefusalCode,
  reason: string
): Promise<void> {
  await writeAudit(
    {
      entityKind: "order", entityId: orderId, action: "reject",
      actorId: session.id, actorRole: session.role,
      after: { attempted: "free_cup", code, reason, beneficiaryCustomerId: customerId, day },
      reason: code,
    },
    txDb
  );
}

/**
 * Apply the L03 free cup to an existing, unpaid order (PRD §11:
 * applyFreeCoffee(orderId, beneficiaryCustomerId)). The beneficiary must be a
 * `customers` row with status='office_staff'; a FAVO-staff id is NOT_ELIGIBLE.
 * One free cup per order; only while no card checkout exists. Refusals are
 * returned, not thrown, so their reject audit commits.
 */
export async function applyFreeCoffee(
  orderId: string,
  beneficiaryCustomerId: string
): Promise<ActionResult<{ totalZar: number }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;
  const now = new Date();
  const day = revenueDay(now);

  return db.transaction(async (tx): Promise<ActionResult<{ totalZar: number }>> => {
    const txDb = tx as unknown as DB;
    const [current] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!current) return { ok: false, code: "NOT_FOUND", message: "Order not found." };
    if (current.state !== "ordered") return ORDER_MOVED_ON;
    const { hasPayments, refusal } = await lockPaymentForTotalChange(tx, current);
    if (refusal) return refusal;
    if (current.isStaffDiscount) {
      return { ok: false, code: "NOT_ELIGIBLE", message: "This order already has a free cup." };
    }

    const lines = await tx
      .select({
        id: orderItems.id,
        quantity: orderItems.quantity,
        unitPriceZar: orderItems.unitPriceZar,
        modsZar: orderItems.modsZar,
        discountZar: orderItems.discountZar,
        category: menuItems.category,
      })
      .from(orderItems)
      .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(eq(orderItems.orderId, orderId));

    const ctx = await readFreeCupContext(tx as unknown as FreeCupClient, beneficiaryCustomerId, day);
    const decision = decideFreeCup({
      customer: ctx.customer,
      customerBound: true,
      sessionOpen: ctx.modes.length > 0,
      weekdayDate: isWeekdayInSAST(now),
      weekday: isFreeCupWeekday(ctx.modes, now),
      // L41: a line that already carries a discount cannot take another.
      lines: lines.map((l) => ({ ...l, category: l.discountZar > 0 ? null : l.category })),
      alreadyClaimed: ctx.alreadyClaimed,
    });

    if (decision.status === "refused") {
      if (decision.audit) {
        await writeFreeCupReject(txDb, orderId, session, beneficiaryCustomerId, day, decision.code, decision.reason);
      }
      return { ok: false, code: decision.code, message: decision.message ?? FREE_CUP_COPY[decision.code] };
    }

    const totalZar = current.totalZar - decision.discountZar;
    // REQ-153 wants an R0 order to have no payments row, and no payments row
    // is ever deleted — so a row-carrying order cannot be taken to R0 here.
    if (hasPayments && totalZar === 0) return CHECKOUT_EXISTS;

    if (!(await insertEntitlement(tx, beneficiaryCustomerId, session.id, orderId, day))) {
      await writeFreeCupReject(txDb, orderId, session, beneficiaryCustomerId, day, "ENTITLEMENT_USED", "already_claimed");
      return { ok: false, code: "ENTITLEMENT_USED", message: FREE_CUP_COPY.ENTITLEMENT_USED };
    }

    const line = lines[decision.lineIndex];
    await tx.update(orderItems).set({ discountZar: decision.discountZar }).where(eq(orderItems.id, line.id));
    await tx
      .update(orders)
      .set({ totalZar, isStaffDiscount: true, paymentMode: totalZar === 0 ? "free" : current.paymentMode })
      .where(eq(orders.id, orderId));
    await writeAudit(
      {
        entityKind: "order", entityId: orderId, action: "free_cup",
        actorId: session.id, actorRole: session.role,
        before: { totalZar: current.totalZar },
        after: { beneficiaryCustomerId, day, orderItemId: line.id, discountZar: decision.discountZar, totalZar },
      },
      txDb
    );
    return { ok: true, data: { totalZar } };
  });
}

/**
 * The barista's one tap to decline an automatically applied free cup
 * (REQ-024). Removes the beneficiary's entitlement row for this order — so the
 * cup is still available to that person later today — clears the discount on
 * the line it paid for, restores the order total, and audits it. Only while
 * the order is `ordered` and no tender attempt is open (owner rule, P4). If the
 * order was free (no payments row, REQ-153) it becomes chargeable; this writes
 * no payments row itself — the screen then begins a tender (beginTender) at
 * the committed new total, before anything is sent (REQ-026).
 */
export async function declineFreeCoffee(
  orderId: string
): Promise<ActionResult<{ totalZar: number }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  return db.transaction(
    async (tx): Promise<ActionResult<{ totalZar: number }>> => {
      const txDb = tx as unknown as DB;
      const [current] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!current) return { ok: false, code: "NOT_FOUND", message: "Order not found." };
      if (current.state !== "ordered") return ORDER_MOVED_ON;
      const { refusal } = await lockPaymentForTotalChange(tx, current);
      if (refusal) return refusal;

      // Pair the cup with its line: the order carries at most one free cup
      // (createOrder applies one; applyFreeCoffee refuses a second), and the
      // free cup is the only mechanism that writes discount_zar today (L41).
      const entitlements = await tx
        .select({ id: staffEntitlementLog.id, customerId: staffEntitlementLog.customerId, day: staffEntitlementLog.day })
        .from(staffEntitlementLog)
        .where(eq(staffEntitlementLog.orderId, orderId));
      const entitlement =
        entitlements.find((e) => e.customerId === current.customerId) ??
        (entitlements.length === 1 ? entitlements[0] : undefined);
      if (!entitlement) return { ok: false, code: "NOT_FOUND", message: "No free cup on this order." };

      const lines = await tx
        .select({ id: orderItems.id, unitPriceZar: orderItems.unitPriceZar, discountZar: orderItems.discountZar })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      const discounted = lines.filter((l) => l.discountZar > 0);
      if (discounted.length !== 1) {
        return { ok: false, code: "NOT_FOUND", message: "Can't match the free cup to a line on this order." };
      }
      const line = discounted[0];
      const totalZar = current.totalZar + line.discountZar;

      await tx.delete(staffEntitlementLog).where(eq(staffEntitlementLog.id, entitlement.id));
      await tx.update(orderItems).set({ discountZar: 0 }).where(eq(orderItems.id, line.id));
      await tx
        .update(orders)
        .set({ totalZar, isStaffDiscount: false, paymentMode: totalZar === 0 ? "free" : null })
        .where(eq(orders.id, orderId));
      await writeAudit(
        {
          entityKind: "order", entityId: orderId, action: "decline_free_cup",
          actorId: session.id, actorRole: session.role,
          before: {
            totalZar: current.totalZar, beneficiaryCustomerId: entitlement.customerId,
            day: entitlement.day, orderItemId: line.id, discountZar: line.discountZar,
          },
          after: { totalZar },
        },
        txDb
      );
      return { ok: true, data: { totalZar } };
    }
  );
}

// confirmManualPayment ("Mark as paid") is gone (AT-201 part 2b). It let a
// barista's tap set payments.status='successful' — a human assertion creating
// revenue, which PRD v7.0 §10.2.1 removes ("Exactly two paths may write
// status='successful' … and no others"; confirmExternalTender, §11.1). The
// PRD's manual path is deferred mode (§6.0.4 T3: setDeferredMode, then
// settleDeferredOrder — a lookup, a fresh send, or the standalone machine's
// reference), which is not built yet.

// ─── helpers ────────────────────────────────────────────────────────────────

/** Reload an order with its items into the shared Order shape, including menu item names. */
async function loadOrder(orderId: string): Promise<ActionResult<Order>> {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) return { ok: false, code: "NOT_FOUND", message: "Order not found." };

  const [itemRows, attemptRows, customerRow] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        menuItemId: orderItems.menuItemId,
        menuItemName: menuItems.name,
        quantity: orderItems.quantity,
        unitPriceZar: orderItems.unitPriceZar,
        discountZar: orderItems.discountZar,
        modifications: orderItems.modifications,
        shots: orderItems.shots,
        surchargeZar: orderItems.surchargeZar,
      })
      .from(orderItems)
      .leftJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
      .where(eq(orderItems.orderId, orderId)),
    db
      .select({ status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId })
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(payments.attempt),
    o.customerId
      ? db
          .select({ name: customers.name })
          .from(customers)
          .where(eq(customers.id, o.customerId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const payState = summarisePayments(attemptRows);

  const order: Order = {
    id: o.id,
    customerId: o.customerId,
    customerName: customerRow[0]?.name ?? null,
    staffId: o.staffId,
    state: o.state,
    placedAt: o.placedAt.toISOString(),
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    totalZar: o.totalZar,
    isStaffDiscount: o.isStaffDiscount,
    paymentStatus: payState.paymentStatus,
    // AT-203 / REQ-167: a fund-settled order is frozen too.
    cardCheckout: payState.totalFrozen || o.paymentMode === "donor_fund",
    paymentAwaitingLookup: payState.awaitingLookup,
    items: itemRows.map((it) => ({
      id: it.id,
      menuItemId: it.menuItemId,
      menuItemName: it.menuItemName ?? it.menuItemId,
      quantity: it.quantity,
      unitPriceZar: it.unitPriceZar,
      discountZar: it.discountZar,
      modifications:
        (it.modifications as { id: string; name: string; priceDeltaZar: number }[]) ??
        [],
      shots: it.shots,
      surchargeZar: it.surchargeZar,
    })),
  };
  return { ok: true, data: order };
}

/** Bootstrap the POS queue on page load — returns non-terminal orders from the last 48 h. */
export async function listActiveOrders(): Promise<ActionResult<{ orderId: string; state: OrderState; lastUpdatedAt: string; customerName: string | null }[]>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;

  // 48-hour window covers orders that span the SAST midnight boundary and any
  // that are stuck in a non-terminal state from the previous shift.
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: orders.id,
      state: orders.state,
      placedAt: orders.placedAt,
      customerName: customers.name,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(and(notInArray(orders.state, ["collected", "cancelled"]), gte(orders.placedAt, cutoff)))
    .orderBy(orders.placedAt);

  return {
    ok: true,
    data: rows.map((r) => ({
      orderId: r.id,
      state: r.state,
      lastUpdatedAt: r.placedAt.toISOString(),
      customerName: r.customerName ?? null,
    })),
  };
}
