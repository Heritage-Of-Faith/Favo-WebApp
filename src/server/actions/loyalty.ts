"use server";

// Loyalty server actions — AT-109 (redeemLoyalty multi-unit), G9 (topUpWallet, purchasePack)
// AT-127 (getLoyaltyLiabilityReport)
// Docs: docs/API.md · BUSINESS_RULES.md L06, L16

import { desc, eq, sql, count, and, gte, lte, lt, gt, max, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, customers, loyaltyTransactions, pendingCharges, coffeePacks, menuItems, payments, walletTransactions } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import {
  REDEEM_POINTS_UNIT,
  REDEEM_VALUE_ZAR,
} from "@/server/loyalty/calc";
import { createPaymentIntent } from "@/server/yoco/client";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

const PACK_EXPIRY_DAYS = 90;

// Postgres check_violation. The customers_loyalty_points_non_negative CHECK
// (migration 0020) fires when a concurrent redemption/adjustment would drive the
// balance below zero — a lost-update race two callers can win the clamp check on.
// Callers map it to a clean CONFLICT rather than letting the action throw.
const PG_CHECK_VIOLATION = "23514";
function isCheckViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err &&
    (err as { code?: string }).code === PG_CHECK_VIOLATION;
}

// ─── redeemLoyalty ────────────────────────────────────────────────────────────

/**
 * Apply a multi-unit loyalty redemption to an order before payment (AT-109).
 * Server clamps units = min(floor(pts/100), floor(total/2000)).
 * Each unit = 100 pts = R20 off. Re-creates Yoco intent for newTotalZar.
 * Idempotency: partial unique index on loyalty_transactions(order_id) WHERE kind='redeem'.
 * Rules: L06, L17.
 */
