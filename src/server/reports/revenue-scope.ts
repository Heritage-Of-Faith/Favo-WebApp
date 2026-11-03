// AT-209 — which orders count toward revenue, now that a started order can be
// cancelled (T6, REQ-040). L02: "cancelling a paid order corrects stock and
// the record, it does not return money" (§11.3 cancelOrder) — so the money of
// a cancelled order that holds a successful payment is still revenue, and a
// cancelled order with no successful payment never is.
//
// AT-203 follow-up (owner decision, Mia, 3 Nov 2026): a fund draw is a tender
// (L47), and "each draw recognises its own revenue at normal margin"
// (§6.10.4). A fund-paid order has no payments row; its draw is one
// donor_fund_entries `spend` entry. An ABANDONED fund-paid order (T6 step 2b,
// "it reverses nothing") keeps its draw, so it is revenue exactly like an
// abandoned card-paid order. A CANCELLED fund-paid order has its draw given
// back by a compensating `adjustment` entry (§6.10.5, REQ-168), so it is not.
//
// Before AT-209 only an `ordered` order could be cancelled, so the old filter
// state IN ('in_progress','ready','collected') was complete. This keeps it and
// adds exactly these two cases. Every revenue read must use this predicate,
// and migration 0050 rewrites v_daily_revenue to the same text (0045 wrote the
// card case only; v_weekly_variance stopped reading revenue in 0022). The
// predicate names the table `orders` unaliased.
//
// The one exception is the nightly close (src/server/crons/close-daily.ts),
// which by owner decision (#260) counts every non-cancelled order of the
// revenue day whatever its state; it adds only the card case,
// cancelledWithSuccessfulPayment, so a paid order cancelled after start raises
// no false variance. It leaves every donor_fund order out of its
// card-versus-payments reconciliation (L47), so the fund case is not its.

import { sql } from "drizzle-orm";

export const REVENUE_ORDER_SCOPE_SQL =
  "(orders.state IN ('in_progress', 'ready', 'collected')" +
  " OR (orders.state = 'cancelled' AND EXISTS (" +
  "SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful'))" +
  " OR (orders.state = 'cancelled' AND EXISTS (" +
  "SELECT 1 FROM donor_fund_entries fs WHERE fs.order_id = orders.id AND fs.kind = 'spend')" +
  " AND NOT EXISTS (" +
  "SELECT 1 FROM donor_fund_entries fa WHERE fa.order_id = orders.id AND fa.kind = 'adjustment')))";

/** The predicate as a drizzle SQL fragment (static template, no interpolation).
 *  Its text must equal REVENUE_ORDER_SCOPE_SQL; a unit test pins that. */
export const revenueOrderScope = sql`(orders.state IN ('in_progress', 'ready', 'collected') OR (orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful')) OR (orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM donor_fund_entries fs WHERE fs.order_id = orders.id AND fs.kind = 'spend') AND NOT EXISTS (SELECT 1 FROM donor_fund_entries fa WHERE fa.order_id = orders.id AND fa.kind = 'adjustment')))`;

/** The card case AT-209 adds, on its own: a cancelled order holding a successful payment. */
export const CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL =
  "(orders.state = 'cancelled' AND EXISTS (" +
  "SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful'))";

/** CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL as a static template (no interpolation); a unit test pins the text. */
export const cancelledWithSuccessfulPayment = sql`(orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful'))`;

/** The fund case, on its own: a cancelled order holding a fund `spend` entry and no
 *  compensating `adjustment` — abandoned (T6 step 2b), not cancelled-and-given-back (REQ-168). */
export const CANCELLED_WITH_UNREVERSED_FUND_DRAW_SQL =
  "(orders.state = 'cancelled' AND EXISTS (" +
  "SELECT 1 FROM donor_fund_entries fs WHERE fs.order_id = orders.id AND fs.kind = 'spend')" +
  " AND NOT EXISTS (" +
  "SELECT 1 FROM donor_fund_entries fa WHERE fa.order_id = orders.id AND fa.kind = 'adjustment'))";

/** CANCELLED_WITH_UNREVERSED_FUND_DRAW_SQL as a static template (no interpolation); a unit test pins the text. */
export const cancelledWithUnreversedFundDraw = sql`(orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM donor_fund_entries fs WHERE fs.order_id = orders.id AND fs.kind = 'spend') AND NOT EXISTS (SELECT 1 FROM donor_fund_entries fa WHERE fa.order_id = orders.id AND fa.kind = 'adjustment'))`;
