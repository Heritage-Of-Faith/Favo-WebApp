// AT-209 — which orders count toward revenue, now that a started order can be
// cancelled (T6, REQ-040). L02: "cancelling a paid order corrects stock and
// the record, it does not return money" (§11.3 cancelOrder) — so the money of
// a cancelled order that holds a successful payment is still revenue, and a
// cancelled order with no successful payment never is.
//
// Before AT-209 only an `ordered` order could be cancelled, so the old filter
// state IN ('in_progress','ready','collected') was complete. This keeps it and
// adds exactly one case. Every revenue read must use this predicate, and
// migration 0045 rewrites v_daily_revenue to the same text
// (v_weekly_variance stopped reading revenue in 0022). The predicate names the
// table `orders` unaliased.
//
// The one exception is the nightly close (src/server/crons/close-daily.ts),
// which by owner decision (#260) counts every non-cancelled order of the
// revenue day whatever its state; it adds the same one case,
// cancelledWithSuccessfulPayment, so a paid order cancelled after start raises
// no false variance.

import { sql } from "drizzle-orm";

export const REVENUE_ORDER_SCOPE_SQL =
  "(orders.state IN ('in_progress', 'ready', 'collected')" +
  " OR (orders.state = 'cancelled' AND EXISTS (" +
  "SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful')))";

/** The predicate as a drizzle SQL fragment (static template, no interpolation).
 *  Its text must equal REVENUE_ORDER_SCOPE_SQL; a unit test pins that. */
export const revenueOrderScope = sql`(orders.state IN ('in_progress', 'ready', 'collected') OR (orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful')))`;

/** The one case AT-209 adds, on its own: a cancelled order holding a successful payment. */
export const CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL =
  "(orders.state = 'cancelled' AND EXISTS (" +
  "SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful'))";

/** CANCELLED_WITH_SUCCESSFUL_PAYMENT_SQL as a static template (no interpolation); a unit test pins the text. */
export const cancelledWithSuccessfulPayment = sql`(orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful'))`;
