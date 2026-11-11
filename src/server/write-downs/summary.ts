// AT-209 — the /admin/write-downs read: §7.3.1's write-down block, per barista.
// Spec: docs/FAVO_PRD_v7.md §7.3.1, the Admin "Write-downs" screen row,
// REQ-059 ("the comp appears on /admin/write-downs per barista") and REQ-124
// ("three named per-barista figures … each traceable to
// audit_log.actor_staff_id, zero printed as 0 rather than omitted").
//
// Read only. Every figure is read from the audit_log row that recorded the act,
// so each one is traceable to its actor (today's column is audit_log.actor_id;
// the §10.3.2 actor_staff_id rename is a separate migration):
//   comps       action 'comp' on an order_item (compOrderLine). Value = the
//               row's after.valueZar, integer cents.
//   write-offs  action 'write_off' on an order (closeDaily's sweep). Actor =
//               orders.staff_id. Value = after.valueZar, integer cents.
//   abandoned   action 'override' on an order with after.abandoned = true
//               (abandonOrder). §7.3.1 asks for a count only, so no value.
// Bucketed by the order's revenue_day (L07), inclusive on both ends.
// Integer cents throughout; nothing here rounds. daily_seq does not exist yet
// (PRD §10.3 commissions it), so rows carry the order id.

import { sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { WRITE_OFF_ACTION, WRITE_OFF_REASONS, type WriteOffReason } from "@/server/close/write-offs";

export type WriteDownKind = "comp" | "write_off" | "abandoned";

export type WriteDownRow = {
  kind: WriteDownKind;
  auditId: string;
  revenueDay: string;
  at: Date;
  /** audit_log.actor_id — the barista the act is attributed to. */
  staffId: string | null;
  staffName: string | null;
  /** The admin whose PIN authorised a third comp (audit_log.on_behalf_of_staff_id). */
  onBehalfOfName: string | null;
  orderId: string;
  /** Integer cents. Null for an abandoned order (§7.3.1: count only), or when the audit row carries no integer value. */
  valueZar: number | null;
  reason: string | null;
  /**
   * Write-offs only: true while the revenue day has no `write_off_approved`
   * row (§6.0.5: "Until cleared, the day's write-offs report as `unapproved`").
   * Always false for a comp or an abandoned order.
   */
  unapproved: boolean;
};

/** A money figure: integer cents, or null = UNAVAILABLE (a contributing row had no value). */
export type CountAndZar = { count: number; zar: number | null };

export type BaristaWriteDowns = {
  staffId: string;
  name: string;
  comps: CountAndZar;
  /** §7.3.1: count and written_off_zar, split by reason; `unapproved` per §6.0.5. */
  writeOffs: CountAndZar & { byReason: Record<WriteOffReason, CountAndZar>; unapproved: CountAndZar };
  abandoned: { count: number };
};

export type StaffRef = { id: string; name: string };

const zero = (): CountAndZar => ({ count: 0, zar: 0 });

/** Every WRITE_OFF_REASONS value, in the order the close names them. */
export const WRITE_OFF_REASON_LIST = Object.values(WRITE_OFF_REASONS) as WriteOffReason[];

const zeroByReason = (): Record<WriteOffReason, CountAndZar> =>
  Object.fromEntries(WRITE_OFF_REASON_LIST.map((r) => [r, zero()])) as Record<WriteOffReason, CountAndZar>;

function add(acc: CountAndZar, valueZar: number | null): void {
  acc.count += 1;
  acc.zar = acc.zar === null || valueZar === null ? null : acc.zar + valueZar;
}

/**
 * One entry per staff member — every active staff member, with zeroes where
 * they did nothing (zero prints as 0, never omitted), plus anyone else a row
 * is attributed to. Rows with no actor fall under `unattributed`.
 */
export function summarisePerBarista(rows: WriteDownRow[], activeStaff: StaffRef[]): BaristaWriteDowns[] {
  const out = new Map<string, BaristaWriteDowns>();
  const entry = (id: string, name: string): BaristaWriteDowns => {
    let e = out.get(id);
    if (!e) {
      e = { staffId: id, name, comps: zero(), writeOffs: { ...zero(), byReason: zeroByReason(), unapproved: zero() }, abandoned: { count: 0 } };
      out.set(id, e);
    }
    return e;
  };
  for (const s of activeStaff) entry(s.id, s.name);
  for (const r of rows) {
    const e = entry(r.staffId ?? "", r.staffName ?? r.staffId ?? "unattributed");
    if (r.kind === "comp") add(e.comps, r.valueZar);
    else if (r.kind === "write_off") {
      add(e.writeOffs, r.valueZar);
      // A reason outside WRITE_OFF_REASONS (none is written today) counts in the total only.
      const bucket = e.writeOffs.byReason[r.reason as WriteOffReason];
      if (bucket) add(bucket, r.valueZar);
      if (r.unapproved) add(e.writeOffs.unapproved, r.valueZar);
    } else e.abandoned.count += 1;
  }
  return [...out.values()];
}

/** Monday–Sunday (the weekly summary's week, generate-weekly-pnl.ts) containing a YYYY-MM-DD day. */
export function weekContaining(day: string): { from: string; to: string } {
  const d = new Date(`${day}T00:00:00Z`);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - sinceMonday * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

type RawRow = {
  kind: WriteDownKind;
  audit_id: string;
  revenue_day: string;
  at: string | Date;
  staff_id: string | null;
  staff_name: string | null;
  on_behalf_of_name: string | null;
  order_id: string;
  value_zar: number | string | null;
  reason: string | null;
};

/**
 * Every comp, write-off and abandoned order whose order's revenue day is in
 * [from, to]. `unapprovedDays` is the revenue days the §6.0.5 approval queue
 * (listUnapprovedWriteOffDays) reports, so "unapproved" has one definition.
 */
export async function readWriteDowns(
  client: Pick<DB, "execute">,
  from: string,
  to: string,
  unapprovedDays: ReadonlySet<string> = new Set()
): Promise<WriteDownRow[]> {
  const intValue = sql`CASE WHEN (a.after->>'valueZar') ~ '^-?[0-9]+$' THEN (a.after->>'valueZar')::bigint END`;
  const rows = (await client.execute<RawRow>(sql`
    SELECT * FROM (
      SELECT 'comp' AS kind, a.id AS audit_id, o.revenue_day::text AS revenue_day, to_json(a.at) #>> '{}' AS at,
             a.actor_id AS staff_id, s.name AS staff_name, ob.name AS on_behalf_of_name,
             o.id AS order_id, ${intValue} AS value_zar, a.reason
      FROM audit_log a
      JOIN orders o ON o.id = a.after->>'orderId'
      LEFT JOIN staff s ON s.id = a.actor_id
      LEFT JOIN staff ob ON ob.id = a.on_behalf_of_staff_id
      WHERE a.entity_kind = 'order_item' AND a.action = 'comp'
        AND o.revenue_day BETWEEN ${from}::date AND ${to}::date
      UNION ALL
      SELECT 'write_off', a.id, o.revenue_day::text, to_json(a.at) #>> '{}',
             a.actor_id, s.name, NULL, o.id, ${intValue}, a.reason
      FROM audit_log a
      JOIN orders o ON o.id = a.entity_id
      LEFT JOIN staff s ON s.id = a.actor_id
      WHERE a.entity_kind = 'order' AND a.action = ${WRITE_OFF_ACTION}
        -- REQ-034: a reversed write-off has written_off_at cleared and is not a write-off any more.
        AND o.written_off_at IS NOT NULL
        AND o.revenue_day BETWEEN ${from}::date AND ${to}::date
      UNION ALL
      SELECT 'abandoned', a.id, o.revenue_day::text, to_json(a.at) #>> '{}',
             a.actor_id, s.name, NULL, o.id, NULL, a.reason
      FROM audit_log a
      JOIN orders o ON o.id = a.entity_id
      LEFT JOIN staff s ON s.id = a.actor_id
      WHERE a.entity_kind = 'order' AND a.action = 'override' AND (a.after->>'abandoned') = 'true'
        AND o.revenue_day BETWEEN ${from}::date AND ${to}::date
    ) w
    ORDER BY revenue_day, at, audit_id
  `)) as unknown as RawRow[];
  return rows.map((r) => ({
    kind: r.kind,
    auditId: r.audit_id,
    revenueDay: String(r.revenue_day),
    at: r.at instanceof Date ? r.at : new Date(r.at),
    staffId: r.staff_id,
    staffName: r.staff_name,
    onBehalfOfName: r.on_behalf_of_name,
    orderId: r.order_id,
    valueZar: r.kind === "abandoned" || r.value_zar === null ? null : Number(r.value_zar),
    reason: r.reason,
    unapproved: r.kind === "write_off" && unapprovedDays.has(String(r.revenue_day)),
  }));
}

/** A real calendar day as YYYY-MM-DD (2026-02-30 is not one). */
export function isCalendarDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Active staff, for the zero rows. */
export async function readActiveStaff(client: Pick<DB, "execute">): Promise<StaffRef[]> {
  const rows = (await client.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM staff WHERE active = true ORDER BY name, id
  `)) as unknown as Array<{ id: string; name: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
