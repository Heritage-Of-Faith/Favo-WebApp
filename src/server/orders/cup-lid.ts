// AT-187 · REQ-125 · L24 — cup and lid deduction follows the mode.
//
// L24: "Cup and lid deduction follows the mode. Excluded on weekday orders;
// included on Sunday orders; per the event's `consumes_cup_lid` switch on
// event orders." PRD §4 mode table: weekday is "Own mugs — no cup/lid cost".
// §10.5(2): deduction reads "the mode from the day's `opening_sessions` row".
//
// A cup or a lid is an inventory item of kind 'packaging'. Every packaging
// item that exists is one (seed: inv_item_cup_8oz, inv_item_cup_12oz,
// inv_item_lid) and no code path creates inventory items outside the seed.
//
// Event mode: an event in force at the order's placed_at follows its window's
// `consumes_cup_lid` switch (L24, L26). Otherwise the mode rule matches the L03
// free cup's session check (free-coffee.ts isFreeCupWeekday): weekday only when
// the day has at least one session and every one, read as it behaves at that
// instant (an event whose window is not in force reads as the date default),
// is mode='weekday'. No session is not a weekday. Unlike the free cup this
// does not also test the calendar date (L24 follows the mode).
// DEC-28 (d): an order stamped with orders.event_window_id follows that
// window's switch by the link, never by a fresh read at placed_at. An
// unstamped order reads the sessions of its placed_at instant — for an offline
// replay placed_at is the instant it was priced under (apply-outbox replayTill),
// so pricing and deduction always agree.

import { eq } from "drizzle-orm";
import { eventWindows } from "@db/schema";
import type { DB } from "@/lib/db";
import { revenueDay } from "@/lib/format";
import { readTillMode } from "@/server/orders/till-mode-read";
import { tillConsumesCupAndLid } from "@/lib/till-mode";

/** The inventory kind that holds cups and lids. */
export const CUP_LID_KIND = "packaging";

export function isCupOrLid(kind: string | null | undefined): boolean {
  return kind === CUP_LID_KIND;
}

/** False only when the day's sessions are all mode='weekday' (L24). */
export function consumesCupAndLid(modes: readonly string[]): boolean {
  return !(modes.length > 0 && modes.every((m) => m === "weekday"));
}

/**
 * Reads the mode in force at `at` on `day` (default now) and applies L24: an
 * event in force follows its own consumes_cup_lid switch (L26 — independent
 * of payment posture), otherwise the day's sessions as they behave at `at`
 * (src/lib/till-mode.ts). Deduction passes the order's placed_at, so the
 * order follows the mode it was rung under.
 */
export async function dayConsumesCupAndLid(
  day: string,
  executor: Pick<DB, "select">,
  at: Date = new Date()
): Promise<boolean> {
  return tillConsumesCupAndLid(await readTillMode(executor, day, at));
}

/**
 * L24 for one order (DEC-28): its stamped event window's consumes_cup_lid
 * when it has one; otherwise the mode in force at its placed_at, read from
 * the sessions of placed_at's own SAST day (equal to revenue_day for every
 * order createOrder writes; for a replay crossing midnight, the day it was
 * rung — REQ-039 keeps revenue_day on the receipt day).
 */
export async function orderConsumesCupAndLid(
  order: { revenueDay: string; placedAt: Date | null | undefined; eventWindowId?: string | null },
  executor: Pick<DB, "select">
): Promise<boolean> {
  if (order.eventWindowId) {
    const [w] = await executor
      .select({ consumesCupLid: eventWindows.consumesCupLid })
      .from(eventWindows)
      .where(eq(eventWindows.id, order.eventWindowId));
    if (w) return w.consumesCupLid;
  }
  const at = order.placedAt instanceof Date && !Number.isNaN(order.placedAt.getTime()) ? order.placedAt : null;
  return at ? dayConsumesCupAndLid(revenueDay(at), executor, at) : dayConsumesCupAndLid(order.revenueDay, executor);
}
