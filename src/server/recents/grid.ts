// The POS recents grid — pure ordering rules (PRD §6.2.1, REQ-050, REQ-052).
//
// PRD §6.2.1: "The order-entry screen leads with a recents grid, above the
// search field: the office staff who have NOT yet claimed today's cup, most
// recent first, then the last 12 matched customers. One tap to bind."
// REQ-052: "office staff without today's entitlement appear first … and served
// tiles appear below, visibly marked, never in a primary slot".
//
// Owner decision (Mia, read §6.2.1 as written — "on a weekday that set starts
// at ~63 and shrinks all morning"): the unclaimed section is EVERY customer with
// status office_staff without today's claim, signed up even if they never
// ordered — most recent first where they have a last order, then by surname,
// then name. "Recent" = the latest `orders.placed_at` on which the customer was
// bound (`orders.customer_id`), any state. On a clean database nobody has signed
// up, so the grid is still empty (§6.2.1).
// "Claimed today" = a `staff_entitlement_log` row for today's SAST day.
// Order of sections (this module's choice where the PRD is silent): unclaimed
// office staff, then the last 12 other matched customers, then served tiles.
// The office-staff sections apply on a weekday date only (isWeekdayDate); on
// any other day there is no cup to claim and the grid is the last 12 matched
// customers.
//
// REQ-142: a tile carries id, given name, surname, the served flag and — ONLY
// where its name and surname read alike another tile's in the same response
// (§6.9.4a "where two results still read alike") — the last four phone digits;
// otherwise phoneLast4 is null. No email, no full phone, no status.

import { phoneLast4 } from "@/lib/mask-phone";

/** PRD §6.2.1: "then the last 12 matched customers". */
export const RECENTS_MATCHED_LIMIT = 12;

/** A customer row as the server reads it. `phone` never leaves the server. */
export type RecentsRow = {
  id: string;
  name: string;
  surname: string | null;
  phone: string | null;
};

export type RecentsTile = {
  id: string;
  /** Given name only (AT-211). */
  name: string;
  surname: string | null;
  /** Only where another tile in the same response reads alike; else null. */
  phoneLast4: string | null;
  /** Today's free cup is already claimed (REQ-052: shown below, marked). */
  served: boolean;
};

/**
 * The name two tiles "read alike" on: given name + surname, accent- and
 * case-insensitive, whitespace trimmed and collapsed. "André Botha" = "andre  botha".
 */
export function readsAlikeKey(name: string, surname: string | null): string {
  return `${name} ${surname ?? ""}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type Picked = { row: RecentsRow; served: boolean };

/**
 * @param weekday       today is a weekday date
 * @param officeStaff   every office_staff customer: most recent order first, then never-ordered by surname, name
 * @param servedIds     customers with a staff_entitlement_log row today
 * @param matched       other customers bound to an order, most recent first
 */
export function buildRecentsGrid(input: {
  weekday: boolean;
  officeStaff: readonly RecentsRow[];
  servedIds: ReadonlySet<string>;
  matched: readonly RecentsRow[];
}): RecentsTile[] {
  const seen = new Set<string>();
  const out: Picked[] = [];
  const served: Picked[] = [];

  if (input.weekday) {
    for (const r of input.officeStaff) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (input.servedIds.has(r.id)) served.push({ row: r, served: true });
      else out.push({ row: r, served: false });
    }
  }

  let taken = 0;
  for (const r of input.matched) {
    if (taken >= RECENTS_MATCHED_LIMIT) break;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ row: r, served: false });
    taken++;
  }

  const picked = [...out, ...served];
  const counts = new Map<string, number>();
  for (const p of picked) {
    const k = readsAlikeKey(p.row.name, p.row.surname);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // Field by field — never spread the row, so the full phone cannot ride along.
  return picked.map(({ row: r, served: isServed }) => ({
    id: r.id,
    name: r.name,
    surname: r.surname ?? null,
    phoneLast4: (counts.get(readsAlikeKey(r.name, r.surname)) ?? 0) > 1 ? phoneLast4(r.phone) : null,
    served: isServed,
  }));
}
