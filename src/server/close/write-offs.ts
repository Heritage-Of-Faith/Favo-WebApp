// AT-207 — the close's write-off sweep, the one definition of "unpaid", and the
// §6.0.5 write-off approval queue.
// Spec: docs/FAVO_PRD_v7.md §6.0.5 T4, S3a, S4 step 5, L47, §10.2 daily_closes,
// the closeDaily() row of the action catalogue; REQ-007, REQ-035, REQ-166.
//
// ONE definition of unpaid, used by the sweep and by the admin unpaid-orders
// read (GET /api/admin/unpaid-orders, not built yet, must call listUnpaidOrders):
// an order is SETTLED if it holds a successful payment, or a donor_fund_entries
// `spend` entry, or payment_mode = 'donor_fund' (L47: a fund draw writes no
// payments row). It is UNPAID when it is not settled, not cancelled, not
// `free` (S3a: a free order has no payment record by design), owes a non-zero
// amount, and is not already written off.
//
// The sweep only ever writes orders.written_off_at and an audit_log row. It
// never reads or writes a payment's status beyond the SELECT below, never
// settles, and never sends anything to a terminal (§6.0.5: "The close never
// settles"; §12.3).

import { sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { formatZarField } from "@/lib/format";
import { defaultSessionMode } from "@/lib/session-mode";

/**
 * The write-off reasons, in one place so a PRD amendment changes one line.
 * `unresolved_at_close` is the PRD's own name (S4 step 5). The other two are
 * an owner-pending reading of S3a's "a reason distinguishing them" (AT-207).
 */
export const WRITE_OFF_REASONS = {
  /** The latest attempt was sent and never resolved: the terminal may hold the money (S4 step 5). */
  unresolvedAtClose: "unresolved_at_close",
  /** The latest attempt was declined and the order was never re-tendered (S3, S3a). */
  declinedNotRetendered: "declined_not_retendered",
  /** A deferred order never settled; also a `yoco` order with no sent attempt at all. */
  deferredUnsettled: "deferred_unsettled",
} as const;
export type WriteOffReason = (typeof WRITE_OFF_REASONS)[keyof typeof WRITE_OFF_REASONS];

/** The audit action of one write-off (entity_kind 'order'). */
export const WRITE_OFF_ACTION = "write_off";
/** The audit action that clears a revenue day's write-offs (entity_kind 'daily_close'). */
export const WRITE_OFF_APPROVED_ACTION = "write_off_approved";
/** A refused approval (wrong PIN). */
export const WRITE_OFF_APPROVAL_REFUSED_ACTION = "write_off_approval_refused";
export const DAILY_CLOSE_ENTITY = "daily_close";

/** What the unpaid predicate needs to know about one order. */
export type OrderSettlementFacts = {
  id: string;
  staffId: string;
  totalZar: number;
  placedAt: Date;
  revenueDay: string;
  state: string;
  paymentMode: string | null;
  writtenOff: boolean;
  hasSuccessfulPayment: boolean;
  hasFundSpend: boolean;
  /** The highest-numbered payment attempt, or null when none exists. */
  latestAttempt: { status: string; sent: boolean } | null;
};

/** L47 / REQ-166 / catalogue: settled = a successful payment OR a fund spend (OR taken as a fund order). */
export function isSettled(o: Pick<OrderSettlementFacts, "hasSuccessfulPayment" | "hasFundSpend" | "paymentMode">): boolean {
  return o.hasSuccessfulPayment || o.hasFundSpend || o.paymentMode === "donor_fund";
}

/**
 * FAIL SAFE until S7a exists. L19: no order on a standard weekday carries a
 * payment step, but createOrder marks `free` only an R0 order — so a weekday
 * order of two cups (one free, R20 owed, payment_mode NULL, no payment) would
 * look unpaid and be written off nightly: the phantom loss S3a forbids. Until
 * the S7a weekday-free rule is built, no order whose revenue day is a weekday
 * (Monday–Friday, per defaultSessionMode — the same rule opening sessions use)
 * is ever unpaid. Saturday (events) and Sunday are swept. Set to false — the
 * one place to change — when S7a lands.
 */
export const WEEKDAY_ORDERS_NEVER_SWEPT_UNTIL_S7A = true;

function isWeekdayRevenueDay(revenueDay: string): boolean {
  return defaultSessionMode(revenueDay) === "weekday";
}

/** S3a: no successful payment, a non-zero amount owed, never `free`, never cancelled, not yet written off. */
export function isUnpaid(o: OrderSettlementFacts): boolean {
  if (WEEKDAY_ORDERS_NEVER_SWEPT_UNTIL_S7A && isWeekdayRevenueDay(o.revenueDay)) return false;
  return (
    o.state !== "cancelled" &&
    !o.writtenOff &&
    o.paymentMode !== "free" &&
    o.totalZar > 0 &&
    !isSettled(o)
  );
}

/**
 * Which reason an unpaid order is written off under. An attempt that was sent
 * and is still open wins over everything: the terminal may have taken the
 * money, so it must reach T10 as `unresolved_at_close` (S4 step 5) whatever
 * mode the order was taken in.
 */
export function writeOffReason(o: Pick<OrderSettlementFacts, "paymentMode" | "latestAttempt">): WriteOffReason {
  const a = o.latestAttempt;
  if (a && a.sent && (a.status === "unresolved" || a.status === "pending")) return WRITE_OFF_REASONS.unresolvedAtClose;
  if (o.paymentMode === "yoco_deferred") return WRITE_OFF_REASONS.deferredUnsettled;
  if (a && a.status === "declined") return WRITE_OFF_REASONS.declinedNotRetendered;
  return WRITE_OFF_REASONS.deferredUnsettled;
}

type FactsRow = {
  id: string;
  staff_id: string;
  total_zar: number | string;
  placed_at: Date | string;
  revenue_day: string;
  state: string;
  payment_mode: string | null;
  written_off: boolean;
  has_successful_payment: boolean;
  has_fund_spend: boolean;
  latest_status: string | null;
  latest_sent: boolean | null;
};

function toFacts(r: FactsRow): OrderSettlementFacts {
  return {
    id: r.id,
    staffId: r.staff_id,
    totalZar: Number(r.total_zar),
    placedAt: r.placed_at instanceof Date ? r.placed_at : new Date(r.placed_at),
    revenueDay: String(r.revenue_day),
    state: r.state,
    paymentMode: r.payment_mode,
    writtenOff: r.written_off,
    hasSuccessfulPayment: r.has_successful_payment,
    hasFundSpend: r.has_fund_spend,
    latestAttempt: r.latest_status === null ? null : { status: r.latest_status, sent: r.latest_sent === true },
  };
}

/**
 * The facts for every not-cancelled, not-written-off order (of one revenue day,
 * or of all days). With `lock`, the order rows are locked FOR UPDATE so the
 * sweep serialises with the tender chain, which locks the order the same way.
 */
async function readFacts(client: DB, opts: { revenueDay?: string; lock?: boolean }): Promise<OrderSettlementFacts[]> {
  const dayFilter = opts.revenueDay ? sql`AND o.revenue_day = ${opts.revenueDay}::date` : sql``;
  const lock = opts.lock ? sql`FOR UPDATE OF o` : sql``;
  const rows = await client.execute<FactsRow>(sql`
    SELECT o.id, o.staff_id, o.total_zar, to_json(o.placed_at) #>> '{}' AS placed_at, o.revenue_day::text AS revenue_day,
           o.state::text AS state, o.payment_mode,
           (o.written_off_at IS NOT NULL) AS written_off,
           EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'successful') AS has_successful_payment,
           EXISTS (SELECT 1 FROM donor_fund_entries e WHERE e.order_id = o.id AND e.kind = 'spend') AS has_fund_spend,
           la.status::text AS latest_status,
           (la.sent_at IS NOT NULL) AS latest_sent
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT p.status, p.sent_at FROM payments p WHERE p.order_id = o.id ORDER BY p.attempt DESC LIMIT 1
    ) la ON true
    WHERE o.state <> 'cancelled' AND o.written_off_at IS NULL ${dayFilter}
    ORDER BY o.placed_at, o.id
    ${lock}
  `);
  return (rows as unknown as FactsRow[]).map(toFacts);
}

/** The admin unpaid-orders list (S3a, N1.6.11): the same predicate as the sweep. */
export async function listUnpaidOrders(client: DB, opts: { revenueDay?: string } = {}): Promise<OrderSettlementFacts[]> {
  return (await readFacts(client, { revenueDay: opts.revenueDay })).filter(isUnpaid);
}

export type WrittenOffOrder = {
  orderId: string;
  staffId: string;
  valueZar: number;
  placedAt: Date;
  reason: WriteOffReason;
};

export type SweepResult = {
  /** Written off by THIS run. */
  written: WrittenOffOrder[];
  /** The day's totals after the sweep (what daily_closes records). */
  dayCount: number;
  dayZar: number;
};

/**
 * REQ-007 / §6.0.5 step 1: write off every unpaid order of the revenue day.
 * Run inside closeDaily()'s per-day locked transaction. Idempotent: an order
 * already written off is not selected, and the UPDATE only stamps a NULL
 * written_off_at, so a re-run never double-counts.
 */
export async function sweepWriteOffs(client: DB, revenueDay: string, now: Date): Promise<SweepResult> {
  const unpaid = (await readFacts(client, { revenueDay, lock: true })).filter(isUnpaid);
  const written: WrittenOffOrder[] = [];
  for (const o of unpaid) {
    const updated = await client.execute<{ id: string }>(sql`
      UPDATE orders SET written_off_at = ${now.toISOString()}::timestamptz
      WHERE id = ${o.id} AND written_off_at IS NULL
      RETURNING id
    `);
    if ((updated as unknown as unknown[]).length === 0) continue;
    const reason = writeOffReason(o);
    // REQ-035 / §6.0.5: actor_kind 'system' and actor_staff_id = orders.staff_id.
    // Today's audit_log shape: actor_role carries the kind, actor_id the barista
    // (the §10.3.2 actor_kind/actor_staff_id split is a separate migration).
    await writeAudit(
      {
        entityKind: "order",
        entityId: o.id,
        action: WRITE_OFF_ACTION,
        actorId: o.staffId,
        actorRole: "system",
        before: { writtenOffAt: null },
        after: {
          revenueDay,
          writtenOffAt: now.toISOString(),
          valueZar: o.totalZar,
          paymentMode: o.paymentMode,
          latestAttemptStatus: o.latestAttempt?.status ?? null,
        },
        reason,
      },
      client
    );
    written.push({ orderId: o.id, staffId: o.staffId, valueZar: o.totalZar, placedAt: o.placedAt, reason });
  }

  const [totals] = (await client.execute<{ n: number | string; zar: number | string }>(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(total_zar), 0)::bigint AS zar
    FROM orders WHERE revenue_day = ${revenueDay}::date AND written_off_at IS NOT NULL
  `)) as unknown as Array<{ n: number | string; zar: number | string }>;
  return { written, dayCount: Number(totals?.n ?? 0), dayZar: Number(totals?.zar ?? 0) };
}

// ─── daily_closes ─────────────────────────────────────────────────────────────

export type DailyCloseRow = {
  revenueDay: string;
  writtenOffCount: number;
  writtenOffZar: number;
  reconciliationStatus: "payments_matched" | "blocked";
  blockedReason: string | null;
  closedAt: Date;
  wasCatchUp: boolean;
};

export async function hasDailyClose(client: DB, revenueDay: string): Promise<boolean> {
  const rows = await client.execute(sql`SELECT 1 FROM daily_closes WHERE revenue_day = ${revenueDay}::date`);
  return (rows as unknown as unknown[]).length > 0;
}

/** Writes the close record. A second row for a day is refused by the PK. */
export async function recordDailyClose(client: DB, row: DailyCloseRow): Promise<void> {
  await client.execute(sql`
    INSERT INTO daily_closes
      (revenue_day, written_off_count, written_off_zar, reconciliation_status, blocked_reason, closed_at, was_catch_up)
    VALUES
      (${row.revenueDay}::date, ${row.writtenOffCount}, ${row.writtenOffZar}, ${row.reconciliationStatus},
       ${row.blockedReason}, ${row.closedAt.toISOString()}::timestamptz, ${row.wasCatchUp})
  `);
}

export type BlockedClose = { revenueDay: string; blockedReason: string; closedAt: Date };

/**
 * REQ-036's in-app alert: every close record that is blocked. Read by the
 * admin banner; it stays there while the row is blocked. The PRD defines no
 * resolve action, so nothing here clears it.
 */
export async function listBlockedDailyCloses(client: DB): Promise<BlockedClose[]> {
  const rows = (await client.execute<{ revenue_day: string; blocked_reason: string | null; closed_at: string | Date }>(sql`
    SELECT revenue_day::text AS revenue_day, blocked_reason, to_json(closed_at) #>> '{}' AS closed_at
    FROM daily_closes
    WHERE reconciliation_status = 'blocked'
    ORDER BY revenue_day
  `)) as unknown as Array<{ revenue_day: string; blocked_reason: string | null; closed_at: string | Date }>;
  return rows.map((r) => ({
    revenueDay: String(r.revenue_day),
    blockedReason: r.blocked_reason ?? "",
    closedAt: r.closed_at instanceof Date ? r.closed_at : new Date(r.closed_at),
  }));
}

// ─── The write-off push (§6.0.5 "Admin | 00:05") ──────────────────────────────

/** Names the count and the value written off, and the reason for each. */
export function buildWriteOffAlert(revenueDay: string, written: WrittenOffOrder[]): { title: string; body: string; data: Record<string, unknown> } {
  const totalZar = written.reduce((s, w) => s + w.valueZar, 0);
  const byReason = new Map<string, number>();
  for (const w of written) byReason.set(w.reason, (byReason.get(w.reason) ?? 0) + 1);
  const reasons = [...byReason.entries()].map(([r, n]) => `${n} ${r}`).join(", ");
  const n = written.length;
  return {
    title: `Written off at close — ${revenueDay}`,
    body: `${n} unpaid order${n === 1 ? "" : "s"} written off, ${formatZarField(totalZar)}: ${reasons}. They stay unapproved until an Admin approves them with a PIN.`,
    data: {
      revenueDay,
      count: n,
      totalZar,
      items: written.map((w) => ({ orderId: w.orderId, valueZar: w.valueZar, reason: w.reason, staffId: w.staffId })),
      url: "/admin",
    },
  };
}

// ─── The approval queue (§6.0.5, REQ-035) ─────────────────────────────────────

export type QueueItem = {
  orderId: string;
  placedAt: Date;
  valueZar: number;
  reason: string | null;
  staffId: string;
  baristaName: string | null;
};
export type QueueDay = { revenueDay: string; count: number; totalZar: number; items: QueueItem[] };

export type DayWriteOffStatus = { count: number; totalZar: number; orderIds: string[]; approved: boolean };

/** One revenue day's write-offs and whether they have been approved. */
export async function dayWriteOffStatus(client: DB, revenueDay: string): Promise<DayWriteOffStatus> {
  const offs = (await client.execute<{ id: string; total_zar: number | string }>(sql`
    SELECT id, total_zar FROM orders
    WHERE revenue_day = ${revenueDay}::date AND written_off_at IS NOT NULL
    ORDER BY placed_at, id
  `)) as unknown as Array<{ id: string; total_zar: number | string }>;
  const approvals = (await client.execute(sql`
    SELECT 1 FROM audit_log
    WHERE entity_kind = ${DAILY_CLOSE_ENTITY} AND entity_id = ${revenueDay} AND action = ${WRITE_OFF_APPROVED_ACTION}
    LIMIT 1
  `)) as unknown as unknown[];
  return {
    count: offs.length,
    totalZar: offs.reduce((s, o) => s + Number(o.total_zar), 0),
    orderIds: offs.map((o) => o.id),
    approved: approvals.length > 0,
  };
}

type QueueRow = {
  revenue_day: string;
  order_id: string;
  placed_at: Date | string;
  total_zar: number | string;
  reason: string | null;
  staff_id: string;
  barista_name: string | null;
};

/**
 * The days whose write-offs are `unapproved`: the day has written-off orders
 * and no `write_off_approved` audit row. One item per day, listing every
 * write-off with its value, reason and barista (daily_seq does not exist yet,
 * so the order id and placed_at stand in for it). Pass `revenueDay` for one day.
 */
export async function listUnapprovedWriteOffDays(client: DB, opts: { revenueDay?: string } = {}): Promise<QueueDay[]> {
  const dayFilter = opts.revenueDay ? sql`AND o.revenue_day = ${opts.revenueDay}::date` : sql``;
  const rows = (await client.execute<QueueRow>(sql`
    SELECT o.revenue_day::text AS revenue_day, o.id AS order_id, to_json(o.placed_at) #>> '{}' AS placed_at, o.total_zar,
           w.reason, o.staff_id, s.name AS barista_name
    FROM orders o
    LEFT JOIN staff s ON s.id = o.staff_id
    LEFT JOIN LATERAL (
      SELECT a.reason FROM audit_log a
      WHERE a.entity_kind = 'order' AND a.entity_id = o.id AND a.action = ${WRITE_OFF_ACTION}
      ORDER BY a.at DESC LIMIT 1
    ) w ON true
    WHERE o.written_off_at IS NOT NULL ${dayFilter}
      AND NOT EXISTS (
        SELECT 1 FROM audit_log ap
        WHERE ap.entity_kind = ${DAILY_CLOSE_ENTITY} AND ap.entity_id = o.revenue_day::text
          AND ap.action = ${WRITE_OFF_APPROVED_ACTION}
      )
    ORDER BY o.revenue_day, o.placed_at, o.id
  `)) as unknown as QueueRow[];

  const days = new Map<string, QueueDay>();
  for (const r of rows) {
    const day = String(r.revenue_day);
    const entry = days.get(day) ?? { revenueDay: day, count: 0, totalZar: 0, items: [] };
    const valueZar = Number(r.total_zar);
    entry.items.push({
      orderId: r.order_id,
      placedAt: r.placed_at instanceof Date ? r.placed_at : new Date(r.placed_at),
      valueZar,
      reason: r.reason,
      staffId: r.staff_id,
      baristaName: r.barista_name,
    });
    entry.count += 1;
    entry.totalZar += valueZar;
    days.set(day, entry);
  }
  return [...days.values()];
}