export async function redeemLoyalty(
  customerId: string,
  orderId: string,
  units: number
): Promise<ActionResult<{ discountZar: number; pointsUsed: number; newTotalZar: number; clientSecret: string | null }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!Number.isInteger(units) || units < 1) {
    return { ok: false, code: "VALIDATION_ERROR", message: "units must be a positive integer." };
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  if (order.state !== "ordered") {
    return { ok: false, code: "CONFLICT", message: "Loyalty can only be redeemed before payment (state='ordered')." };
  }
  if (order.customerId !== customerId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Customer does not match the order." };
  }
  if (order.isStaffDiscount) {
    return { ok: false, code: "CONFLICT", message: "Cannot combine loyalty redemption with a staff discount (L17)." };
  }

  const [customer] = await db
    .select({ loyaltyPoints: customers.loyaltyPoints })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) return { ok: false, code: "NOT_FOUND", message: "Customer not found." };

  // Server-side clamp: min(floor(pts/100), floor(total/2000)) — L06
  const maxByPoints = Math.floor(customer.loyaltyPoints / REDEEM_POINTS_UNIT);
  const maxByTotal = Math.floor(order.totalZar / REDEEM_VALUE_ZAR);
  const clampedUnits = Math.min(units, maxByPoints, maxByTotal);

  if (clampedUnits < 1) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Insufficient points or order total too low to redeem. Points: ${customer.loyaltyPoints}, order total: ${order.totalZar} cents.`,
    };
  }

  const pointsUsed = clampedUnits * REDEEM_POINTS_UNIT;
  const discountZar = clampedUnits * REDEEM_VALUE_ZAR;
  const newTotalZar = order.totalZar - discountZar;

  // Create new Yoco checkout outside the DB transaction (external API call).
  // Old checkout is abandoned — it expires naturally on Yoco's side.
  let newClientSecret: string | null = null;
  if (newTotalZar > 0) {
    try {
      const intent = await createPaymentIntent({
        amountZar: newTotalZar,
        metadata: { orderId, customerId, kind: "loyalty_redeem" },
      });
      newClientSecret = intent.clientSecret;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Yoco checkout creation failed.";
      return { ok: false, code: "PAYMENT_ERROR", message };
    }
  }

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      await tx
        .update(orders)
        .set({ totalZar: newTotalZar })
        .where(eq(orders.id, orderId));

      // Atomic point deduction — DB CHECK (loyalty_points >= 0) is the safety net.
      await tx
        .update(customers)
        .set({ loyaltyPoints: sql`${customers.loyaltyPoints} - ${pointsUsed}` })
        .where(eq(customers.id, customerId));

      // Partial unique index (loyalty_txn_redeem_order_unique) makes this idempotent.
      await tx.insert(loyaltyTransactions).values({
        customerId,
        orderId,
        delta: -pointsUsed,
        kind: "redeem",
      });

      // Update payment record to reflect the new total and new checkout ID.
      await tx
        .update(payments)
        .set({
          amountZar: newTotalZar,
          ...(newClientSecret ? { yocoCheckoutId: newClientSecret } : {}),
          status: newTotalZar === 0 ? "successful" : "pending",
        })
        .where(eq(payments.orderId, orderId));

      await writeAudit(
        {
          entityKind: "order",
          entityId: orderId,
          action: "redeem_loyalty",
          actorId: session.id,
          actorRole: session.role,
          before: { totalZar: order.totalZar, loyaltyPoints: customer.loyaltyPoints },
          after: { totalZar: newTotalZar, discountZar, pointsUsed, clampedUnits },
        },
        txDb
      );
    });
  } catch (err) {
    // Concurrent redemption already spent these points — the balance clamp we
    // read is stale and the DB CHECK rejected the deduction. Surface a clean
    // CONFLICT instead of a 500 (a Yoco checkout may already have been created).
    if (isCheckViolation(err)) {
      return { ok: false, code: "CONFLICT", message: "Points balance changed — please retry the redemption." };
    }
    throw err;
  }

  return { ok: true, data: { discountZar, pointsUsed, newTotalZar, clientSecret: newClientSecret } };
}

// ─── topUpWallet ──────────────────────────────────────────────────────────────

/**
 * Create a Yoco checkout for a wallet top-up. The webhook credits wallet_zar
 * on payment success (L16). Returns the clientSecret for the Yoco hosted-fields
 * form on the POS. Barista-initiated — counter-only (L16).
 */
export async function topUpWallet(
  customerId: string,
  amountZar: number
): Promise<ActionResult<{ yocoClientSecret: string }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  const MAX_TOPUP_ZAR = 100_000;   // R1,000 per top-up (L16)
  const MAX_BALANCE_ZAR = 250_000; // R2,500 max wallet balance (L16)

  if (!customerId || !Number.isInteger(amountZar) || amountZar <= 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "customerId and a positive integer amountZar are required." };
  }
  if (amountZar > MAX_TOPUP_ZAR) {
    return { ok: false, code: "VALIDATION_ERROR", message: `Single top-up cannot exceed R${MAX_TOPUP_ZAR / 100}.` };
  }

  const [customer] = await db
    .select({ id: customers.id, walletZar: customers.walletZar })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  }
  if (customer.walletZar + amountZar > MAX_BALANCE_ZAR) {
    return { ok: false, code: "CONFLICT", message: `Top-up would exceed max wallet balance of R${MAX_BALANCE_ZAR / 100}.` };
  }

  let checkoutId: string;
  try {
    const intent = await createPaymentIntent({
      amountZar,
      metadata: { chargeKind: "wallet_topup", customerId },
    });
    checkoutId = intent.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Yoco checkout creation failed.";
    return { ok: false, code: "PAYMENT_ERROR", message };
  }

  await db.insert(pendingCharges).values({
    yocoCheckoutId: checkoutId,
    kind: "wallet_topup",
    customerId,
    amountZar,
    status: "pending",
  });

  await writeAudit({
    entityKind: "customer",
    entityId: customerId,
    action: "wallet_topup_initiated",
    actorId: session.id,
    actorRole: session.role,
    after: { yocoCheckoutId: checkoutId, amountZar },
  });

  return { ok: true, data: { yocoClientSecret: checkoutId } };
}

// ─── purchasePack ─────────────────────────────────────────────────────────────

/**
 * Create a Yoco checkout for a coffee pack purchase. The webhook inserts a
 * coffee_packs row with 90-day expiry on payment success (L16). Barista-initiated.
 */
export async function purchasePack(
  customerId: string,
  menuItemId: string,
  qty: number
): Promise<ActionResult<{ yocoClientSecret: string }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!customerId || !menuItemId || typeof qty !== "number" || qty < 1) {
    return { ok: false, code: "VALIDATION_ERROR", message: "customerId, menuItemId and qty >= 1 are required." };
  }

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  }

  const [menuItem] = await db
    .select({ id: menuItems.id, currentPriceZar: menuItems.currentPriceZar })
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId));

  if (!menuItem) {
    return { ok: false, code: "NOT_FOUND", message: "Menu item not found." };
  }

  const amountZar = menuItem.currentPriceZar * qty;

  let checkoutId: string;
  try {
    const intent = await createPaymentIntent({
      amountZar,
      metadata: { chargeKind: "coffee_pack", customerId, menuItemId, qty: String(qty) },
    });
    checkoutId = intent.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Yoco checkout creation failed.";
    return { ok: false, code: "PAYMENT_ERROR", message };
  }

  await db.insert(pendingCharges).values({
    yocoCheckoutId: checkoutId,
    kind: "coffee_pack",
    customerId,
    amountZar,
    status: "pending",
    metadata: { menuItemId, qty },
  });

  await writeAudit({
    entityKind: "customer",
    entityId: customerId,
    action: "coffee_pack_initiated",
    actorId: session.id,
    actorRole: session.role,
    after: { yocoCheckoutId: checkoutId, menuItemId, qty, amountZar },
  });

  return { ok: true, data: { yocoClientSecret: checkoutId } };
}

// ─── Internal: activate a pending charge after successful Yoco webhook ────────

/**
 * Called by the webhook handler when a wallet_topup or coffee_pack payment
 * succeeds. Runs inside a transaction that also marks the pendingCharge as
 * successful, so the whole operation is atomic and idempotent.
 */
export async function activatePendingCharge(
  chargeId: string,
  tx: DB
): Promise<void> {
  const [charge] = await tx
    .select()
    .from(pendingCharges)
    .where(eq(pendingCharges.id, chargeId));

  if (!charge || charge.status !== "pending") return;

  await tx
    .update(pendingCharges)
    .set({ status: "successful" })
    .where(eq(pendingCharges.id, chargeId));

  if (charge.kind === "wallet_topup") {
    await tx
      .update(customers)
      .set({ walletZar: sql`${customers.walletZar} + ${charge.amountZar}` })
      .where(eq(customers.id, charge.customerId));

    // Append wallet ledger entry for this top-up (AT-114).
    // No loyalty points on top-up — no double-dip (L16).
    await tx.insert(walletTransactions).values({
      customerId: charge.customerId,
      deltaZar: charge.amountZar,
      kind: "topup",
      relatedPendingChargeId: chargeId,
    });

    await writeAudit(
      {
        entityKind: "customer",
        entityId: charge.customerId,
        action: "wallet_credited",
        actorRole: "system",
        after: { creditedZar: charge.amountZar, pendingChargeId: chargeId },
      },
      tx
    );
  } else if (charge.kind === "coffee_pack") {
    const meta = charge.metadata as { menuItemId?: string; qty?: number } | null;
    const menuItemId = meta?.menuItemId;
    const qty = Number(meta?.qty ?? 1);

    if (!menuItemId) return;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + PACK_EXPIRY_DAYS);

    await tx.insert(coffeePacks).values({
      customerId: charge.customerId,
      menuItemId,
      qtyOriginal: qty,
      qtyRemaining: qty,
      expiresAt,
      pendingChargeId: chargeId,
    });

    await writeAudit(
      {
        entityKind: "customer",
        entityId: charge.customerId,
        action: "coffee_pack_activated",
        actorRole: "system",
        after: { menuItemId, qty, expiresAt: expiresAt.toISOString(), pendingChargeId: chargeId },
      },
      tx
    );
  }
}

// ─── resolveStuckCharge (BUG-O2) ─────────────────────────────────────────────

/**
 * Admin-only: manually activate a pending charge whose webhook never arrived.
 * Idempotent — if the charge is already resolved, returns its current status.
 * Uses SELECT FOR UPDATE inside a transaction to prevent concurrent double-credit.
 */
export async function resolveStuckCharge(
  pendingChargeId: string
): Promise<ActionResult<{ status: "completed" | "already_resolved" }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  if (!pendingChargeId?.trim()) {
    return { ok: false, code: "VALIDATION", message: "pendingChargeId is required." };
  }

  // Fast pre-check (no lock) — avoid acquiring a lock on an already-resolved row
  const [existing] = await db
    .select({ id: pendingCharges.id, status: pendingCharges.status })
    .from(pendingCharges)
    .where(eq(pendingCharges.id, pendingChargeId));

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Pending charge not found." };
  }

  if (existing.status !== "pending") {
    return { ok: true, data: { status: "already_resolved" } };
  }

  await db.transaction(async (tx) => {
    // Lock the row so concurrent admin calls don't double-credit
    const [locked] = await tx
      .select({ id: pendingCharges.id, status: pendingCharges.status })
      .from(pendingCharges)
      .where(eq(pendingCharges.id, pendingChargeId))
      .for("update");

    if (!locked || locked.status !== "pending") return;

    await activatePendingCharge(pendingChargeId, tx as unknown as DB);

    await writeAudit(
      {
        entityKind: "pending_charge",
        entityId: pendingChargeId,
        action: "admin.resolve_stuck_charge",
        actorId: auth.session.id,
        actorRole: "admin",
        after: { resolvedBy: auth.session.id },
      },
      tx as unknown as DB
    );
  });

  return { ok: true, data: { status: "completed" } };
}

// ─── listStuckCharges (BUG-O2, admin recovery surface) ───────────────────────

// A pending charge older than this without a successful webhook is "stuck":
// Yoco webhooks normally land within seconds, so a few minutes is generous.
const STUCK_CHARGE_AGE_MINUTES = 5;

export type StuckChargeRow = {
  id: string;
  kind: "wallet_topup" | "coffee_pack";
  customerId: string;
  customerName: string;
  amountZar: number;
  yocoCheckoutId: string;
  createdAt: string; // ISO-8601
};

/**
 * Admin-only: list pending charges whose Yoco webhook never arrived (older than
 * STUCK_CHARGE_AGE_MINUTES). Feeds the "Stuck charges" recovery UI, from which
 * an admin invokes resolveStuckCharge to manually activate each one.
 */
export async function listStuckCharges(): Promise<ActionResult<{ rows: StuckChargeRow[] }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const cutoff = new Date(Date.now() - STUCK_CHARGE_AGE_MINUTES * 60 * 1000);

  const rows = await db
    .select({
      id: pendingCharges.id,
      kind: pendingCharges.kind,
      customerId: pendingCharges.customerId,
      customerName: customers.name,
      amountZar: pendingCharges.amountZar,
      yocoCheckoutId: pendingCharges.yocoCheckoutId,
      createdAt: pendingCharges.createdAt,
    })
    .from(pendingCharges)
    .innerJoin(customers, eq(pendingCharges.customerId, customers.id))
    .where(and(eq(pendingCharges.status, "pending"), lt(pendingCharges.createdAt, cutoff)))
    .orderBy(desc(pendingCharges.createdAt))
    .limit(200);

  return {
    ok: true,
    data: {
      rows: rows.map((r) => ({
        id: r.id,
        kind: r.kind as StuckChargeRow["kind"],
        customerId: r.customerId,
        customerName: r.customerName,
        amountZar: r.amountZar,
        yocoCheckoutId: r.yocoCheckoutId,
        createdAt: r.createdAt.toISOString(),
      })),
    },
  };
}

// ─── listLoyaltyAudit (AT-120) ────────────────────────────────────────────────

const LOYALTY_AUDIT_PAGE_SIZE = 50;

export type LoyaltyAuditRow = {
  id: string;
  customerId: string;
  customerName: string;
  orderId: string | null;
  delta: number;
  kind: "earn" | "redeem" | "adjustment" | "expiry";
  reason: string | null;
  at: string; // ISO-8601
};

export type ListLoyaltyAuditInput = {
  page?: number;
  kind?: "earn" | "redeem" | "adjustment" | "expiry";
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
};

export type ListLoyaltyAuditResult = {
  rows: LoyaltyAuditRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Admin loyalty transaction audit — paginated, newest-first.
 * Shows all loyalty_transactions joined with customer name (AT-120).
 * Auth: admin only.
 */
export async function listLoyaltyAudit(
  input: ListLoyaltyAuditInput = {}
): Promise<ActionResult<ListLoyaltyAuditResult>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const page = Math.max(0, input.page ?? 0);

  const conditions = [];
  if (input.kind) {
    conditions.push(eq(loyaltyTransactions.kind, input.kind));
  }
  if (input.dateFrom) {
    conditions.push(gte(loyaltyTransactions.at, new Date(`${input.dateFrom}T00:00:00+02:00`)));
  }
  if (input.dateTo) {
    conditions.push(lte(loyaltyTransactions.at, new Date(`${input.dateTo}T23:59:59+02:00`)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult, rows] = await Promise.all([
    db.select({ value: count() }).from(loyaltyTransactions).where(where),
    db
      .select({
        id: loyaltyTransactions.id,
        customerId: loyaltyTransactions.customerId,
        customerName: customers.name,
        orderId: loyaltyTransactions.orderId,
        delta: loyaltyTransactions.delta,
        kind: loyaltyTransactions.kind,
        reason: loyaltyTransactions.reason,
        at: loyaltyTransactions.at,
      })
      .from(loyaltyTransactions)
      .innerJoin(customers, eq(loyaltyTransactions.customerId, customers.id))
      .where(where)
      .orderBy(desc(loyaltyTransactions.at))
      .limit(LOYALTY_AUDIT_PAGE_SIZE)
      .offset(page * LOYALTY_AUDIT_PAGE_SIZE),
  ]);

  return {
    ok: true,
    data: {
      rows: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customerName,
        orderId: r.orderId,
        delta: r.delta,
        kind: r.kind as LoyaltyAuditRow["kind"],
        reason: r.reason,
        at: r.at.toISOString(),
      })),
      total: totalResult[0]?.value ?? 0,
      page,
      pageSize: LOYALTY_AUDIT_PAGE_SIZE,
    },
  };
}

// ─── reconcileLoyalty (AT-124 / LOY-5) ───────────────────────────────────────

/**
 * Admin-only reconciliation job: compares customers.loyalty_points (cached
 * denormalised column) against SUM(loyalty_transactions.delta) (the source of
 * truth).  Logs every discrepancy to audit_log — never auto-corrects balances.
 * Returns a drift report for the admin dashboard.
 */
export async function reconcileLoyalty(): Promise<ActionResult<{
  checked: number;
  drifted: number;
  rows: { customerId: string; name: string; cached: number; ledger: number; delta: number }[];
}>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  // Fetch all customers (id, name, cached loyalty_points)
  const allCustomers = await db
    .select({ id: customers.id, name: customers.name, loyaltyPoints: customers.loyaltyPoints })
    .from(customers);

  // Fetch ledger sums per customer (only rows that have transactions)
  const ledgerRows = await db
    .select({
      customerId: loyaltyTransactions.customerId,
      ledgerSum: sum(loyaltyTransactions.delta).mapWith(Number),
    })
    .from(loyaltyTransactions)
    .groupBy(loyaltyTransactions.customerId);

  // Build a lookup map: customerId → ledgerSum
  const ledgerMap = new Map<string, number>();
  for (const row of ledgerRows) {
    ledgerMap.set(row.customerId, row.ledgerSum ?? 0);
  }

  const driftedRows: { customerId: string; name: string; cached: number; ledger: number; delta: number }[] = [];

  for (const customer of allCustomers) {
    const ledgerSum = ledgerMap.get(customer.id) ?? 0;
    if (customer.loyaltyPoints !== ledgerSum) {
      driftedRows.push({
        customerId: customer.id,
        name: customer.name,
        cached: customer.loyaltyPoints,
        ledger: ledgerSum,
        delta: ledgerSum - customer.loyaltyPoints,
      });

      await writeAudit(
        {
          entityKind: "loyalty_reconcile",
          entityId: customer.id,
          action: "drift_detected",
          actorId: session.id,
          actorRole: session.role,
          before: { cached: customer.loyaltyPoints },
          after: { ledger: ledgerSum, delta: ledgerSum - customer.loyaltyPoints },
        },
        db as unknown as DB
      );
    }
  }

  return {
    ok: true,
    data: {
      checked: allCustomers.length,
      drifted: driftedRows.length,
      rows: driftedRows,
    },
  };
}

// ─── getLoyaltyLiabilityReport (AT-127) ───────────────────────────────────────

export type LiabilityRow = {
  customerId: string;
  name: string;
  phone: string | null;
  loyaltyPoints: number;
  liabilityZar: number;
  lastActivityAt: Date | null;
};

export type LoyaltyLiabilityReport = {
  totalPoints: number;
  totalLiabilityZar: number;
  activeCustomers: number;
  averagePoints: number;
  top10: LiabilityRow[];
  allActive: LiabilityRow[];
};

export async function getLoyaltyLiabilityReport(): Promise<ActionResult<LoyaltyLiabilityReport>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const customersWithPoints = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone, loyaltyPoints: customers.loyaltyPoints })
    .from(customers)
    .where(gt(customers.loyaltyPoints, 0));

  if (customersWithPoints.length === 0) {
    return { ok: true, data: { totalPoints: 0, totalLiabilityZar: 0, activeCustomers: 0, averagePoints: 0, top10: [], allActive: [] } };
  }

  const activityRows = await db
    .select({ customerId: loyaltyTransactions.customerId, lastActivityAt: max(loyaltyTransactions.at) })
    .from(loyaltyTransactions)
    .groupBy(loyaltyTransactions.customerId);

  const activityMap = new Map<string, Date>();
  for (const row of activityRows) {
    if (row.lastActivityAt) {
      activityMap.set(row.customerId, row.lastActivityAt);
    }
  }

  // Filter to customers active within the last 12 months
  const activeCustomers: LiabilityRow[] = customersWithPoints
    .filter((c) => {
      const last = activityMap.get(c.id);
      return last != null && last >= twelveMonthsAgo;
    })
    .map((c) => ({
      customerId: c.id,
      name: c.name,
      phone: c.phone,
      loyaltyPoints: c.loyaltyPoints,
      liabilityZar: Math.floor(c.loyaltyPoints / 100) * 2000,
      lastActivityAt: activityMap.get(c.id) ?? null,
    }))
    .sort((a, b) => b.loyaltyPoints - a.loyaltyPoints);

  const totalPoints = activeCustomers.reduce((sum, r) => sum + r.loyaltyPoints, 0);
  const totalLiabilityZar = activeCustomers.reduce((sum, r) => sum + r.liabilityZar, 0);
  const customerCount = activeCustomers.length;
  const averagePoints = customerCount > 0 ? Math.round(totalPoints / customerCount) : 0;

  return {
    ok: true,
    data: {
      totalPoints,
      totalLiabilityZar,
      activeCustomers: customerCount,
      averagePoints,
      top10: activeCustomers.slice(0, 10),
      allActive: activeCustomers,
    },
  };
}

// ─── adjustLoyalty (AT-123) ───────────────────────────────────────────────────

/**
 * Admin-only: manually adjust a customer's loyalty balance with an audited reason.
 * Inserts a loyalty_transaction (kind='adjustment') and updates customers.loyalty_points.
 * Calls writeAudit() for the full before/after trail.
 * Rules: delta must be a non-zero integer; balance cannot go below zero.
 */
export async function adjustLoyalty(
  customerId: string,
  delta: number,
  reason: string,
): Promise<ActionResult<{ newBalance: number }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  // Validate delta
  if (!Number.isInteger(delta) || delta === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "delta must be a non-zero integer." };
  }

  // Validate reason
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { ok: false, code: "VALIDATION_ERROR", message: "reason is required." };
  }

  // Look up the customer
  const [customer] = await db
    .select({ id: customers.id, loyaltyPoints: customers.loyaltyPoints })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  }

  // Floor guard: prevent balance going negative
  if (delta < 0 && customer.loyaltyPoints + delta < 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Adjustment would reduce balance below zero.",
    };
  }

  let newBalance = 0;

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      await tx.insert(loyaltyTransactions).values({
        customerId,
        delta,
        kind: "adjustment",
        reason: trimmedReason,
      });

      const [updated] = await tx
        .update(customers)
        .set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${delta}` })
        .where(eq(customers.id, customerId))
        .returning({ loyaltyPoints: customers.loyaltyPoints });

      newBalance = updated?.loyaltyPoints ?? customer.loyaltyPoints + delta;

      await writeAudit(
        {
          entityKind: "customer",
          entityId: customerId,
          action: "loyalty_adjustment",
          actorId: session.id,
          actorRole: session.role,
          before: { loyaltyPoints: customer.loyaltyPoints },
          after: { loyaltyPoints: newBalance, reason: trimmedReason },
        },
        txDb,
      );
    });
  } catch (err) {
    // A concurrent deduction won the race; our floor check was stale and the DB
    // CHECK rejected the write. Return CONFLICT rather than throwing.
    if (isCheckViolation(err)) {
      return { ok: false, code: "CONFLICT", message: "Balance changed concurrently — please retry the adjustment." };
    }
    throw err;
  }

  return { ok: true, data: { newBalance } };
}
