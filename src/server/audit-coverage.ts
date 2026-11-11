// What GET /api/admin/audit-coverage measures (REQ-064, PRD §05, §10.3.2).
//
// REQ-064: "Given any mutation or any rejected action · When it completes ·
// Then an audit_log row exists … and /api/admin/audit-coverage returns 0 orphans".
//
// MEASURED: each row CREATED in the window in one of the tables below, paired
// with an audit_log row of the matching entity_kind whose entity_id is that
// row's id. Every insert site of each table was checked to write exactly that
// pair (grep `insert(<table>)` → the writeAudit call beside it):
//   orders           createOrder, apply-outbox (offline replay)      'order'
//   payments         beginTender, via both tender stores            'payment'
//   waste_log        logWaste, abandonOrder                          'waste_log'
//   walk_ins         logWalkIn                                       'walk_in'
//   stock_takes      runStockTake                                    'stock_take'
//   opening_sessions the one session insert in actions/opening.ts    'opening_session'
//   event_windows    the profile path in opening.ts, openEventWindow 'event_window'
//
// NOT MEASURED (a gap here is invisible to this endpoint):
//   - updates and transitions (order state changes, recosts, closes): no table
//     carries a per-row "last changed" time to count them from;
//   - rejected actions: a refusal writes nothing but its audit row, so there
//     is no second record to compare it against;
//   - tables with no creation time, or whose time is user-supplied
//     (order_items, staff_entitlement_log, expenses.incurred_at, …), and tables
//     whose audit row names a different entity (stock_movements, the funds,
//     vouchers, customers, menu and recipe edits).

import { sql, type SQL } from "drizzle-orm";

export const AUDIT_WINDOW_MINUTES = 30;
export const AUDIT_WINDOW = `${AUDIT_WINDOW_MINUTES} minutes`;

/** table, its creation-time column, and the entity_kind its writers audit under. */
export const MEASURED_MUTATIONS = [
  { table: "orders", createdAt: "placed_at", entityKind: "order" },
  { table: "payments", createdAt: "at", entityKind: "payment" },
  { table: "waste_log", createdAt: "at", entityKind: "waste_log" },
  { table: "walk_ins", createdAt: "at", entityKind: "walk_in" },
  { table: "stock_takes", createdAt: "started_at", entityKind: "stock_take" },
  { table: "opening_sessions", createdAt: "created_at", entityKind: "opening_session" },
  { table: "event_windows", createdAt: "created_at", entityKind: "event_window" },
] as const;

export type CoverageRow = { entity: string; id: string; audited: boolean };

/** One row per measured mutation in the window, flagged by whether it is audited. */
export function coverageQuery(): SQL {
  // Identifiers come only from the constant list above, never from a request.
  const parts = MEASURED_MUTATIONS.map(
    (m) => sql`
    SELECT ${m.entityKind}::text AS entity, t.id, t.${sql.identifier(m.createdAt)} AS created_at,
           EXISTS (
             SELECT 1 FROM audit_log a
             WHERE a.entity_kind = ${m.entityKind}
               AND a.entity_id = t.id
           ) AS audited
    FROM ${sql.identifier(m.table)} t
    WHERE t.${sql.identifier(m.createdAt)} > NOW() - (${AUDIT_WINDOW_MINUTES}::int * INTERVAL '1 minute')`
  );
  return sql`SELECT entity, id, audited FROM (${sql.join(parts, sql` UNION ALL `)}) m ORDER BY created_at, entity, id`;
}

/**
 * The response body. A gap is `entity:id`. With nothing measured in the window
 * there is nothing to divide by: coverage_pct is null, never a claimed 100 —
 * `gaps` is still empty, so "0 orphans" holds.
 */
export function summariseCoverage(rows: readonly CoverageRow[]) {
  const mutations = rows.length;
  const gaps = rows.filter((r) => !r.audited).map((r) => `${r.entity}:${r.id}`);
  const audited = mutations - gaps.length;
  const coverage_pct = mutations === 0 ? null : (audited / mutations) * 100;
  return { mutations, audited, coverage_pct, gaps };
}
